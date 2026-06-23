// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenderHub
 * @notice Transparent, fair execution of a single public tender on-chain.
 *
 * One TenderHub is deployed per tender by the Захиалагч (Client). It is an
 * ERC-1155 that carries two kinds of tokens:
 *
 *   1. FINANCING / FEE TOKENS (fungible batches, ids 1..). One token == 1 ₮.
 *      Each "tranche" (advance / milestone / arbiter-fee) gets a unique id.
 *      They represent the right to draw money from the bank Escrow account.
 *
 *   2. DOCUMENT NFTs (non-fungible, ids >= DOC_ID_BASE). Every contract, report,
 *      complaint, ruling, loan-term and amendment is anchored as a 1-of-1 token
 *      carrying {hash, uri, timestamp, submitter}.
 *
 * TOKEN STATES (per the spec):
 *   - Active / Inactive  -> the global `frozen` flag. Set while an arbiter is
 *     handling a dispute: no transfers, no redemptions, the deadline clock stops.
 *   - Entitled / Not     -> per-tranche `entitled` flag. Becomes true when a
 *     milestone is approved (advance is entitled at activation). Entitled tokens
 *     may be redeemed for money.
 *   - Paid               -> redemption burns the tokens.
 *
 * The bank Escrow is a real off-chain account. An `oracle` (the bank) reports
 * collateral deposits, the escrow balance, and settles redemptions.
 */
contract TenderHub is ERC1155, ReentrancyGuard {
    // --------------------------------------------------------------------- //
    //                              TYPES                                     //
    // --------------------------------------------------------------------- //

    enum Role {
        None,
        Client, // Захиалагч
        Contractor, // Гүйцэтгэгч
        Arbiter // Арбитр
    }

    enum Status {
        Draft, // deployed, configuring
        Awaiting, // contractor invited, awaiting acceptance
        Active, // work in progress, clock running
        Completed, // all milestones approved
        Cancelled
    }

    enum TrancheKind {
        Advance, // урьдчилгаа
        Milestone, // шатлал
        ArbiterFee // арбитрын цалин (money separate from the financing)
    }

    enum LoanState {
        None,
        Requested, // contractor asked a lender
        Offered, // lender sent terms + collateral amount
        Accepted, // contractor accepted, waiting for client multisig
        CollateralLocked, // client approved, collateral moved to lender
        Funded, // lender released the money off-chain
        Repaid, // contractor repaid off-chain
        Closed, // collateral returned to contractor
        Rejected
    }

    enum DisputeState {
        None,
        Open, // arbiter called, awaiting ruling
        Ruled, // ruling issued, 7-day appeal window running
        Resolved, // accepted / window passed -> applied
        Appealed // superseded by a new dispute
    }

    struct Tranche {
        TrancheKind kind;
        uint256 amount; // tokens minted (== ₮)
        uint256 deadlineOffset; // seconds after activation (0 if N/A)
        bool entitled; // redeemable for money
        bool delivered; // contractor handed this milestone over
        address beneficiary; // who the tokens were minted to
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
        uint256 tokenId; // collateral tranche id
        uint256 requestedAmount; // contractor's ask
        uint256 collateralAmount; // lender's required collateral (<= requested)
        uint256 termsDocId;
        uint256 contractDocId; // tender NFT auto-attached
        string lenderBank; // where the loan money / repayment flows
        LoanState state;
        bool contractorAccepted;
        bool clientApproved;
    }

    struct Dispute {
        address initiator;
        address arbiter;
        uint256 feeTokenId; // arbiter-fee tranche
        uint256 feeAmount;
        uint256 complaintDocId;
        uint256 rulingDocId;
        address winner; // arbiter's chosen correct party
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
    uint256 public constant BANK_COVER_DELAY = 1 days;

    // Roles
    address public immutable client;
    address public contractor;
    address public arbiter; // current arbiter
    address public oracle; // the bank

    // Pending arbiter appointment (functions 5/6/7 & 21)
    address public pendingArbiter;
    bool public contractorApprovedArbiter;

    // Pending contractor invite
    address public pendingContractor;
    bool public collateralConfirmed; // oracle says contractor posted collateral

    // Lifecycle
    Status public status;
    bool public frozen;
    uint256 public activatedAt;
    uint256 public totalFrozenDuration;
    uint256 private frozenAt;

    // Escrow / bank
    string public escrowAccount;
    uint256 public escrowBalance; // last value reported by the oracle

    // Document NFTs
    uint256 public nextDocId = DOC_ID_BASE;
    uint256 public contractDocId; // the tender contract NFT
    mapping(uint256 => Document) public documents;

    // Financing / fee tranches
    uint256 public nextTokenId = 1;
    mapping(uint256 => Tranche) public tranches;
    uint256 public advanceId; // 0 if no advance
    uint256[] public milestoneIds; // ordered
    uint256 public currentMilestone; // index into milestoneIds
    uint256 public totalFinancing;

    // Loans (functions 8-14)
    Loan[] public loans;

    // Disputes (functions 17-21, 24)
    Dispute[] public disputes;
    uint256 public activeDisputeId; // index+1; 0 == none
    bool public disputeActive;

    // Amendments (functions 22-23)
    bool public amendmentPending;
    address public amendmentProposer;
    uint256 public amendmentDocId;
    bool public amendmentApproved; // unlocks amendFunding once

    // Redemptions (function 25)
    Redemption[] public redemptions;

    // Holder bank details / consents
    mapping(address => string) public bankAccount;
    mapping(address => bool) public allowBankCover; // ok to be covered via owner's loan
    mapping(address => bool) public allowLoanCover;

    // Internal transfer/burn bypass for contract-orchestrated moves
    bool private _bypassRestrictions;

    // --------------------------------------------------------------------- //
    //                              EVENTS                                    //
    // --------------------------------------------------------------------- //

    event DocumentMinted(uint256 indexed id, address indexed to, string docType, bytes32 hash, string uri);
    event FundingDeclared(uint256 advanceId, uint256[] milestoneIds, uint256 totalFinancing);
    event FundingAmended(uint256 extraAdvance, uint256[] newMilestoneIds, uint256 totalFinancing);
    event ContractorInvited(address indexed contractor);
    event CollateralConfirmed();
    event ContractActivated(address indexed contractor, uint256 timestamp);
    event ArbiterInvited(address indexed arbiter);
    event ArbiterApprovedByContractor(address indexed arbiter);
    event ArbiterAccepted(address indexed arbiter);

    event LoanRequested(uint256 indexed loanId, address indexed lender, uint256 tokenId, uint256 amount);
    event LoanOffered(uint256 indexed loanId, uint256 collateralAmount, uint256 termsDocId);
    event LoanAcceptedByContractor(uint256 indexed loanId);
    event LoanCollateralLocked(uint256 indexed loanId);
    event LoanFunded(uint256 indexed loanId);
    event LoanRepaid(uint256 indexed loanId, string bank);
    event LoanClosed(uint256 indexed loanId);

    event DeliverySubmitted(uint256 indexed milestoneId, uint256 reportDocId);
    event DeliveryApproved(uint256 indexed milestoneId);

    event ArbiterCalled(uint256 indexed disputeId, address indexed initiator, uint256 feeTokenId, uint256 feeAmount);
    event RulingIssued(uint256 indexed disputeId, address indexed winner, uint256 rulingDocId);
    event RulingResponded(uint256 indexed disputeId, address indexed party, bool accepted);
    event DisputeResolved(uint256 indexed disputeId, address winner);
    event DisputeAppealed(uint256 indexed disputeId, uint256 indexed newDisputeId);

    event AmendmentProposed(address indexed proposer, uint256 docId);
    event AmendmentResolved(bool approved);

    event FrozenStateChanged(bool frozen);

    event EscrowReported(uint256 balance);
    event RedemptionRequested(uint256 indexed reqId, address indexed holder, uint256 tokenId, uint256 amount, string bankAccount);
    event RedemptionSettled(uint256 indexed reqId, address indexed holder, uint256 amount, bool viaBankCover);
    event BankAccountSet(address indexed holder, string account);

    // --------------------------------------------------------------------- //
    //                              MODIFIERS                                 //
    // --------------------------------------------------------------------- //

    modifier onlyClient() {
        require(msg.sender == client, "TH: only client");
        _;
    }

    modifier onlyContractor() {
        require(msg.sender == contractor, "TH: only contractor");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "TH: only arbiter");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "TH: only oracle");
        _;
    }

    modifier onlyParty() {
        require(msg.sender == client || msg.sender == contractor, "TH: only a party");
        _;
    }

    modifier notFrozen() {
        require(!frozen, "TH: contract frozen");
        _;
    }

    // --------------------------------------------------------------------- //
    //                       1. DEPLOY THE CONTRACT                           //
    // --------------------------------------------------------------------- //

    /**
     * @param contractURI metadata location of the legal contract
     * @param contractHash keccak/sha hash of the contract document
     * @param escrowAccount_ the tender's bank Escrow account number
     * @param oracle_ the bank oracle address
     */
    constructor(
        string memory contractURI,
        bytes32 contractHash,
        string memory escrowAccount_,
        address oracle_
    ) ERC1155("") {
        require(oracle_ != address(0), "TH: oracle required");
        client = msg.sender;
        escrowAccount = escrowAccount_;
        oracle = oracle_;
        status = Status.Draft;
        contractDocId = _mintDocument(msg.sender, contractHash, contractURI, "contract");
    }

    // --------------------------------------------------------------------- //
    //                  2. DECLARE FUNDING & DEADLINES                        //
    // --------------------------------------------------------------------- //

    /**
     * @notice Declare advance + per-milestone funding and deadlines (function 2).
     *         Advance + Σ milestones = total financing. Callable while the
     *         contract is still being configured (before activation).
     * @param advanceAmount optional advance (0 for none)
     * @param milestoneAmounts funding per stage
     * @param deadlineOffsets seconds from activation by which each stage is due
     */
    function declareFunding(
        uint256 advanceAmount,
        uint256[] calldata milestoneAmounts,
        uint256[] calldata deadlineOffsets
    ) external onlyClient {
        require(status == Status.Draft || status == Status.Awaiting, "TH: already active");
        require(milestoneIds.length == 0 && advanceId == 0, "TH: already declared");
        require(milestoneAmounts.length == deadlineOffsets.length, "TH: length mismatch");
        require(milestoneAmounts.length > 0, "TH: need a milestone");

        uint256 total;
        if (advanceAmount > 0) {
            advanceId = nextTokenId++;
            tranches[advanceId] = Tranche({
                kind: TrancheKind.Advance,
                amount: advanceAmount,
                deadlineOffset: 0,
                entitled: false,
                delivered: false,
                beneficiary: address(0)
            });
            total += advanceAmount;
        }

        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "TH: zero milestone");
            uint256 id = nextTokenId++;
            tranches[id] = Tranche({
                kind: TrancheKind.Milestone,
                amount: milestoneAmounts[i],
                deadlineOffset: deadlineOffsets[i],
                entitled: false,
                delivered: false,
                beneficiary: address(0)
            });
            milestoneIds.push(id);
            total += milestoneAmounts[i];
        }

        totalFinancing = total;
        emit FundingDeclared(advanceId, milestoneIds, total);
    }

    // --------------------------------------------------------------------- //
    //                       3. INVITE THE CONTRACTOR                         //
    // --------------------------------------------------------------------- //

    function inviteContractor(address contractor_) external onlyClient {
        require(status == Status.Draft || status == Status.Awaiting, "TH: too late");
        require(contractor_ != address(0) && contractor_ != client, "TH: bad contractor");
        pendingContractor = contractor_;
        status = Status.Awaiting;
        emit ContractorInvited(contractor_);
    }

    /// @notice Oracle confirms the contractor posted collateral to the Escrow (part of function 4).
    function confirmCollateral() external onlyOracle {
        require(pendingContractor != address(0), "TH: no contractor");
        collateralConfirmed = true;
        emit CollateralConfirmed();
    }

    // --------------------------------------------------------------------- //
    //               4. CONTRACTOR REVIEWS & ACTIVATES                        //
    // --------------------------------------------------------------------- //

    /**
     * @notice The invited contractor accepts the contract (function 4). Requires
     *         the bank oracle to have confirmed the collateral deposit. On
     *         acceptance the financing tokens are minted to the contractor, the
     *         advance becomes entitled and the deadline clock starts.
     */
    function acceptContract() external nonReentrant {
        require(msg.sender == pendingContractor, "TH: not the invited contractor");
        require(status == Status.Awaiting, "TH: not awaiting");
        require(collateralConfirmed, "TH: collateral not confirmed");
        require(totalFinancing > 0, "TH: funding not declared");

        contractor = msg.sender;
        status = Status.Active;
        activatedAt = block.timestamp;

        _bypassRestrictions = true;
        if (advanceId != 0) {
            tranches[advanceId].entitled = true; // advance is redeemable immediately
            tranches[advanceId].beneficiary = contractor;
            _mint(contractor, advanceId, tranches[advanceId].amount, "");
        }
        for (uint256 i = 0; i < milestoneIds.length; i++) {
            uint256 id = milestoneIds[i];
            tranches[id].beneficiary = contractor;
            _mint(contractor, id, tranches[id].amount, "");
        }
        _bypassRestrictions = false;

        emit ContractActivated(contractor, block.timestamp);
    }

    // --------------------------------------------------------------------- //
    //                5/6/7 & 21. APPOINT THE ARBITER                         //
    // --------------------------------------------------------------------- //

    /// @notice 5 & 21: client invites an arbiter.
    function inviteArbiter(address arbiter_) external onlyClient {
        require(arbiter_ != address(0) && arbiter_ != client && arbiter_ != contractor, "TH: bad arbiter");
        pendingArbiter = arbiter_;
        contractorApprovedArbiter = false;
        emit ArbiterInvited(arbiter_);
    }

    /// @notice 6 & 21: contractor approves the proposed arbiter.
    function approveArbiter() external onlyContractor {
        require(pendingArbiter != address(0), "TH: no pending arbiter");
        contractorApprovedArbiter = true;
        emit ArbiterApprovedByContractor(pendingArbiter);
    }

    /// @notice 7 & 21: the proposed arbiter accepts the role.
    function arbiterAccept() external {
        require(msg.sender == pendingArbiter, "TH: not the pending arbiter");
        require(contractorApprovedArbiter, "TH: contractor has not approved");
        arbiter = pendingArbiter; // a new arbiter takes over the role
        pendingArbiter = address(0);
        contractorApprovedArbiter = false;
        emit ArbiterAccepted(arbiter);
    }

    // --------------------------------------------------------------------- //
    //                 8-14. COLLATERALISED LOANS                             //
    // --------------------------------------------------------------------- //

    /// @notice 8: contractor requests a loan against `amount` of tranche `tokenId`.
    function requestLoan(address lender, uint256 tokenId, uint256 amount)
        external
        onlyContractor
        notFrozen
        returns (uint256 loanId)
    {
        require(lender != address(0) && lender != client && lender != contractor, "TH: bad lender");
        require(tranches[tokenId].amount > 0 && tokenId < DOC_ID_BASE, "TH: bad token");
        require(balanceOf(contractor, tokenId) >= amount && amount > 0, "TH: insufficient balance");

        loans.push(
            Loan({
                lender: lender,
                tokenId: tokenId,
                requestedAmount: amount,
                collateralAmount: 0,
                termsDocId: 0,
                contractDocId: contractDocId, // tender NFT auto-attached
                lenderBank: "",
                state: LoanState.Requested,
                contractorAccepted: false,
                clientApproved: false
            })
        );
        loanId = loans.length - 1;
        emit LoanRequested(loanId, lender, tokenId, amount);
    }

    /// @notice 9: lender offers terms (as an NFT) and the collateral it wants.
    function offerLoan(
        uint256 loanId,
        string calldata termsURI,
        bytes32 termsHash,
        uint256 collateralAmount
    ) external {
        Loan storage l = loans[loanId];
        require(msg.sender == l.lender, "TH: only the lender");
        require(l.state == LoanState.Requested, "TH: not requestable");
        require(collateralAmount > 0 && collateralAmount <= l.requestedAmount, "TH: bad collateral");
        l.collateralAmount = collateralAmount;
        l.termsDocId = _mintDocument(contractor, termsHash, termsURI, "loan-terms");
        l.state = LoanState.Offered;
        emit LoanOffered(loanId, collateralAmount, l.termsDocId);
    }

    /// @notice 10: contractor accepts the offer; waits for the client's multisig approval.
    function acceptLoan(uint256 loanId) external onlyContractor {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Offered, "TH: not offered");
        require(balanceOf(contractor, l.tokenId) >= l.collateralAmount, "TH: insufficient balance");
        l.contractorAccepted = true;
        l.state = LoanState.Accepted;
        emit LoanAcceptedByContractor(loanId);
    }

    /// @notice 11: client approves the collateral transfer (multisig) -> tokens move to the lender.
    function approveLoanTransfer(uint256 loanId) external onlyClient notFrozen nonReentrant {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Accepted && l.contractorAccepted, "TH: not ready");
        l.clientApproved = true;
        _internalTransfer(contractor, l.lender, l.tokenId, l.collateralAmount);
        l.state = LoanState.CollateralLocked;
        emit LoanCollateralLocked(loanId);
    }

    /// @notice 12: lender records that the loan money was sent off-chain.
    function fundLoan(uint256 loanId, string calldata lenderBank) external {
        Loan storage l = loans[loanId];
        require(msg.sender == l.lender, "TH: only the lender");
        require(l.state == LoanState.CollateralLocked, "TH: collateral not locked");
        l.lenderBank = lenderBank;
        l.state = LoanState.Funded;
        emit LoanFunded(loanId);
    }

    /// @notice 13: contractor repaid the loan off-chain and asks for the collateral back.
    function repayLoan(uint256 loanId, string calldata bank) external onlyContractor {
        Loan storage l = loans[loanId];
        require(l.state == LoanState.Funded, "TH: not funded");
        l.state = LoanState.Repaid;
        emit LoanRepaid(loanId, bank);
    }

    /// @notice 14: lender returns the collateral tokens to the contractor.
    function returnCollateral(uint256 loanId) external nonReentrant {
        Loan storage l = loans[loanId];
        require(msg.sender == l.lender, "TH: only the lender");
        require(l.state == LoanState.Repaid, "TH: not repaid");
        _internalTransfer(l.lender, contractor, l.tokenId, l.collateralAmount);
        l.state = LoanState.Closed;
        emit LoanClosed(loanId);
    }

    // --------------------------------------------------------------------- //
    //               15-16. DELIVERY & APPROVAL                               //
    // --------------------------------------------------------------------- //

    /// @notice 15: contractor hands over the current stage with a report NFT.
    function submitDelivery(string calldata reportURI, bytes32 reportHash)
        external
        onlyContractor
        notFrozen
        returns (uint256 reportDocId)
    {
        require(status == Status.Active, "TH: not active");
        require(currentMilestone < milestoneIds.length, "TH: all delivered");
        uint256 id = milestoneIds[currentMilestone];
        tranches[id].delivered = true;
        reportDocId = _mintDocument(contractor, reportHash, reportURI, "report");
        emit DeliverySubmitted(id, reportDocId);
    }

    /// @notice 16: client approves the delivered stage; its tokens become entitled.
    function approveDelivery() external onlyClient notFrozen {
        require(currentMilestone < milestoneIds.length, "TH: nothing to approve");
        uint256 id = milestoneIds[currentMilestone];
        require(tranches[id].delivered, "TH: not delivered");
        tranches[id].entitled = true;
        currentMilestone++;
        if (currentMilestone == milestoneIds.length) {
            status = Status.Completed;
        }
        emit DeliveryApproved(id);
    }

    // --------------------------------------------------------------------- //
    //          17-21 & 24. ARBITER DISPUTES, FREEZE, APPEALS                 //
    // --------------------------------------------------------------------- //

    /**
     * @notice 17 & 24: a party calls the arbiter. The arbiter salary (separate
     *         money) is paid into the Escrow off-chain and an equal batch of
     *         arbiter-fee tokens is minted directly to the arbiter. The contract
     *         freezes (becomes inactive) and the deadline clock stops.
     */
    function callArbiter(uint256 feeAmount, string calldata complaintURI, bytes32 complaintHash)
        external
        onlyParty
        notFrozen
        returns (uint256 disputeId)
    {
        require(arbiter != address(0), "TH: no arbiter");
        require(status == Status.Active || status == Status.Completed, "TH: not active");
        require(feeAmount > 0, "TH: fee required");

        uint256 feeId = nextTokenId++;
        tranches[feeId] = Tranche({
            kind: TrancheKind.ArbiterFee,
            amount: feeAmount,
            deadlineOffset: 0,
            entitled: false,
            delivered: false,
            beneficiary: arbiter
        });
        _bypassRestrictions = true;
        _mint(arbiter, feeId, feeAmount, "");
        _bypassRestrictions = false;

        uint256 complaintId = _mintDocument(arbiter, complaintHash, complaintURI, "complaint");

        disputes.push(
            Dispute({
                initiator: msg.sender,
                arbiter: arbiter,
                feeTokenId: feeId,
                feeAmount: feeAmount,
                complaintDocId: complaintId,
                rulingDocId: 0,
                winner: address(0),
                rulingTime: 0,
                state: DisputeState.Open,
                clientAccepted: false,
                contractorAccepted: false
            })
        );
        disputeId = disputes.length - 1;
        activeDisputeId = disputeId + 1;
        disputeActive = true;

        _setFrozen(true);
        emit ArbiterCalled(disputeId, msg.sender, feeId, feeAmount);
    }

    /// @notice 18: arbiter issues a ruling (report NFT) and names the winning party. Starts the 7-day window.
    function issueRuling(string calldata rulingURI, bytes32 rulingHash, address winner) external onlyArbiter {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.arbiter == msg.sender, "TH: not your dispute");
        require(d.state == DisputeState.Open, "TH: not open");
        require(winner == client || winner == contractor, "TH: winner must be a party");

        d.winner = winner;
        d.rulingDocId = _mintDocument(msg.sender, rulingHash, rulingURI, "ruling");
        d.rulingTime = block.timestamp;
        d.state = DisputeState.Ruled;
        emit RulingIssued(activeDisputeId - 1, winner, d.rulingDocId);
    }

    /**
     * @notice 19: a party accepts or appeals the ruling. When both parties accept,
     *         the ruling is applied immediately. Appealing routes to {appeal}.
     */
    function respondToRuling(bool accept) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");

        if (!accept) {
            revert("TH: use appeal() to contest");
        }
        if (msg.sender == client) d.clientAccepted = true;
        else d.contractorAccepted = true;
        emit RulingResponded(activeDisputeId - 1, msg.sender, true);

        if (d.clientAccepted && d.contractorAccepted) {
            _applyRuling();
        }
    }

    /**
     * @notice After the 7-day appeal window passes with no appeal, anyone may
     *         finalize the ruling per the arbiter's decision (function 18 timing).
     */
    function finalizeRuling() external {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");
        require(block.timestamp >= d.rulingTime + APPEAL_WINDOW, "TH: appeal window open");
        _applyRuling();
    }

    /**
     * @notice 20: a party appeals; a new arbiter must be supplied. The previous
     *         arbiter keeps their fee tokens but they stay non-entitled until the
     *         appeal chain is finally resolved and accepted.
     */
    function appeal(address newArbiter) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Ruled, "TH: not ruled");
        require(block.timestamp < d.rulingTime + APPEAL_WINDOW, "TH: appeal window closed");
        require(newArbiter != address(0) && newArbiter != client && newArbiter != contractor, "TH: bad arbiter");

        d.state = DisputeState.Appealed;

        // A fresh arbiter must be appointed via inviteArbiter/approveArbiter/arbiterAccept (function 21).
        pendingArbiter = newArbiter;
        contractorApprovedArbiter = false;

        // Open a successor dispute that the new arbiter will rule on. It carries no
        // new fee here; the appellant pays the new arbiter via a follow-up callArbiter
        // is not required — the successor reuses the freeze. We mark the chain.
        disputes.push(
            Dispute({
                initiator: d.initiator,
                arbiter: address(0),
                feeTokenId: 0,
                feeAmount: 0,
                complaintDocId: d.complaintDocId,
                rulingDocId: 0,
                winner: address(0),
                rulingTime: 0,
                state: DisputeState.Open,
                clientAccepted: false,
                contractorAccepted: false
            })
        );
        uint256 newId = disputes.length - 1;
        activeDisputeId = newId + 1;
        emit DisputeAppealed(newId - 1, newId);
        emit ArbiterInvited(newArbiter);
    }

    /// @notice The newly accepted arbiter is bound to the active (successor) dispute.
    function bindArbiterToDispute() external onlyArbiter {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Open && d.arbiter == address(0), "TH: nothing to bind");
        d.arbiter = msg.sender;
    }

    /// @notice The new arbiter's fee for an appeal (re-uses callArbiter-style minting).
    function fundAppealArbiter(uint256 feeAmount) external onlyParty {
        require(disputeActive, "TH: no active dispute");
        Dispute storage d = disputes[activeDisputeId - 1];
        require(d.state == DisputeState.Open && d.feeTokenId == 0, "TH: already funded");
        require(d.arbiter != address(0), "TH: bind arbiter first");
        require(feeAmount > 0, "TH: fee required");

        uint256 feeId = nextTokenId++;
        tranches[feeId] = Tranche({
            kind: TrancheKind.ArbiterFee,
            amount: feeAmount,
            deadlineOffset: 0,
            entitled: false,
            delivered: false,
            beneficiary: d.arbiter
        });
        _bypassRestrictions = true;
        _mint(d.arbiter, feeId, feeAmount, "");
        _bypassRestrictions = false;

        d.feeTokenId = feeId;
        d.feeAmount = feeAmount;
        emit ArbiterCalled(activeDisputeId - 1, msg.sender, feeId, feeAmount);
    }

    /**
     * @dev Applies the active ruling. The loser bears the cost.
     *   - Every arbiter-fee tranche in the dispute chain becomes entitled
     *     (all arbiters who ruled get paid once the chain is finally accepted).
     *   - If the INITIATOR won, they are refunded their arbiter fee as a fresh
     *     batch of entitled tokens (the losing party effectively pays it).
     *   - If the CLIENT won (contractor at fault), the contractor's outstanding
     *     non-entitled financing tokens move to the client and become entitled.
     *   - If the CONTRACTOR won (client at fault), the current milestone is
     *     entitled to the contractor.
     */
    function _applyRuling() private {
        uint256 resolvedId = activeDisputeId - 1;
        Dispute storage d = disputes[resolvedId];
        d.state = DisputeState.Resolved;
        disputeActive = false;
        activeDisputeId = 0;

        address winner = d.winner;

        // Pay every arbiter in the chain.
        for (uint256 i = 0; i < disputes.length; i++) {
            uint256 feeId = disputes[i].feeTokenId;
            if (feeId != 0) {
                tranches[feeId].entitled = true;
            }
        }

        if (winner == d.initiator) {
            // Refund the initiator's fee as fresh entitled tokens.
            uint256 refundId = nextTokenId++;
            tranches[refundId] = Tranche({
                kind: TrancheKind.ArbiterFee,
                amount: d.feeAmount,
                deadlineOffset: 0,
                entitled: true,
                delivered: false,
                beneficiary: d.initiator
            });
            _bypassRestrictions = true;
            _mint(d.initiator, refundId, d.feeAmount, "");
            _bypassRestrictions = false;
        }

        if (winner == client) {
            // Contractor at fault: recover their outstanding (non-entitled) financing.
            _bypassRestrictions = true;
            for (uint256 i = 0; i < milestoneIds.length; i++) {
                uint256 id = milestoneIds[i];
                if (!tranches[id].entitled) {
                    uint256 bal = balanceOf(contractor, id);
                    if (bal > 0) {
                        _safeTransferFrom(contractor, client, id, bal, "");
                    }
                    tranches[id].entitled = true;
                }
            }
            _bypassRestrictions = false;
        } else if (winner == contractor) {
            // Client at fault: entitle the contested milestone for the contractor.
            if (currentMilestone < milestoneIds.length) {
                uint256 id = milestoneIds[currentMilestone];
                tranches[id].entitled = true;
                currentMilestone++;
                if (currentMilestone == milestoneIds.length) {
                    status = Status.Completed;
                }
            }
        }

        _setFrozen(false);
        emit DisputeResolved(resolvedId, winner);
    }

    // --------------------------------------------------------------------- //
    //                  22-23. CONTRACT AMENDMENTS                            //
    // --------------------------------------------------------------------- //

    /// @notice 22: a party proposes an amendment, attaching a reason NFT.
    function proposeAmendment(string calldata reasonURI, bytes32 reasonHash) external onlyParty notFrozen {
        require(!amendmentPending, "TH: amendment pending");
        amendmentPending = true;
        amendmentProposer = msg.sender;
        amendmentDocId = _mintDocument(msg.sender, reasonHash, reasonURI, "amendment");
        emit AmendmentProposed(msg.sender, amendmentDocId);
    }

    /// @notice 23: the counter-party approves or rejects the amendment.
    function respondToAmendment(bool approve) external onlyParty {
        require(amendmentPending, "TH: no amendment");
        require(msg.sender != amendmentProposer, "TH: proposer cannot self-approve");
        amendmentPending = false;
        if (approve) {
            amendmentApproved = true;
        }
        emit AmendmentResolved(approve);
    }

    /**
     * @notice Apply an approved amendment (the "function 2 reused" increase path).
     *         Values may only increase: extra advance and/or new milestones. The
     *         delta is minted to the contractor.
     */
    function amendFunding(
        uint256 extraAdvance,
        uint256[] calldata newMilestoneAmounts,
        uint256[] calldata newDeadlineOffsets
    ) external onlyClient notFrozen nonReentrant {
        require(amendmentApproved, "TH: amendment not approved");
        require(status == Status.Active || status == Status.Completed, "TH: not active");
        require(newMilestoneAmounts.length == newDeadlineOffsets.length, "TH: length mismatch");
        require(extraAdvance > 0 || newMilestoneAmounts.length > 0, "TH: nothing to add");
        amendmentApproved = false;

        _bypassRestrictions = true;
        if (extraAdvance > 0) {
            if (advanceId == 0) {
                advanceId = nextTokenId++;
                tranches[advanceId] = Tranche({
                    kind: TrancheKind.Advance,
                    amount: extraAdvance,
                    deadlineOffset: 0,
                    entitled: true,
                    delivered: false,
                    beneficiary: contractor
                });
            } else {
                tranches[advanceId].amount += extraAdvance;
            }
            totalFinancing += extraAdvance;
            _mint(contractor, advanceId, extraAdvance, ""); // advance is entitled
        }

        uint256[] memory added = new uint256[](newMilestoneAmounts.length);
        for (uint256 i = 0; i < newMilestoneAmounts.length; i++) {
            require(newMilestoneAmounts[i] > 0, "TH: zero milestone");
            uint256 id = nextTokenId++;
            tranches[id] = Tranche({
                kind: TrancheKind.Milestone,
                amount: newMilestoneAmounts[i],
                deadlineOffset: newDeadlineOffsets[i],
                entitled: false,
                delivered: false,
                beneficiary: contractor
            });
            milestoneIds.push(id);
            added[i] = id;
            totalFinancing += newMilestoneAmounts[i];
            _mint(contractor, id, newMilestoneAmounts[i], "");
        }
        _bypassRestrictions = false;

        if (status == Status.Completed && newMilestoneAmounts.length > 0) {
            status = Status.Active; // new work to do
        }
        emit FundingAmended(extraAdvance, added, totalFinancing);
    }

    // --------------------------------------------------------------------- //
    //               25. REDEEM TOKENS FOR MONEY                              //
    // --------------------------------------------------------------------- //

    /// @notice Holders register the bank account that redemptions pay out to.
    function setBankAccount(string calldata account, bool allowBankCover_, bool allowLoanCover_) external {
        bankAccount[msg.sender] = account;
        allowBankCover[msg.sender] = allowBankCover_;
        allowLoanCover[msg.sender] = allowLoanCover_;
        emit BankAccountSet(msg.sender, account);
    }

    /// @notice The oracle reports the live Escrow balance.
    function reportEscrowBalance(uint256 balance) external onlyOracle {
        escrowBalance = balance;
        emit EscrowReported(balance);
    }

    /**
     * @notice 25: a holder of entitled, active tokens requests to redeem them for
     *         money. A request is emitted for the bank Escrow; the oracle settles
     *         it. If the Escrow is empty, settlement may proceed after a 1-day
     *         delay via bank cover (the account owner must have consented).
     */
    function redeem(uint256 tokenId, uint256 amount) external notFrozen returns (uint256 reqId) {
        require(tokenId < DOC_ID_BASE && tranches[tokenId].amount > 0, "TH: not a financing token");
        require(tranches[tokenId].entitled, "TH: not entitled");
        require(amount > 0 && balanceOf(msg.sender, tokenId) >= amount, "TH: insufficient balance");
        require(bytes(bankAccount[msg.sender]).length > 0, "TH: set bank account first");

        redemptions.push(
            Redemption({holder: msg.sender, tokenId: tokenId, amount: amount, requestedAt: block.timestamp, settled: false})
        );
        reqId = redemptions.length - 1;
        emit RedemptionRequested(reqId, msg.sender, tokenId, amount, bankAccount[msg.sender]);
    }

    /**
     * @notice The oracle (bank) settles a redemption: burns the tokens and pays
     *         the holder's bank account. If the Escrow cannot cover it, settlement
     *         is allowed only after a 1-day delay and only with the owner's bank-cover consent.
     */
    function settleRedemption(uint256 reqId) external onlyOracle nonReentrant {
        Redemption storage r = redemptions[reqId];
        require(!r.settled, "TH: already settled");
        require(!frozen, "TH: contract frozen");
        require(balanceOf(r.holder, r.tokenId) >= r.amount, "TH: holder lacks tokens");

        bool viaBankCover = false;
        if (escrowBalance >= r.amount) {
            escrowBalance -= r.amount;
        } else {
            require(block.timestamp >= r.requestedAt + BANK_COVER_DELAY, "TH: bank cover delay");
            require(allowBankCover[r.holder] || allowLoanCover[r.holder], "TH: bank cover not consented");
            viaBankCover = true;
        }

        r.settled = true;
        _bypassRestrictions = true;
        _burn(r.holder, r.tokenId, r.amount);
        _bypassRestrictions = false;
        emit RedemptionSettled(reqId, r.holder, r.amount, viaBankCover);
    }

    // --------------------------------------------------------------------- //
    //                          VIEWS / HELPERS                               //
    // --------------------------------------------------------------------- //

    function milestoneCount() external view returns (uint256) {
        return milestoneIds.length;
    }

    function loanCount() external view returns (uint256) {
        return loans.length;
    }

    function disputeCount() external view returns (uint256) {
        return disputes.length;
    }

    function redemptionCount() external view returns (uint256) {
        return redemptions.length;
    }

    /// @notice Absolute deadline of a milestone tranche, shifted by total frozen time.
    function effectiveDeadline(uint256 tokenId) public view returns (uint256) {
        if (activatedAt == 0) return 0;
        uint256 frozenSoFar = totalFrozenDuration + (frozen ? block.timestamp - frozenAt : 0);
        return activatedAt + tranches[tokenId].deadlineOffset + frozenSoFar;
    }

    function roleOf(address account) external view returns (Role) {
        if (account == client) return Role.Client;
        if (account == contractor) return Role.Contractor;
        if (account == arbiter) return Role.Arbiter;
        return Role.None;
    }

    /// @notice The document NFT metadata URI (used by ERC1155 `uri`).
    function uri(uint256 id) public view override returns (string memory) {
        if (id >= DOC_ID_BASE) return documents[id].uri;
        return "";
    }

    // --------------------------------------------------------------------- //
    //                          INTERNALS                                     //
    // --------------------------------------------------------------------- //

    function _mintDocument(address to, bytes32 hash, string memory docURI, string memory docType)
        private
        returns (uint256 id)
    {
        id = nextDocId++;
        documents[id] = Document({
            hash: hash,
            uri: docURI,
            timestamp: block.timestamp,
            submitter: msg.sender,
            docType: docType
        });
        _bypassRestrictions = true;
        _mint(to, id, 1, "");
        _bypassRestrictions = false;
        emit DocumentMinted(id, to, docType, hash, docURI);
    }

    function _internalTransfer(address from, address to, uint256 id, uint256 amount) private {
        _bypassRestrictions = true;
        _safeTransferFrom(from, to, id, amount, "");
        _bypassRestrictions = false;
    }

    function _setFrozen(bool value) private {
        if (value && !frozen) {
            frozen = true;
            frozenAt = block.timestamp;
        } else if (!value && frozen) {
            totalFrozenDuration += block.timestamp - frozenAt;
            frozen = false;
            frozenAt = 0;
        }
        emit FrozenStateChanged(value);
    }

    /**
     * @dev Transfer restriction (the spec's core rule): only the Client or the
     *      Contractor may move financing tokens, transfers are blocked while the
     *      contract is frozen, and direct burns are disallowed (use {redeem}).
     *      Contract-orchestrated moves set `_bypassRestrictions`.
     */
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
    {
        if (!_bypassRestrictions) {
            bool isMint = from == address(0);
            bool isBurn = to == address(0);
            require(!isBurn, "TH: use redeem to burn");
            if (!isMint) {
                require(!frozen, "TH: contract frozen");
                require(from == client || from == contractor, "TH: transfer not allowed");
            }
        }
        super._update(from, to, ids, values);
    }
}
