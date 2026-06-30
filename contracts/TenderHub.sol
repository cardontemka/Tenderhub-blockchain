// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenderHub (v2)
 * @notice Transparent, fair execution of a single public tender on-chain.
 *
 * One TenderHub is deployed per tender by the Захиалагч (Client). It is an
 * ERC-1155 holding two kinds of tokens:
 *
 *   1. FUNGIBLE FINANCING TOKENS (ids 1..). One token == 1 ₮. Each "tranche"
 *      (milestone / collateral / arbiter-fee / penalty) gets a unique id and
 *      represents the right to draw money from the bank Escrow account.
 *      Only the Client and the Contractor may mint fungible tokens, and anyone
 *      other than the Client must deposit equal money into Escrow to do so.
 *
 *   2. DOCUMENT NFTs (ids >= DOC_ID_BASE). Every contract, report, complaint,
 *      ruling, loan-term and amendment is anchored as a 1-of-1 token carrying
 *      {hash, uri, timestamp, submitter}.
 *
 * KEY v2 RULES
 *   - All durations are expressed in DAYS at the boundary (the contract keeps
 *     seconds internally). Penalties/overdue are measured in whole days.
 *   - Contractor at fault -> penalty is burned from the current milestone and
 *     re-minted (entitled) to the Client, regardless of any pledge.
 *   - Client at fault -> a Penalty-kind token is minted (entitled) to the Contractor.
 *   - Overdue penalty = 0.02% of total financing per day (integer).
 *   - If penalty on the current milestone reaches half of it, OR 3 rejections
 *     accumulate, the contract is SUSPENDED (only amend & cancel work).
 *   - The arbiter's ruling only resolves the specific pending subject
 *     (a rejected delivery / a rejected amendment / a cancellation); it does not
 *     sweep all tokens. The losing party pays the arbiter fee as a fine.
 *   - The Escrow keeps a minimum reserve equal to the contractor's collateral,
 *     redeemable only via the collateral tokens. On cancellation the collateral
 *     becomes the Client's and the reserve is released.
 */
contract TenderHub is ERC1155, ReentrancyGuard {
    // --------------------------------------------------------------------- //
    //                              TYPES                                     //
    // --------------------------------------------------------------------- //

    enum Role { None, Client, Contractor, Arbiter }

    enum Status { Draft, Awaiting, Active, Suspended, Cancelled, Completed }

    enum TrancheKind { Milestone, Collateral, ArbiterFee, Penalty, Advance }

    // The loan ends on-chain once the collateral is transferred to the lender;
    // repayment / token-return is settled off-chain between lender and borrower.
    enum LoanState { None, Requested, Offered, Accepted, Transferred, Rejected }

    enum Subject { None, Delivery, Amendment, Cancellation }

    enum DisputeState { None, Open, Ruled, Resolved, Appealed }

    // The proposer stages the change directly (implicitly approving); only the
    // OTHER party then approves. No separate "propose" step.
    enum AmendState { None, Staged, Rejected }

    struct Tranche {
        TrancheKind kind;
        uint256 amount;
        uint256 deadlineDays; // for milestones: days after activation
        bool entitled;
        bool delivered;
        address beneficiary;
    }

    struct Document {
        bytes32 hash;
        string uri;
        uint256 timestamp;
        address submitter;
        string docType;
    }

    struct Loan {
        address lender;
        uint256 requestedAmount; // tokens the contractor offers as collateral (no token id)
        uint256 collateralAmount; // tokens the lender takes (<= requested)
        uint256 termsDocId;
        uint256 contractDocId; // tender NFT auto-attached
        LoanState state;
        bool contractorAccepted;
        bool clientApproved;
    }

    struct Dispute {
        Subject subject;
        address initiator;
        address arbiter;
        uint256 feeTokenId;
        uint256 feeAmount;
        uint256 complaintDocId;
        uint256 rulingDocId;
        address winner;
        uint256 rulingTime;
        DisputeState state;
        bool clientAccepted;
        bool contractorAccepted;
    }

    struct Redemption {
        address holder;
        uint256 tokenId;
        uint256 amount;
        uint256 requestedAt;
        bool settled;
    }

    // --------------------------------------------------------------------- //
    //                              STORAGE                                   //
    // --------------------------------------------------------------------- //

    uint256 public constant DOC_ID_BASE = 1_000_000_000;
    uint256 public constant APPEAL_WINDOW = 7 days;
    uint256 public constant APPROVAL_GRACE = 2 days;
    uint256 public constant CANCEL_WINDOW = 7 days;
    uint256 public constant PENALTY_BPS = 2; // 0.02% = 2 / 10000

    // Roles
    address public immutable client;
    address public contractor;
    address public arbiter;
    address public oracle;

    address public pendingContractor;
    address public pendingArbiter;
    address public arbiterNominator; // who named the pending arbiter (client initially, appellant on appeal)
    bool public contractorApprovedArbiter; // = "the required counter-party approved"

    // Lifecycle
    Status public status;
    bool public frozen; // arbiter dispute freeze
    uint256 public activatedAt;
    uint256 public pausedAccum;
    uint256 private pausedSince;

    // Escrow
    string public escrowAccount;
    uint256 public escrowBalance; // ₮ held in escrow (maintained on-chain for the PoC)
    uint256 public escrowReserve; // minimum balance == collateral
    uint256 public escrowDebt; // owed to the bank from instant cover; repaid by fundEscrow

    // Documents
    uint256 public nextDocId = DOC_ID_BASE;
    uint256 public contractDocId;
    mapping(uint256 => Document) public documents;

    // Tranches
    uint256 public nextTokenId = 1;
    mapping(uint256 => Tranche) public tranches;
    uint256[] public milestoneIds;
    uint256 public currentMilestone;
    uint256 public totalFinancing; // advance + sum of milestone amounts
    uint256 public collateralTokenId;
    uint256 public advanceTokenId; // 0 if no advance; set at declareFunding
    uint256 public warrantyDays; // баталгаат хугацаа, declared with funding
    uint256 public completedAt; // when the last milestone was approved

    // Redemption pending-locks
    mapping(address => mapping(uint256 => uint256)) public pendingRedeem;
    Redemption[] public redemptions;

    // Delivery / approval
    uint256 public deliveryPendingSince; // when current delivery awaits approval
    bool public deliveryRejected; // a delivery rejection awaits the contractor's recourse

    // Penalties (charged-day bookkeeping, idempotent)
    mapping(uint256 => uint256) public overdueChargedDays; // per milestone index
    mapping(uint256 => uint256) public milestonePenalty; // per milestone index
    uint256 public deliveryLateChargedDays;
    uint256 public amendLateChargedDays;

    // Loans
    Loan[] public loans;

    // Disputes
    Dispute[] public disputes;
    uint256 public activeDisputeId; // index+1; 0 == none
    bool public disputeActive;

    // Amendments (proposer stages directly -> the other party approves)
    AmendState public amendState;
    address public amendProposer;
    uint256 public amendDocId;
    uint256 public amendPendingSince;
    uint256[] private stagedMsAmounts;
    uint256[] private stagedMsDays;
    uint256[] private stagedAddIdx; // existing milestone indexes to top up
    uint256[] private stagedAddAmt; // amounts to add to those milestones
    uint256[] private stagedAddDays; // extra days for those milestones

    // Cancellation
    bool public cancelRequested;
    address public cancelRequester;
    bool public cancelRefused; // other party refused -> requester may call arbiter

    bool private _bypass;

    // --------------------------------------------------------------------- //
    //                              EVENTS                                    //
    // --------------------------------------------------------------------- //

    event DocumentMinted(uint256 indexed id, address indexed to, string docType, bytes32 hash, string uri);
    event FundingDeclared(uint256[] milestoneIds, uint256 totalFinancing);
    event FundingAmended(uint256 totalFinancing);
    event ContractorInvited(address indexed contractor);
    event ContractorJoined(address indexed contractor);
    event ContractActivated(address indexed contractor, uint256 collateral, uint256 at);
    event ArbiterInvited(address indexed arbiter);
    event ArbiterApprovedByContractor(address indexed arbiter);
    event ArbiterAccepted(address indexed arbiter);

    event LoanRequested(uint256 indexed loanId, address indexed lender, uint256 amount);
    event LoanOffered(uint256 indexed loanId, uint256 collateralAmount, uint256 termsDocId);
    event LoanAcceptedByContractor(uint256 indexed loanId);
    event LoanRejectedByContractor(uint256 indexed loanId);
    event LoanTransferred(uint256 indexed loanId, address indexed lender, uint256 collateralAmount);

    event DeliverySubmitted(uint256 indexed milestoneId, uint256 reportDocId);
    event DeliveryApproved(uint256 indexed milestoneId, uint256 reasonDocId);
    event DeliveryRejected(uint256 indexed milestoneId, uint256 reasonDocId);
    event DeliveryRejectionAccepted(uint256 indexed milestoneId);
    event WarrantyReleased(uint256 collateralTokenId);

    event ArbiterCalled(uint256 indexed disputeId, Subject subject, address indexed initiator, uint256 feeTokenId, uint256 feeAmount);
    event RulingIssued(uint256 indexed disputeId, address indexed winner, uint256 rulingDocId);
    event RulingResponded(uint256 indexed disputeId, address indexed party, bool accepted);
    event DisputeResolved(uint256 indexed disputeId, Subject subject, address winner);
    event DisputeAppealed(uint256 indexed disputeId, uint256 indexed newDisputeId);

    event AmendmentStaged();
    event AmendmentResolved(bool approved);

    event CancellationRequested(address indexed requester);
    event CancellationResolved(bool cancelled);

    event Suspended(string reason);
    event Resumed();
    event FrozenStateChanged(bool frozen);

    event PenaltyContractor(uint256 amount, uint256 penaltyTokenId);
    event PenaltyClient(uint256 amount, uint256 penaltyTokenId);

    event EscrowDeposited(uint256 amount, string reason);
    event EscrowFunded(address indexed from, uint256 amount);
    event EscrowReported(uint256 balance, uint256 reserve);
    event RedemptionRequested(uint256 indexed reqId, address indexed holder, uint256 tokenId, uint256 amount);
    event RedemptionSettled(uint256 indexed reqId, address indexed holder, uint256 amount, bool viaBankCover);

    // --------------------------------------------------------------------- //
    //                              MODIFIERS                                 //
    // --------------------------------------------------------------------- //

    modifier onlyClient() { require(msg.sender == client, "TH: only client"); _; }
    modifier onlyContractor() { require(msg.sender == contractor, "TH: only contractor"); _; }
    modifier onlyArbiter() { require(msg.sender == arbiter, "TH: only arbiter"); _; }
    modifier onlyOracle() { require(msg.sender == oracle, "TH: only oracle"); _; }
    modifier onlyParty() { require(msg.sender == client || msg.sender == contractor, "TH: only a party"); _; }
    modifier notFrozen() { require(!frozen, "TH: contract frozen"); _; }

    // --------------------------------------------------------------------- //
    //                       1. DEPLOY                                        //
    // --------------------------------------------------------------------- //

    constructor(
        string memory contractURI,
        bytes32 contractHash,
        string memory escrowAccount_,
        address oracle_
    ) ERC1155("") {
        require(oracle_ != address(0) && oracle_ != msg.sender, "TH: bad oracle");
        client = msg.sender;
        escrowAccount = escrowAccount_;
        oracle = oracle_;
        status = Status.Draft;
        contractDocId = _mintDocument(msg.sender, contractHash, contractURI, "contract");
    }

    // --------------------------------------------------------------------- //
    //              3 + onboarding. INVITE / JOIN CONTRACTOR                  //
    // --------------------------------------------------------------------- //

    /// @notice 3: client invites a contractor. The address must not already be
    ///         any other role (client / arbiter / oracle / pending arbiter).
    function inviteContractor(address contractor_) external onlyClient {
        require(status == Status.Draft || status == Status.Awaiting, "TH: too late");
        require(contractor_ != address(0) && !_isRole(contractor_) && contractor_ != pendingArbiter, "TH: bad contractor");
        pendingContractor = contractor_;
        status = Status.Awaiting;
        emit ContractorInvited(contractor_);
    }

    /// @notice The invited contractor simply joins (accepts) the contract.
    function joinContract() external {
        require(msg.sender == pendingContractor, "TH: not the invited contractor");
        require(contractor == address(0), "TH: already joined");
        // Re-check: the address must not have become another role since the invite.
        require(msg.sender != client && msg.sender != arbiter && msg.sender != oracle, "TH: address already a role");
        contractor = msg.sender;
        emit ContractorJoined(msg.sender);
    }

    // --------------------------------------------------------------------- //
    //                  2. DECLARE FUNDING & DEADLINES                        //
    // --------------------------------------------------------------------- //

    /**
     * @notice 2: declare per-milestone funding and deadlines (in DAYS from
     *         activation). An optional advance (урьдчилгаа) is set ONLY here and
     *         can never be changed later; it becomes redeemable at activation.
     *         Advance + Σ milestones = total financing. Tokens are minted to the
     *         contractor (the Client mints without depositing money).
     */
    function declareFunding(
        uint256 advanceAmount,
        uint256[] calldata milestoneAmounts,
        uint256[] calldata deadlineDays,
        uint256 warrantyDays_
    ) external onlyClient {
        require(status == Status.Awaiting, "TH: invite & join contractor first");
        require(contractor != address(0), "TH: no contractor");
        require(milestoneIds.length == 0, "TH: already declared");
        require(milestoneAmounts.length == deadlineDays.length && milestoneAmounts.length > 0, "TH: bad input");

        warrantyDays = warrantyDays_; // баталгаат хугацаа (0 = none)
        uint256 total;
        _bypass = true;

        if (advanceAmount > 0) {
            advanceTokenId = nextTokenId++;
            // entitled = false now; flipped to true at activation (advance is upfront).
            tranches[advanceTokenId] = Tranche(TrancheKind.Advance, advanceAmount, 0, false, false, contractor);
            total += advanceAmount;
            _mint(contractor, advanceTokenId, advanceAmount, "");
        }

        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "TH: zero milestone");
            require(deadlineDays[i] > 0, "TH: zero-day deadline"); // a 0-day deadline is invalid
            uint256 id = nextTokenId++;
            tranches[id] = Tranche(TrancheKind.Milestone, milestoneAmounts[i], deadlineDays[i], false, false, contractor);
            milestoneIds.push(id);
            total += milestoneAmounts[i];
            _mint(contractor, id, milestoneAmounts[i], "");
        }
        _bypass = false;
        totalFinancing = total;
        emit FundingDeclared(milestoneIds, total);
    }

    // --------------------------------------------------------------------- //
    //              4. ACTIVATE (contractor posts collateral)                 //
    // --------------------------------------------------------------------- //

    /// @notice The required collateral: 1% of the total financing (integer).
    function requiredCollateral() public view returns (uint256) {
        return totalFinancing / 100;
    }

    /**
     * @notice 4: the joined contractor posts collateral to the Escrow and
     *         activates the contract. The collateral is fixed at 1% of the total
     *         financing. The contractor (not the client) mints, so real money
     *         equal to the collateral must be deposited (the frontend bank checks
     *         the contractor actually holds it); an equal batch of collateral
     *         tokens is minted and the Escrow keeps it as its minimum reserve.
     */
    function activateContract() external nonReentrant {
        require(msg.sender == contractor, "TH: only contractor");
        require(status == Status.Awaiting, "TH: not awaiting");
        require(totalFinancing > 0, "TH: funding not declared");
        // An arbiter must be pre-appointed; with no arbiter the contract stays inactive.
        require(arbiter != address(0), "TH: appoint an arbiter first");
        uint256 collateralAmount = requiredCollateral();
        require(collateralAmount > 0, "TH: financing too small for collateral");

        // The advance becomes redeemable as soon as the contract is active (upfront).
        if (advanceTokenId != 0) tranches[advanceTokenId].entitled = true;

        // The collateral (1% bond) is the contractor's money but is held by the
        // CLIENT as security and is non-transferable. It becomes the Client's to
        // redeem on failure/cancellation, or is returned to the contractor after
        // the warranty period on successful completion.
        collateralTokenId = nextTokenId++;
        tranches[collateralTokenId] = Tranche(TrancheKind.Collateral, collateralAmount, 0, false, false, client);
        _bypass = true;
        _mint(client, collateralTokenId, collateralAmount, "");
        _bypass = false;

        escrowBalance += collateralAmount;
        escrowReserve += collateralAmount;
        status = Status.Active;
        activatedAt = block.timestamp;
        emit EscrowDeposited(collateralAmount, "collateral");
        emit ContractActivated(contractor, collateralAmount, block.timestamp);
    }

    // --------------------------------------------------------------------- //
    //                5/6/7 & 21. APPOINT THE ARBITER                         //
    // --------------------------------------------------------------------- //

    function inviteArbiter(address arbiter_) external onlyClient {
        // Initial appointment only. Once an arbiter has accepted (is part of the
        // contract) they cannot be swapped out here — only an {appeal} brings in a
        // new arbiter.
        require(arbiter == address(0), "TH: arbiter already set; use appeal");
        require(arbiter_ != address(0) && !_isRole(arbiter_) && arbiter_ != pendingContractor, "TH: bad arbiter");
        pendingArbiter = arbiter_;
        arbiterNominator = msg.sender; // the client named this arbiter
        contractorApprovedArbiter = false;
        emit ArbiterInvited(arbiter_);
    }

    /// @notice The party who did NOT name the arbiter approves them. Initially the
    ///         client names → the contractor approves; on appeal the appellant names
    ///         → their counter-party approves.
    function approveArbiter() external onlyParty {
        require(pendingArbiter != address(0), "TH: no pending arbiter");
        require(msg.sender != arbiterNominator, "TH: nominator cannot approve");
        contractorApprovedArbiter = true;
        emit ArbiterApprovedByContractor(pendingArbiter);
    }

    function arbiterAccept() external {
        require(msg.sender == pendingArbiter, "TH: not the pending arbiter");
        require(contractorApprovedArbiter, "TH: counter-party has not approved");
        // Re-check at accept time: must not be the client/contractor/oracle, and an
        // appeal arbiter must differ from the outgoing arbiter (_isRole covers all).
        require(!_isRole(msg.sender), "TH: address already a role");
        arbiter = pendingArbiter;
        pendingArbiter = address(0);
        contractorApprovedArbiter = false;
        // If a successor (appeal) dispute is open, bind this arbiter to it.
        if (disputeActive) {
            Dispute storage d = disputes[activeDisputeId - 1];
            if (d.arbiter == address(0) && d.state == DisputeState.Open) d.arbiter = arbiter;
        }
        emit ArbiterAccepted(arbiter);
    }

    // --------------------------------------------------------------------- //
    //                 8-14. COLLATERALISED LOANS                             //
    // --------------------------------------------------------------------- //

    /**
     * @notice 8: contractor requests a loan, pledging a token AMOUNT (no token id).
     *         At most one open request per lender. When the collateral moves it is
     *         gathered from the contractor's financing tokens in id order (small to
     *         large) and the lender receives whatever mix of ids sums to it.
     */
    function requestLoan(address lender, uint256 amount)
        external onlyContractor notFrozen returns (uint256 loanId)
    {
        require(lender != address(0) && lender != client && lender != contractor, "TH: bad lender");
        require(amount > 0 && _financingFree(contractor) >= amount, "TH: insufficient balance");
        require(!_hasOpenLoan(lender), "TH: an open loan to this lender exists");
        loans.push(Loan(lender, amount, 0, 0, contractDocId, LoanState.Requested, false, false));
        loanId = loans.length - 1;
        emit LoanRequested(loanId, lender, amount);
    }

    /// @notice 9: lender offers terms (NFT) + the collateral it wants (<= requested).
    function offerLoan(uint256 loanId, string calldata termsURI, bytes32 termsHash, uint256 collateralAmount)
        external
    {
        Loan storage l = loans[loanId];
        require(msg.sender == l.lender, "TH: only the lender");
        require(l.state == LoanState.Requested, "TH: not requestable");
        require(collateralAmount > 0 && collateralAmount <= l.requestedAmount, "TH: bad collateral");
        l.collateralAmount = collateralAmount;
        l.termsDocId = _mintDocument(contractor, termsHash, termsURI, "loan-terms");
        l.state = LoanState.Offered;
        emit LoanOffered(loanId, collateralAmount, l.termsDocId);
    }

    /// @notice 10: contractor accepts the offer; awaits the client's multisig approval.
    function acceptLoan(uint256 loanId) external onlyContractor {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Offered, "TH: not offered");
        require(_financingFree(contractor) >= l.collateralAmount, "TH: insufficient balance");
        l.contractorAccepted = true;
        l.state = LoanState.Accepted;
        emit LoanAcceptedByContractor(loanId);
    }

    /// @notice 10 (reject): contractor declines the lender's offer. The loan ends;
    ///         a fresh request to the same lender is then possible.
    function rejectLoan(uint256 loanId) external onlyContractor {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Offered, "TH: not offered");
        l.state = LoanState.Rejected;
        emit LoanRejectedByContractor(loanId);
    }

    /// @notice 11: client approves -> collateral (token id order, small->large) moves to the lender.
    function approveLoanTransfer(uint256 loanId) external onlyClient notFrozen nonReentrant {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Accepted && l.contractorAccepted, "TH: not ready");
        l.clientApproved = true;
        _pullFinancing(contractor, l.lender, l.collateralAmount);
        l.state = LoanState.Transferred; // loan is complete on-chain
        emit LoanTransferred(loanId, l.lender, l.collateralAmount);
    }

    // --------------------------------------------------------------------- //
    //               15-16. DELIVERY & APPROVAL                               //
    // --------------------------------------------------------------------- //

    /**
     * @notice 15: contractor hands over the current stage with a report NFT. A
     *         standing rejection (if any) must first be accepted (or disputed).
     */
    function submitDelivery(string calldata reportURI, bytes32 reportHash)
        external onlyContractor notFrozen returns (uint256 reportDocId)
    {
        require(status == Status.Active, "TH: not active");
        require(currentMilestone < milestoneIds.length, "TH: all delivered");
        require(!deliveryRejected, "TH: accept the rejection first");
        require(amendState != AmendState.Rejected, "TH: resolve the amendment rejection first");
        uint256 id = milestoneIds[currentMilestone];
        tranches[id].delivered = true;
        deliveryPendingSince = block.timestamp;
        deliveryLateChargedDays = 0;
        reportDocId = _mintDocument(contractor, reportHash, reportURI, "report");
        emit DeliverySubmitted(id, reportDocId);
    }

    /// @notice 16: client approves the delivered stage WITH a reason NFT; its tokens become entitled.
    function approveDelivery(string calldata reasonURI, bytes32 reasonHash) external onlyClient notFrozen {
        require(currentMilestone < milestoneIds.length, "TH: nothing to approve");
        uint256 id = milestoneIds[currentMilestone];
        require(tranches[id].delivered, "TH: not delivered");
        uint256 docId = _mintDocument(client, reasonHash, reasonURI, "delivery-approval");
        emit DeliveryApproved(id, docId);
        _approveCurrentMilestone();
    }

    /// @notice 16 (reject): client rejects the delivery with a reason NFT.
    function rejectDelivery(string calldata reasonURI, bytes32 reasonHash) external onlyClient notFrozen {
        require(currentMilestone < milestoneIds.length, "TH: nothing to reject");
        uint256 id = milestoneIds[currentMilestone];
        require(tranches[id].delivered, "TH: not delivered");
        tranches[id].delivered = false; // contractor must accept-and-redeliver or dispute
        deliveryPendingSince = 0;
        deliveryRejected = true;
        uint256 docId = _mintDocument(client, reasonHash, reasonURI, "delivery-rejection");
        emit DeliveryRejected(id, docId);
    }

    /// @notice The contractor accepts a delivery rejection (acknowledges it) so they
    ///         may re-deliver. If they disagree instead, they call the arbiter.
    function acceptDeliveryRejection() external onlyContractor notFrozen {
        require(deliveryRejected, "TH: no rejection to accept");
        deliveryRejected = false;
        emit DeliveryRejectionAccepted(milestoneIds[currentMilestone]);
    }

    // --------------------------------------------------------------------- //
    //          17-21. ARBITER DISPUTES (subject-scoped), FREEZE, APPEAL      //
    // --------------------------------------------------------------------- //

    /**
     * @notice 17/24: a party calls the arbiter on a specific pending subject.
     *         The arbiter fee (separate money) is paid into Escrow and an equal
     *         batch of fee tokens is minted to the arbiter. The contract freezes.
     */
    /**
     * @notice 17/24: a party calls the arbiter. NO subject is chosen — it is
     *         derived from the one thing this caller can currently dispute (a
     *         rejection of their delivery / amendment / cancellation request), so
     *         the arbiter unambiguously knows what they are deciding.
     */
    function callArbiter(uint256 feeAmount, string calldata complaintURI, bytes32 complaintHash)
        external onlyParty notFrozen returns (uint256 disputeId)
    {
        require(arbiter != address(0), "TH: no arbiter");
        require(feeAmount > 0, "TH: fee required");

        Subject subject;
        if (deliveryRejected && msg.sender == contractor) subject = Subject.Delivery;
        else if (amendState == AmendState.Rejected && msg.sender == amendProposer) subject = Subject.Amendment;
        else if (cancelRefused && msg.sender == cancelRequester) subject = Subject.Cancellation;
        else revert("TH: nothing to dispute");

        uint256 feeId = nextTokenId++;
        tranches[feeId] = Tranche(TrancheKind.ArbiterFee, feeAmount, 0, false, false, arbiter);
        _bypass = true;
        _mint(arbiter, feeId, feeAmount, "");
        _bypass = false;
        escrowBalance += feeAmount;
        emit EscrowDeposited(feeAmount, "arbiter-fee");

        uint256 complaintId = _mintDocument(arbiter, complaintHash, complaintURI, "complaint");
        disputes.push(Dispute(subject, msg.sender, arbiter, feeId, feeAmount, complaintId, 0, address(0), 0, DisputeState.Open, false, false));
        disputeId = disputes.length - 1;
        activeDisputeId = disputeId + 1;
        disputeActive = true;
        _setFrozen(true);
        emit ArbiterCalled(disputeId, subject, msg.sender, feeId, feeAmount);
    }

    function issueRuling(string calldata rulingURI, bytes32 rulingHash, address winner) external onlyArbiter {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.arbiter == msg.sender && d.state == DisputeState.Open, "TH: not your open dispute");
        require(winner == client || winner == contractor, "TH: winner must be a party");
        d.winner = winner;
        d.rulingDocId = _mintDocument(msg.sender, rulingHash, rulingURI, "ruling");
        d.rulingTime = block.timestamp;
        d.state = DisputeState.Ruled;
        emit RulingIssued(activeDisputeId - 1, winner, d.rulingDocId);
    }

    /// @notice 19: a party accepts the ruling; when both accept it is applied at once.
    function respondToRuling(bool accept) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");
        require(accept, "TH: use appeal() to contest");
        if (msg.sender == client) d.clientAccepted = true;
        else d.contractorAccepted = true;
        emit RulingResponded(activeDisputeId - 1, msg.sender, true);
        if (d.clientAccepted && d.contractorAccepted) _applyRuling();
    }

    /// @notice After 7 days with no appeal, the ruling auto-finalizes (the bank/UI triggers this).
    function finalizeRuling() external {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");
        require(block.timestamp >= d.rulingTime + APPEAL_WINDOW, "TH: appeal window open");
        _applyRuling();
    }

    /// @notice 20: appeal (Delivery/Amendment only). Cancellation rulings are final.
    ///         Only the LOSING party may appeal — the party ruled correct cannot.
    ///         The appellant becomes the successor dispute's initiator and pays its fee.
    function appeal(address newArbiter) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");
        require(d.subject != Subject.Cancellation, "TH: cancellation is final");
        require(msg.sender != d.winner, "TH: the winning party cannot appeal");
        require(block.timestamp < d.rulingTime + APPEAL_WINDOW, "TH: appeal window closed");
        // A fresh arbiter: not any existing role (incl. the outgoing arbiter) nor pending contractor.
        require(newArbiter != address(0) && !_isRole(newArbiter) && newArbiter != pendingContractor, "TH: bad arbiter");

        d.state = DisputeState.Appealed;
        pendingArbiter = newArbiter;
        arbiterNominator = msg.sender; // appellant named the new arbiter -> counter-party approves
        contractorApprovedArbiter = false;
        // initiator = the appellant (they pay the new arbiter's fee).
        disputes.push(Dispute(d.subject, msg.sender, address(0), 0, 0, d.complaintDocId, 0, address(0), 0, DisputeState.Open, false, false));
        uint256 newId = disputes.length - 1;
        activeDisputeId = newId + 1;
        emit DisputeAppealed(newId - 1, newId);
        emit ArbiterInvited(newArbiter);
    }

    /// @notice Fund the appeal arbiter's fee — paid by the APPELLANT (the one who appealed).
    function fundAppealArbiter(uint256 feeAmount) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Open && d.feeTokenId == 0, "TH: already funded");
        require(msg.sender == d.initiator, "TH: only the appellant pays");
        require(d.arbiter != address(0), "TH: bind arbiter first");
        require(feeAmount > 0, "TH: fee required");
        uint256 feeId = nextTokenId++;
        tranches[feeId] = Tranche(TrancheKind.ArbiterFee, feeAmount, 0, false, false, d.arbiter);
        _bypass = true;
        _mint(d.arbiter, feeId, feeAmount, "");
        _bypass = false;
        escrowBalance += feeAmount;
        d.feeTokenId = feeId;
        d.feeAmount = feeAmount;
        emit ArbiterCalled(activeDisputeId - 1, d.subject, msg.sender, feeId, feeAmount);
    }

    /**
     * @dev Applies the active ruling to its specific subject only. The losing
     *      party pays the arbiter fee as a fine (to the winner). Every arbiter in
     *      the chain is paid (their fee tokens become entitled).
     */
    function _applyRuling() private {
        uint256 resolvedId = activeDisputeId - 1;
        Dispute storage d = disputes[resolvedId];
        d.state = DisputeState.Resolved;
        disputeActive = false;
        activeDisputeId = 0;

        for (uint256 i = 0; i < disputes.length; i++) {
            uint256 feeId = disputes[i].feeTokenId;
            if (feeId != 0) tranches[feeId].entitled = true;
        }

        address winner = d.winner;
        address loser = winner == client ? contractor : client;
        bool doCancel = false;

        // Resolve the subject.
        if (d.subject == Subject.Delivery) {
            deliveryRejected = false;
            if (winner == contractor && currentMilestone < milestoneIds.length) {
                tranches[milestoneIds[currentMilestone]].delivered = true;
                _approveCurrentMilestone();
            }
            // winner == client -> the rejection simply stands
        } else if (d.subject == Subject.Amendment) {
            if (winner == amendProposer) _applyStagedAmendment();
            else _clearAmendment();
        } else if (d.subject == Subject.Cancellation) {
            if (winner == cancelRequester) {
                doCancel = true;
            } else {
                cancelRequested = false;
                cancelRefused = false;
                cancelRequester = address(0);
            }
        }

        // The loser pays the fee as a fine to the winner (applied before any cancel
        // so the penalty/credit lands while balances still exist). A fine is a
        // one-off (overdue=false) so it never suspends — the contract stays Active.
        if (loser == contractor) _penalizeContractor(d.feeAmount, false);
        else _penalizeClient(d.feeAmount);

        _setFrozen(false);
        if (doCancel) _cancel();
        emit DisputeResolved(resolvedId, d.subject, winner);
    }

    // --------------------------------------------------------------------- //
    //              22-23. AMENDMENTS (stage -> the other party approves)      //
    // --------------------------------------------------------------------- //

    /**
     * @notice 22: EITHER party proposes a concrete (increase-only) amendment with
     *         a reason NFT — extra funding/time on existing milestones and/or new
     *         milestones. The proposer implicitly approves; the OTHER party then
     *         confirms. Blocked while a delivery rejection is unresolved.
     */
    function stageAmendment(
        string calldata reasonURI,
        bytes32 reasonHash,
        uint256[] calldata topUpIdx,
        uint256[] calldata topUpAmount,
        uint256[] calldata topUpExtraDays,
        uint256[] calldata newAmounts,
        uint256[] calldata newDeadlineDays
    ) external onlyParty {
        require(amendState == AmendState.None, "TH: amendment in progress");
        require(status == Status.Active || status == Status.Suspended, "TH: not amendable");
        require(!deliveryRejected, "TH: resolve the delivery rejection first");

        _storeStaged(topUpIdx, topUpAmount, topUpExtraDays, newAmounts, newDeadlineDays);
        amendProposer = msg.sender;
        amendDocId = _mintDocument(msg.sender, reasonHash, reasonURI, "amendment");
        amendState = AmendState.Staged;
        amendPendingSince = block.timestamp;
        amendLateChargedDays = 0;
        emit AmendmentStaged();
    }

    /// @dev Validate + store the staged amendment arrays (kept separate to ease stack).
    function _storeStaged(
        uint256[] calldata topUpIdx,
        uint256[] calldata topUpAmount,
        uint256[] calldata topUpExtraDays,
        uint256[] calldata newAmounts,
        uint256[] calldata newDeadlineDays
    ) private {
        require(topUpIdx.length == topUpAmount.length && topUpIdx.length == topUpExtraDays.length, "TH: bad topups");
        require(newAmounts.length == newDeadlineDays.length, "TH: bad new milestones");
        require(topUpIdx.length > 0 || newAmounts.length > 0, "TH: empty amendment");
        // Cannot top up a milestone that is already completed (approved/burned).
        for (uint256 i = 0; i < topUpIdx.length; i++) {
            require(topUpIdx[i] >= currentMilestone && topUpIdx[i] < milestoneIds.length, "TH: milestone already completed");
        }
        stagedAddIdx = topUpIdx;
        stagedAddAmt = topUpAmount;
        stagedAddDays = topUpExtraDays;
        stagedMsAmounts = newAmounts;
        stagedMsDays = newDeadlineDays;
    }

    /**
     * @notice 23: the OTHER party (not the proposer) approves or rejects. The
     *         proposer already approved by staging. On rejection the proposer must
     *         accept it (to retry) or call the arbiter.
     */
    function respondToAmendment(bool approve) external onlyParty {
        require(amendState == AmendState.Staged, "TH: nothing staged");
        require(msg.sender != amendProposer, "TH: proposer already approved");
        if (approve) _applyStagedAmendment();
        else {
            amendState = AmendState.Rejected; // proposer may accept-and-retry or dispute
            emit AmendmentResolved(false);
        }
    }

    /// @notice The proposer accepts a rejected amendment (acknowledges it) so they
    ///         may propose afresh. If they disagree instead, they call the arbiter.
    function acceptAmendmentRejection() external onlyParty {
        require(amendState == AmendState.Rejected, "TH: nothing rejected");
        require(msg.sender == amendProposer, "TH: only the proposer");
        _clearAmendment();
        emit AmendmentResolved(false);
    }

    // --------------------------------------------------------------------- //
    //                 Cancellation (either party)                            //
    // --------------------------------------------------------------------- //

    /**
     * @notice A party requests cancellation. Only valid within 7 days after the
     *         current milestone's deadline (or any time while Suspended).
     */
    function requestCancellation() external onlyParty {
        require(status == Status.Active || status == Status.Suspended, "TH: not cancellable");
        require(!cancelRequested, "TH: already requested");
        if (status == Status.Active) {
            uint256 dl = effectiveDeadline(currentMilestone);
            require(block.timestamp >= dl && block.timestamp <= dl + CANCEL_WINDOW, "TH: outside cancel window");
        }
        cancelRequested = true;
        cancelRequester = msg.sender;
        emit CancellationRequested(msg.sender);
    }

    /// @notice The counter-party accepts (cancel) or refuses (requester may call the arbiter).
    function respondCancellation(bool accept) external onlyParty {
        require(cancelRequested && !cancelRefused, "TH: no open request");
        require(msg.sender != cancelRequester, "TH: requester cannot self-answer");
        if (accept) _cancel();
        else {
            cancelRefused = true;
            emit CancellationResolved(false);
        }
    }

    // --------------------------------------------------------------------- //
    //               25. REDEEM / ESCROW                                      //
    // --------------------------------------------------------------------- //

    /**
     * @notice The Client funds the tender Escrow. Funding first repays any
     *         outstanding bank-cover debt (₮-for-₮); only the remainder adds to
     *         the spendable Escrow balance.
     */
    function fundEscrow(uint256 amount) external onlyClient {
        require(amount > 0, "TH: zero");
        if (escrowDebt >= amount) {
            escrowDebt -= amount;
        } else {
            uint256 remainder = amount - escrowDebt;
            escrowDebt = 0;
            escrowBalance += remainder;
        }
        emit EscrowFunded(msg.sender, amount);
        emit EscrowDeposited(amount, "client-funding");
    }

    /// @notice The oracle (bank) may report/correct the Escrow figures.
    function reportEscrow(uint256 balance, uint256 reserve) external onlyOracle {
        escrowBalance = balance;
        escrowReserve = reserve;
        emit EscrowReported(balance, reserve);
    }

    /**
     * @notice 25: a holder requests to redeem entitled, active tokens. The tokens
     *         enter a pending-swap lock (they cannot move) until the bank settles.
     */
    function redeem(uint256 tokenId, uint256 amount) external notFrozen returns (uint256 reqId) {
        require(tokenId < DOC_ID_BASE && tranches[tokenId].amount > 0, "TH: not a financing token");
        require(tranches[tokenId].entitled, "TH: not entitled");
        require(amount > 0 && _free(msg.sender, tokenId) >= amount, "TH: insufficient free balance");
        pendingRedeem[msg.sender][tokenId] += amount;
        redemptions.push(Redemption(msg.sender, tokenId, amount, block.timestamp, false));
        reqId = redemptions.length - 1;
        emit RedemptionRequested(reqId, msg.sender, tokenId, amount);
    }

    /**
     * @notice The bank settles a redemption: burns the tokens and pays out.
     *   - Collateral tokens draw against the reserve.
     *   - Other tokens draw above the reserve; if Escrow is short the bank covers
     *     it IMMEDIATELY by lending to the account owner (the Client). The loan's
     *     interest / grace is handled off-chain — simpler and clearer.
     */
    function settleRedemption(uint256 reqId) external onlyOracle nonReentrant {
        Redemption storage r = redemptions[reqId];
        require(!r.settled, "TH: already settled");
        require(!frozen, "TH: contract frozen");
        require(balanceOf(r.holder, r.tokenId) >= r.amount, "TH: holder lacks tokens");

        bool isCollateral = tranches[r.tokenId].kind == TrancheKind.Collateral;
        bool viaBankCover = false;

        if (isCollateral) {
            require(escrowBalance >= r.amount, "TH: escrow short");
            escrowBalance -= r.amount;
            escrowReserve = escrowReserve >= r.amount ? escrowReserve - r.amount : 0;
        } else {
            uint256 available = escrowBalance > escrowReserve ? escrowBalance - escrowReserve : 0;
            if (available >= r.amount) {
                escrowBalance -= r.amount;
            } else {
                // Escrow short -> draw what's available above the reserve; the bank
                // instantly lends the shortfall to the Client (recorded as debt).
                viaBankCover = true;
                escrowBalance -= available;
                escrowDebt += (r.amount - available);
            }
        }

        r.settled = true;
        pendingRedeem[r.holder][r.tokenId] -= r.amount;
        _bypass = true;
        _burn(r.holder, r.tokenId, r.amount);
        _bypass = false;
        emit RedemptionSettled(reqId, r.holder, r.amount, viaBankCover);
    }

    // --------------------------------------------------------------------- //
    //               PENALTY ENGINE (automatic, day-based)                    //
    // --------------------------------------------------------------------- //

    function penaltyPerDay() public view returns (uint256) {
        return (totalFinancing * PENALTY_BPS) / 10000; // 0.02%, integer
    }

    /**
     * @notice Assess and apply all accrued penalties up to now. Idempotent and
     *         callable by anyone (the UI calls it on every refresh). EVM cannot
     *         self-trigger on time, so this is the trigger.
     */
    function assessPenalties() public {
        if (status != Status.Active || frozen) return;
        uint256 ppd = penaltyPerDay();
        if (ppd == 0) return;

        // 1) Current milestone overdue -> contractor penalty, but ONLY while the
        //    contractor has not yet delivered it. Once delivered (awaiting the
        //    client's approval) the fault shifts to the client (branch 2).
        if (currentMilestone < milestoneIds.length && deliveryPendingSince == 0) {
            uint256 dl = effectiveDeadline(currentMilestone);
            if (block.timestamp > dl) {
                uint256 daysOver = (block.timestamp - dl) / 1 days;
                uint256 newDays = daysOver - overdueChargedDays[currentMilestone];
                if (newDays > 0) {
                    overdueChargedDays[currentMilestone] = daysOver;
                    _penalizeContractor(newDays * ppd, true); // overdue -> counts toward suspension
                }
            }
        }

        // 2) Delivery awaiting client approval past the grace period -> client penalty.
        if (status == Status.Active && deliveryPendingSince != 0) {
            uint256 startAt = deliveryPendingSince + APPROVAL_GRACE;
            if (block.timestamp > startAt) {
                uint256 d = (block.timestamp - startAt) / 1 days;
                uint256 nd = d - deliveryLateChargedDays;
                if (nd > 0) {
                    deliveryLateChargedDays = d;
                    _penalizeClient(nd * ppd);
                }
            }
        }

        // 3) Staged amendment awaiting approval past the grace -> the non-approving
        //    party(ies) are at fault (both parties must approve).
        if (status == Status.Active && amendState == AmendState.Staged && amendPendingSince != 0) {
            uint256 startAt = amendPendingSince + APPROVAL_GRACE;
            if (block.timestamp > startAt) {
                uint256 d = (block.timestamp - startAt) / 1 days;
                uint256 nd = d - amendLateChargedDays;
                if (nd > 0) {
                    amendLateChargedDays = d;
                    // Only the non-proposer's approval is awaited -> they are at fault.
                    if (amendProposer == client) _penalizeContractor(nd * ppd, false);
                    else _penalizeClient(nd * ppd);
                }
            }
        }
    }

    // --------------------------------------------------------------------- //
    //                          VIEWS                                         //
    // --------------------------------------------------------------------- //

    function milestoneCount() external view returns (uint256) { return milestoneIds.length; }
    function loanCount() external view returns (uint256) { return loans.length; }
    function disputeCount() external view returns (uint256) { return disputes.length; }
    function redemptionCount() external view returns (uint256) { return redemptions.length; }

    /// @notice Free (non-pending) balance a holder can transfer or redeem.
    function freeBalance(address account, uint256 tokenId) external view returns (uint256) {
        return _free(account, tokenId);
    }

    /// @notice Absolute deadline (seconds) of a milestone, shifted by paused time.
    function effectiveDeadline(uint256 milestoneIndex) public view returns (uint256) {
        if (activatedAt == 0 || milestoneIndex >= milestoneIds.length) return 0;
        return activatedAt + tranches[milestoneIds[milestoneIndex]].deadlineDays * 1 days + _pausedTotal();
    }

    function roleOf(address account) external view returns (Role) {
        if (account == client) return Role.Client;
        if (account == contractor) return Role.Contractor;
        if (account == arbiter) return Role.Arbiter;
        return Role.None;
    }

    function uri(uint256 id) public view override returns (string memory) {
        if (id >= DOC_ID_BASE) return documents[id].uri;
        return "";
    }

    // --------------------------------------------------------------------- //
    //                          INTERNALS                                     //
    // --------------------------------------------------------------------- //

    function _approveCurrentMilestone() private {
        uint256 id = milestoneIds[currentMilestone];
        tranches[id].entitled = true;
        deliveryPendingSince = 0;
        deliveryRejected = false;
        currentMilestone++;
        if (currentMilestone == milestoneIds.length) {
            status = Status.Completed;
            completedAt = block.timestamp; // warranty period starts now
        }
        emit DeliveryApproved(id, 0);
    }

    /**
     * @notice After successful completion AND the warranty period, the collateral
     *         bond is returned to the contractor (transferred from the client and
     *         made redeemable). Anyone may trigger it; the bank automates it.
     */
    function releaseWarranty() external nonReentrant {
        require(status == Status.Completed, "TH: not completed");
        require(collateralTokenId != 0 && !tranches[collateralTokenId].entitled, "TH: nothing to release");
        require(block.timestamp >= completedAt + warrantyDays * 1 days, "TH: warranty period running");
        uint256 amt = tranches[collateralTokenId].amount;
        uint256 bal = balanceOf(client, collateralTokenId);
        if (bal > 0) _internalTransfer(client, contractor, collateralTokenId, bal);
        tranches[collateralTokenId].entitled = true;
        tranches[collateralTokenId].beneficiary = contractor;
        escrowReserve = escrowReserve >= amt ? escrowReserve - amt : 0;
        emit WarrantyReleased(collateralTokenId);
    }

    function _applyStagedAmendment() private {
        _bypass = true;
        for (uint256 i = 0; i < stagedAddIdx.length; i++) {
            uint256 idx = stagedAddIdx[i];
            // Re-check: the milestone may have completed between staging and approval.
            require(idx >= currentMilestone && idx < milestoneIds.length, "TH: milestone already completed");
            uint256 id = milestoneIds[idx];
            if (stagedAddAmt[i] > 0) {
                tranches[id].amount += stagedAddAmt[i];
                totalFinancing += stagedAddAmt[i];
                _mint(contractor, id, stagedAddAmt[i], "");
            }
            tranches[id].deadlineDays += stagedAddDays[i];
        }
        for (uint256 i = 0; i < stagedMsAmounts.length; i++) {
            require(stagedMsAmounts[i] > 0, "TH: zero milestone");
            uint256 id = nextTokenId++;
            tranches[id] = Tranche(TrancheKind.Milestone, stagedMsAmounts[i], stagedMsDays[i], false, false, contractor);
            milestoneIds.push(id);
            totalFinancing += stagedMsAmounts[i];
            _mint(contractor, id, stagedMsAmounts[i], "");
        }
        _bypass = false;
        if (status == Status.Completed && stagedMsAmounts.length > 0) status = Status.Active;
        if (status == Status.Suspended) _resume(); // amendment cures the suspension
        _clearAmendment();
        emit AmendmentResolved(true);
        emit FundingAmended(totalFinancing);
    }

    function _clearAmendment() private {
        amendState = AmendState.None;
        amendProposer = address(0);
        amendPendingSince = 0;
        delete stagedAddIdx;
        delete stagedAddAmt;
        delete stagedAddDays;
        delete stagedMsAmounts;
        delete stagedMsDays;
    }

    /**
     * @dev Contractor penalty: burn from the current milestone (contractor, then
     *      any lenders holding it) and re-mint entitled Penalty tokens to the
     *      Client. Only OVERDUE penalties count toward the half-milestone
     *      suspension; one-off fines (e.g. losing a dispute) never suspend, so a
     *      resolved dispute always leaves the contract Active.
     */
    function _penalizeContractor(uint256 amount, bool overdue) private {
        if (amount == 0 || currentMilestone >= milestoneIds.length) return;
        uint256 id = milestoneIds[currentMilestone];
        uint256 collected = _burnDownMilestone(id, amount);
        if (collected > 0) {
            uint256 pid = nextTokenId++;
            tranches[pid] = Tranche(TrancheKind.Penalty, collected, 0, true, false, client);
            _bypass = true;
            _mint(client, pid, collected, "");
            _bypass = false;
            emit PenaltyContractor(collected, pid);
            if (overdue) {
                milestonePenalty[currentMilestone] += collected;
                uint256 mAmount = tranches[id].amount; // original milestone amount
                if (mAmount > 0 && milestonePenalty[currentMilestone] * 2 >= mAmount && status == Status.Active) {
                    _suspend("penalty exceeded half the milestone");
                }
            }
        }
    }

    /// @dev Client penalty: mint entitled Penalty tokens to the Contractor.
    function _penalizeClient(uint256 amount) private {
        if (amount == 0) return;
        uint256 pid = nextTokenId++;
        tranches[pid] = Tranche(TrancheKind.Penalty, amount, 0, true, false, contractor);
        _bypass = true;
        _mint(contractor, pid, amount, "");
        _bypass = false;
        emit PenaltyClient(amount, pid);
    }

    /// @dev Burns up to `amount` of milestone `id` from the contractor first, then
    ///      from any lender that holds it (pledged collateral is clawed back too).
    function _burnDownMilestone(uint256 id, uint256 amount) private returns (uint256 collected) {
        uint256 remaining = amount;
        uint256 cb = balanceOf(contractor, id);
        uint256 take = cb < remaining ? cb : remaining;
        if (take > 0) {
            _bypass = true;
            _burn(contractor, id, take);
            _bypass = false;
            remaining -= take;
            collected += take;
        }
        for (uint256 i = 0; i < loans.length && remaining > 0; i++) {
            address lender = loans[i].lender;
            uint256 lb = balanceOf(lender, id);
            if (lb == 0) continue;
            take = lb < remaining ? lb : remaining;
            _bypass = true;
            _burn(lender, id, take);
            _bypass = false;
            remaining -= take;
            collected += take;
        }
    }

    /// @dev Total free (non-pending) financing tokens (advance + milestones) held by `who`.
    function _financingFree(address who) private view returns (uint256 sum) {
        if (advanceTokenId != 0) sum += _free(who, advanceTokenId);
        for (uint256 i = 0; i < milestoneIds.length; i++) sum += _free(who, milestoneIds[i]);
    }

    /// @dev Move `amount` of financing tokens from `from` to `to`, drawn in token-id
    ///      order (advance first, then milestones ascending). The receiver ends up
    ///      with whatever mix of ids sums to `amount`.
    function _pullFinancing(address from, address to, uint256 amount) private {
        uint256 remaining = amount;
        if (advanceTokenId != 0 && remaining > 0) {
            remaining = _moveSome(from, to, advanceTokenId, remaining);
        }
        for (uint256 i = 0; i < milestoneIds.length && remaining > 0; i++) {
            remaining = _moveSome(from, to, milestoneIds[i], remaining);
        }
        require(remaining == 0, "TH: insufficient financing");
    }

    function _moveSome(address from, address to, uint256 id, uint256 remaining) private returns (uint256) {
        uint256 avail = _free(from, id);
        uint256 take = avail < remaining ? avail : remaining;
        if (take > 0) _internalTransfer(from, to, id, take);
        return remaining - take;
    }

    function _hasOpenLoan(address lender) private view returns (bool) {
        for (uint256 i = 0; i < loans.length; i++) {
            if (loans[i].lender == lender && loans[i].state != LoanState.Rejected) return true;
        }
        return false;
    }

    function _cancel() private {
        // The collateral (already held by the Client) becomes redeemable for the
        // Client to recover the loss; the Escrow reserve is released.
        if (collateralTokenId != 0) {
            tranches[collateralTokenId].entitled = true;
            tranches[collateralTokenId].beneficiary = client;
        }
        escrowReserve = 0;
        if (status == Status.Suspended) _resume(); // unpause the clock bookkeeping
        status = Status.Cancelled;
        _enterPause(); // freeze the deadline clock permanently
        cancelRequested = false;
        cancelRefused = false;
        emit CancellationResolved(true);
    }

    function _suspend(string memory reason) private {
        status = Status.Suspended;
        _enterPause();
        emit Suspended(reason);
    }

    function _resume() private {
        _exitPause();
        status = Status.Active;
        emit Resumed();
    }

    function _enterPause() private {
        if (pausedSince == 0) pausedSince = block.timestamp;
    }

    function _exitPause() private {
        if (pausedSince != 0) {
            pausedAccum += block.timestamp - pausedSince;
            pausedSince = 0;
        }
    }

    function _pausedTotal() private view returns (uint256) {
        return pausedAccum + (pausedSince != 0 ? block.timestamp - pausedSince : 0);
    }

    /// @dev True if `a` already holds any role, so no address can be two roles.
    function _isRole(address a) private view returns (bool) {
        return a == client || a == contractor || a == arbiter || a == oracle;
    }

    function _free(address account, uint256 tokenId) private view returns (uint256) {
        uint256 bal = balanceOf(account, tokenId);
        uint256 locked = pendingRedeem[account][tokenId];
        return bal > locked ? bal - locked : 0;
    }

    function _mintDocument(address to, bytes32 hash, string memory docURI, string memory docType)
        private returns (uint256 id)
    {
        id = nextDocId++;
        documents[id] = Document(hash, docURI, block.timestamp, msg.sender, docType);
        _bypass = true;
        _mint(to, id, 1, "");
        _bypass = false;
        emit DocumentMinted(id, to, docType, hash, docURI);
    }

    function _internalTransfer(address from, address to, uint256 id, uint256 amount) private {
        _bypass = true;
        _safeTransferFrom(from, to, id, amount, "");
        _bypass = false;
    }

    function _setFrozen(bool value) private {
        if (value && !frozen) {
            frozen = true;
            _enterPause();
        } else if (!value && frozen) {
            frozen = false;
            _exitPause();
        }
        emit FrozenStateChanged(value);
    }

    /**
     * @dev Transfer restriction: only the Client or the Contractor may move
     *      financing tokens, transfers are blocked while frozen, pending-redeem
     *      tokens are locked, and direct burns are disallowed (use {redeem}).
     */
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal override
    {
        if (!_bypass) {
            bool isMint = from == address(0);
            bool isBurn = to == address(0);
            require(!isBurn, "TH: use redeem to burn");
            if (!isMint) {
                require(!frozen, "TH: contract frozen");
                require(from == client || from == contractor, "TH: transfer not allowed");
                for (uint256 i = 0; i < ids.length; i++) {
                    if (ids[i] < DOC_ID_BASE) {
                        // The collateral bond is non-transferable (only contract-orchestrated moves).
                        require(ids[i] != collateralTokenId, "TH: collateral non-transferable");
                        require(balanceOf(from, ids[i]) - pendingRedeem[from][ids[i]] >= values[i], "TH: tokens locked");
                    }
                }
            }
        }
        super._update(from, to, ids, values);
    }
}
