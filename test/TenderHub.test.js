const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Token-state enum mirrors (for readability)
const Status = { Draft: 0n, Awaiting: 1n, Active: 2n, Completed: 3n, Cancelled: 4n };
const Role = { None: 0n, Client: 1n, Contractor: 2n, Arbiter: 3n };

const h = (s) => ethers.id(s); // keccak256(utf8) -> bytes32

describe("TenderHub", function () {
  // ------------------------------------------------------------------ //
  //  Fixtures                                                           //
  // ------------------------------------------------------------------ //

  async function deployFixture() {
    const [client, contractor, arbiter, oracle, lender, arbiter2, outsider] =
      await ethers.getSigners();
    const Factory = await ethers.getContractFactory("TenderHub");
    const th = await Factory.connect(client).deploy(
      "ipfs://contract-meta",
      h("contract-doc"),
      "ESCROW-001",
      oracle.address
    );
    await th.waitForDeployment();
    return { th, client, contractor, arbiter, oracle, lender, arbiter2, outsider };
  }

  // declareFunding(advance=100, milestones=[200,300]) -> ids: advance=1, m=[2,3]
  async function declaredFixture() {
    const ctx = await deployFixture();
    const { th, client } = ctx;
    await th
      .connect(client)
      .declareFunding(100, [200, 300], [1000, 2000]);
    return ctx;
  }

  // Active contract: contractor invited, collateral confirmed, accepted.
  async function activeFixture() {
    const ctx = await declaredFixture();
    const { th, client, contractor, oracle } = ctx;
    await th.connect(client).inviteContractor(contractor.address);
    await th.connect(oracle).confirmCollateral();
    await th.connect(contractor).acceptContract();
    return ctx;
  }

  // Active contract with an accepted arbiter (functions 5/6/7).
  async function arbitratedFixture() {
    const ctx = await activeFixture();
    const { th, client, contractor, arbiter } = ctx;
    await th.connect(client).inviteArbiter(arbiter.address);
    await th.connect(contractor).approveArbiter();
    await th.connect(arbiter).arbiterAccept();
    return ctx;
  }

  // ------------------------------------------------------------------ //
  //  1. Deployment & document NFT                                       //
  // ------------------------------------------------------------------ //

  describe("Deployment (function 1)", function () {
    it("sets client/oracle/escrow and mints the contract NFT", async function () {
      const { th, client, oracle } = await loadFixture(deployFixture);
      expect(await th.client()).to.equal(client.address);
      expect(await th.oracle()).to.equal(oracle.address);
      expect(await th.escrowAccount()).to.equal("ESCROW-001");
      expect(await th.status()).to.equal(Status.Draft);

      const docId = await th.contractDocId();
      expect(docId).to.equal(1_000_000_000n);
      expect(await th.balanceOf(client.address, docId)).to.equal(1n);
      const doc = await th.documents(docId);
      expect(doc.hash).to.equal(h("contract-doc"));
      expect(doc.docType).to.equal("contract");
      expect(await th.uri(docId)).to.equal("ipfs://contract-meta");
    });

    it("reports roles", async function () {
      const { th, client } = await loadFixture(deployFixture);
      expect(await th.roleOf(client.address)).to.equal(Role.Client);
    });
  });

  // ------------------------------------------------------------------ //
  //  2-4. Funding, invite, activation                                   //
  // ------------------------------------------------------------------ //

  describe("Funding & activation (functions 2-4)", function () {
    it("declares funding with advance + milestones", async function () {
      const { th } = await loadFixture(declaredFixture);
      expect(await th.advanceId()).to.equal(1n);
      expect(await th.milestoneCount()).to.equal(2n);
      expect(await th.totalFinancing()).to.equal(600n);
      const m0 = await th.tranches(2);
      expect(m0.amount).to.equal(200n);
      expect(m0.kind).to.equal(1n); // Milestone
    });

    it("only client can declare funding", async function () {
      const { th, contractor } = await loadFixture(deployFixture);
      await expect(
        th.connect(contractor).declareFunding(0, [100], [1000])
      ).to.be.revertedWith("TH: only client");
    });

    it("blocks acceptance until collateral is confirmed by the oracle", async function () {
      const { th, client, contractor } = await loadFixture(declaredFixture);
      await th.connect(client).inviteContractor(contractor.address);
      await expect(th.connect(contractor).acceptContract()).to.be.revertedWith(
        "TH: collateral not confirmed"
      );
    });

    it("activates, mints tokens to the contractor and entitles the advance", async function () {
      const { th, contractor } = await loadFixture(activeFixture);
      expect(await th.status()).to.equal(Status.Active);
      expect(await th.balanceOf(contractor.address, 1)).to.equal(100n); // advance
      expect(await th.balanceOf(contractor.address, 2)).to.equal(200n);
      expect(await th.balanceOf(contractor.address, 3)).to.equal(300n);
      expect((await th.tranches(1)).entitled).to.equal(true); // advance entitled
      expect((await th.tranches(2)).entitled).to.equal(false);
    });

    it("rejects a non-invited contractor", async function () {
      const { th, client, contractor, oracle, outsider } = await loadFixture(
        declaredFixture
      );
      await th.connect(client).inviteContractor(outsider.address);
      await th.connect(oracle).confirmCollateral();
      await expect(th.connect(contractor).acceptContract()).to.be.revertedWith(
        "TH: not the invited contractor"
      );
    });
  });

  // ------------------------------------------------------------------ //
  //  5/6/7. Arbiter appointment                                         //
  // ------------------------------------------------------------------ //

  describe("Arbiter appointment (functions 5/6/7)", function () {
    it("requires invite + contractor approval + arbiter acceptance", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(activeFixture);
      await th.connect(client).inviteArbiter(arbiter.address);
      await expect(th.connect(arbiter).arbiterAccept()).to.be.revertedWith(
        "TH: contractor has not approved"
      );
      await th.connect(contractor).approveArbiter();
      await th.connect(arbiter).arbiterAccept();
      expect(await th.arbiter()).to.equal(arbiter.address);
      expect(await th.roleOf(arbiter.address)).to.equal(Role.Arbiter);
    });
  });

  // ------------------------------------------------------------------ //
  //  15-16. Delivery & approval                                         //
  // ------------------------------------------------------------------ //

  describe("Delivery & approval (functions 15-16)", function () {
    it("submits a delivery and the client entitles the milestone", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      await expect(th.connect(contractor).submitDelivery("ipfs://report1", h("r1")))
        .to.emit(th, "DeliverySubmitted");
      expect((await th.tranches(2)).delivered).to.equal(true);

      await th.connect(client).approveDelivery();
      expect((await th.tranches(2)).entitled).to.equal(true);
      expect(await th.currentMilestone()).to.equal(1n);
    });

    it("cannot approve before delivery", async function () {
      const { th, client } = await loadFixture(activeFixture);
      await expect(th.connect(client).approveDelivery()).to.be.revertedWith(
        "TH: not delivered"
      );
    });

    it("completes the contract after the last milestone", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r1", h("r1"));
      await th.connect(client).approveDelivery();
      await th.connect(contractor).submitDelivery("ipfs://r2", h("r2"));
      await th.connect(client).approveDelivery();
      expect(await th.status()).to.equal(Status.Completed);
    });
  });

  // ------------------------------------------------------------------ //
  //  Transfer restrictions (core rule)                                  //
  // ------------------------------------------------------------------ //

  describe("Transfer restrictions", function () {
    it("lets the contractor transfer but blocks a non-party holder", async function () {
      const { th, contractor, lender, outsider } = await loadFixture(activeFixture);
      // contractor (a party) may transfer
      await th
        .connect(contractor)
        .safeTransferFrom(contractor.address, lender.address, 2, 50, "0x");
      expect(await th.balanceOf(lender.address, 2)).to.equal(50n);
      // lender (not a party) may NOT transfer onward
      await expect(
        th
          .connect(lender)
          .safeTransferFrom(lender.address, outsider.address, 2, 10, "0x")
      ).to.be.revertedWith("TH: transfer not allowed");
    });

    it("blocks direct burns", async function () {
      const { th, contractor } = await loadFixture(activeFixture);
      await expect(
        th
          .connect(contractor)
          .safeTransferFrom(contractor.address, ethers.ZeroAddress, 2, 10, "0x")
      ).to.be.reverted; // ERC1155 rejects zero-address receiver before our hook
    });
  });

  // ------------------------------------------------------------------ //
  //  25. Redemption                                                     //
  // ------------------------------------------------------------------ //

  describe("Redemption (function 25)", function () {
    it("redeems entitled tokens through the oracle and burns them", async function () {
      const { th, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).setBankAccount("BANK-CONTRACTOR", false, false);
      await th.connect(oracle).reportEscrowBalance(1000);

      await expect(th.connect(contractor).redeem(1, 100)) // advance
        .to.emit(th, "RedemptionRequested");
      await expect(th.connect(oracle).settleRedemption(0))
        .to.emit(th, "RedemptionSettled")
        .withArgs(0, contractor.address, 100, false);

      expect(await th.balanceOf(contractor.address, 1)).to.equal(0n); // burned
      expect(await th.escrowBalance()).to.equal(900n);
    });

    it("rejects redeeming a non-entitled milestone", async function () {
      const { th, contractor } = await loadFixture(activeFixture);
      await th.connect(contractor).setBankAccount("BANK-CONTRACTOR", false, false);
      await expect(th.connect(contractor).redeem(2, 200)).to.be.revertedWith(
        "TH: not entitled"
      );
    });

    it("requires a registered bank account", async function () {
      const { th, contractor } = await loadFixture(activeFixture);
      await expect(th.connect(contractor).redeem(1, 100)).to.be.revertedWith(
        "TH: set bank account first"
      );
    });

    it("enforces the 1-day bank-cover delay when escrow is empty", async function () {
      const { th, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).setBankAccount("BANK-CONTRACTOR", true, false); // allow cover
      await th.connect(oracle).reportEscrowBalance(0); // empty escrow
      await th.connect(contractor).redeem(1, 100);

      await expect(th.connect(oracle).settleRedemption(0)).to.be.revertedWith(
        "TH: bank cover delay"
      );

      await time.increase(24 * 60 * 60 + 1); // +1 day
      await expect(th.connect(oracle).settleRedemption(0))
        .to.emit(th, "RedemptionSettled")
        .withArgs(0, contractor.address, 100, true); // via bank cover
      expect(await th.balanceOf(contractor.address, 1)).to.equal(0n);
    });

    it("blocks bank cover without holder consent", async function () {
      const { th, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).setBankAccount("BANK-CONTRACTOR", false, false);
      await th.connect(oracle).reportEscrowBalance(0);
      await th.connect(contractor).redeem(1, 100);
      await time.increase(24 * 60 * 60 + 1);
      await expect(th.connect(oracle).settleRedemption(0)).to.be.revertedWith(
        "TH: bank cover not consented"
      );
    });
  });

  // ------------------------------------------------------------------ //
  //  8-14. Loans                                                        //
  // ------------------------------------------------------------------ //

  describe("Collateralised loans (functions 8-14)", function () {
    it("runs the full loan lifecycle with multisig approval", async function () {
      const { th, client, contractor, lender } = await loadFixture(activeFixture);

      // 8: request
      await expect(th.connect(contractor).requestLoan(lender.address, 2, 100))
        .to.emit(th, "LoanRequested");
      // 9: lender offers terms + collateral (<= requested)
      await th.connect(lender).offerLoan(0, "ipfs://terms", h("terms"), 80);
      let loan = await th.loans(0);
      expect(loan.collateralAmount).to.equal(80n);
      expect(loan.contractDocId).to.equal(await th.contractDocId()); // tender NFT attached

      // 10: contractor accepts
      await th.connect(contractor).acceptLoan(0);
      // 11: client multisig approval -> collateral moves to lender
      await th.connect(client).approveLoanTransfer(0);
      expect(await th.balanceOf(lender.address, 2)).to.equal(80n);
      expect(await th.balanceOf(contractor.address, 2)).to.equal(120n);

      // 12: lender funds off-chain
      await th.connect(lender).fundLoan(0, "BANK-LENDER");
      // 13: contractor repays
      await th.connect(contractor).repayLoan(0, "BANK-CONTRACTOR");
      // 14: lender returns collateral
      await th.connect(lender).returnCollateral(0);
      expect(await th.balanceOf(contractor.address, 2)).to.equal(200n);
      expect((await th.loans(0)).state).to.equal(7n); // Closed
    });

    it("rejects collateral greater than requested", async function () {
      const { th, contractor, lender } = await loadFixture(activeFixture);
      await th.connect(contractor).requestLoan(lender.address, 2, 100);
      await expect(
        th.connect(lender).offerLoan(0, "ipfs://terms", h("t"), 150)
      ).to.be.revertedWith("TH: bad collateral");
    });

    it("requires client approval before collateral moves", async function () {
      const { th, contractor, lender } = await loadFixture(activeFixture);
      await th.connect(contractor).requestLoan(lender.address, 2, 100);
      await th.connect(lender).offerLoan(0, "ipfs://terms", h("t"), 80);
      await th.connect(contractor).acceptLoan(0);
      // lender can't fund before collateral is locked
      await expect(th.connect(lender).fundLoan(0, "BANK")).to.be.revertedWith(
        "TH: collateral not locked"
      );
    });
  });

  // ------------------------------------------------------------------ //
  //  17-19. Disputes (freeze + ruling)                                  //
  // ------------------------------------------------------------------ //

  describe("Disputes (functions 17-19)", function () {
    it("freezes the contract when an arbiter is called and blocks transfers", async function () {
      const { th, contractor } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).callArbiter(50, "ipfs://complaint", h("c"));
      expect(await th.frozen()).to.equal(true);
      await expect(
        th
          .connect(contractor)
          .safeTransferFrom(contractor.address, contractor.address, 2, 1, "0x")
      ).to.be.revertedWith("TH: contract frozen");
    });

    it("mints arbiter-fee tokens to the arbiter (separate from financing)", async function () {
      const { th, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).callArbiter(50, "ipfs://complaint", h("c"));
      const feeId = (await th.disputes(0)).feeTokenId;
      expect(await th.balanceOf(arbiter.address, feeId)).to.equal(50n);
      expect((await th.tranches(feeId)).kind).to.equal(2n); // ArbiterFee
    });

    it("resolves for the contractor (client at fault): milestone entitled + fee refunded", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).submitDelivery("ipfs://r1", h("r1"));
      // client refuses to approve -> contractor calls arbiter
      await th.connect(contractor).callArbiter(50, "ipfs://complaint", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ruling", h("ru"), contractor.address);
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);

      expect(await th.frozen()).to.equal(false);
      expect((await th.tranches(2)).entitled).to.equal(true); // contested milestone entitled
      const feeId = (await th.disputes(0)).feeTokenId;
      expect((await th.tranches(feeId)).entitled).to.equal(true); // arbiter paid
      // refund: initiator (contractor) got a fresh entitled fee-sized batch
      const refundId = feeId + 1n;
      expect(await th.balanceOf(contractor.address, refundId)).to.equal(50n);
      expect((await th.tranches(refundId)).entitled).to.equal(true);
    });

    it("resolves for the client (contractor at fault): financing recovered", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(client).callArbiter(50, "ipfs://complaint", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ruling", h("ru"), client.address);
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);

      // contractor's non-entitled milestones moved to the client and entitled
      expect(await th.balanceOf(client.address, 2)).to.equal(200n);
      expect(await th.balanceOf(client.address, 3)).to.equal(300n);
      expect(await th.balanceOf(contractor.address, 2)).to.equal(0n);
      expect((await th.tranches(2)).entitled).to.equal(true);
    });

    it("only a party can call the arbiter", async function () {
      const { th, outsider } = await loadFixture(arbitratedFixture);
      await expect(
        th.connect(outsider).callArbiter(50, "ipfs://c", h("c"))
      ).to.be.revertedWith("TH: only a party");
    });
  });

  // ------------------------------------------------------------------ //
  //  18. Finalize after 7-day appeal window                             //
  // ------------------------------------------------------------------ //

  describe("Appeal window (function 18 timing)", function () {
    it("can be finalized after 7 days without an appeal", async function () {
      const { th, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).callArbiter(50, "ipfs://c", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), contractor.address);

      await expect(th.finalizeRuling()).to.be.revertedWith("TH: appeal window open");
      await time.increase(7 * 24 * 60 * 60 + 1);
      await expect(th.finalizeRuling()).to.emit(th, "DisputeResolved");
      expect(await th.frozen()).to.equal(false);
    });
  });

  // ------------------------------------------------------------------ //
  //  20-21. Appeal -> new arbiter                                       //
  // ------------------------------------------------------------------ //

  describe("Appeal (functions 20-21)", function () {
    it("appoints a new arbiter and resolves the successor dispute", async function () {
      const { th, client, contractor, arbiter, arbiter2 } = await loadFixture(
        arbitratedFixture
      );
      await th.connect(contractor).callArbiter(50, "ipfs://c", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), client.address);

      // contractor appeals within the window, naming a new arbiter
      await th.connect(contractor).appeal(arbiter2.address);
      expect(await th.disputeCount()).to.equal(2n);

      // function 21: approve + accept the new arbiter
      await th.connect(contractor).approveArbiter();
      await th.connect(arbiter2).arbiterAccept();
      expect(await th.arbiter()).to.equal(arbiter2.address);
      // old arbiter keeps their fee tokens (non-entitled for now)
      const feeId0 = (await th.disputes(0)).feeTokenId;
      expect(await th.balanceOf(arbiter.address, feeId0)).to.equal(50n);
      expect((await th.tranches(feeId0)).entitled).to.equal(false);

      // bind + fund + rule on the successor dispute
      await th.connect(arbiter2).bindArbiterToDispute();
      await th.connect(contractor).fundAppealArbiter(60);
      await th.connect(arbiter2).issueRuling("ipfs://ru2", h("ru2"), contractor.address);
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);

      expect(await th.frozen()).to.equal(false);
      // both arbiters get paid once the chain resolves
      expect((await th.tranches(feeId0)).entitled).to.equal(true);
      const feeId1 = (await th.disputes(1)).feeTokenId;
      expect((await th.tranches(feeId1)).entitled).to.equal(true);
    });

    it("rejects appealing after the window closes", async function () {
      const { th, contractor, arbiter, arbiter2 } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).callArbiter(50, "ipfs://c", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), contractor.address);
      await time.increase(7 * 24 * 60 * 60 + 1);
      await expect(th.connect(contractor).appeal(arbiter2.address)).to.be.revertedWith(
        "TH: appeal window closed"
      );
    });
  });

  // ------------------------------------------------------------------ //
  //  22-23. Amendments                                                  //
  // ------------------------------------------------------------------ //

  describe("Amendments (functions 22-23)", function () {
    it("proposes, approves and applies an increase-only amendment", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      await th.connect(client).proposeAmendment("ipfs://reason", h("reason"));
      await th.connect(contractor).respondToAmendment(true);
      expect(await th.amendmentApproved()).to.equal(true);

      const before = await th.totalFinancing();
      await th.connect(client).amendFunding(50, [400], [3000]);
      expect(await th.totalFinancing()).to.equal(before + 450n); // +50 advance +400 milestone
      // extra advance minted (entitled) + new milestone minted to contractor
      expect(await th.balanceOf(contractor.address, 1)).to.equal(150n); // 100 + 50
      expect(await th.milestoneCount()).to.equal(3n);
      const newMid = (await th.milestoneIds(2));
      expect(await th.balanceOf(contractor.address, newMid)).to.equal(400n);
    });

    it("proposer cannot self-approve", async function () {
      const { th, client } = await loadFixture(activeFixture);
      await th.connect(client).proposeAmendment("ipfs://reason", h("r"));
      await expect(th.connect(client).respondToAmendment(true)).to.be.revertedWith(
        "TH: proposer cannot self-approve"
      );
    });

    it("blocks amendFunding without approval", async function () {
      const { th, client } = await loadFixture(activeFixture);
      await expect(th.connect(client).amendFunding(50, [], [])).to.be.revertedWith(
        "TH: amendment not approved"
      );
    });
  });
});
