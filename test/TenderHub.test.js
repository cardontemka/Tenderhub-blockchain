const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const Status = { Draft: 0n, Awaiting: 1n, Active: 2n, Suspended: 3n, Cancelled: 4n, Completed: 5n };
const Kind = { Milestone: 0n, Collateral: 1n, ArbiterFee: 2n, Penalty: 3n, Advance: 4n };
const DAY = 24 * 60 * 60;
const h = (s) => ethers.id(s);

// milestones [1,000,000 ; 2,000,000] -> total 3,000,000 -> penaltyPerDay = 600
const M0 = 1_000_000n;
const M1 = 2_000_000n;
const COLLATERAL = 30_000n; // 1% of 3,000,000
const FEE = 50_000n;
const PPD = 600n;

describe("TenderHub v2.1", function () {
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

  // invite -> join -> declareFunding (no advance, warranty 0; milestone ids 1,2)
  async function declaredFixture() {
    const ctx = await deployFixture();
    const { th, client, contractor } = ctx;
    await th.connect(client).inviteContractor(contractor.address);
    await th.connect(contractor).joinContract();
    await th.connect(client).declareFunding(0, [M0, M1], [10, 20], 0);
    return ctx;
  }

  // arbiter appointed (required before activation), still Awaiting
  async function withArbiterFixture() {
    const ctx = await declaredFixture();
    const { th, client, contractor, arbiter } = ctx;
    await th.connect(client).inviteArbiter(arbiter.address);
    await th.connect(contractor).approveArbiter();
    await th.connect(arbiter).arbiterAccept();
    return ctx;
  }

  // active: arbiter + collateral (collateral token id 3, held by CLIENT)
  async function activeFixture() {
    const ctx = await withArbiterFixture();
    await ctx.th.connect(ctx.contractor).activateContract();
    return ctx;
  }

  const arbitratedFixture = activeFixture;

  const approve = (th, client) => th.connect(client).approveDelivery("ipfs://ok", h("ok"));

  // ------------------------------------------------------------------ //
  describe("Deployment & onboarding", function () {
    it("declares funding (advance optional) only after invite+join", async function () {
      const { th, client, contractor } = await loadFixture(deployFixture);
      await th.connect(client).inviteContractor(contractor.address);
      await expect(
        th.connect(client).declareFunding(0, [M0], [10], 0)
      ).to.be.revertedWith("TH: no contractor");
      await th.connect(contractor).joinContract();
      await th.connect(client).declareFunding(0, [M0, M1], [10, 20], 0);
      expect(await th.totalFinancing()).to.equal(M0 + M1);
      expect(await th.balanceOf(contractor.address, 1)).to.equal(M0);
    });

    it("rejects a 0-day deadline", async function () {
      const { th, client, contractor } = await loadFixture(deployFixture);
      await th.connect(client).inviteContractor(contractor.address);
      await th.connect(contractor).joinContract();
      await expect(
        th.connect(client).declareFunding(0, [M0], [0], 0)
      ).to.be.revertedWith("TH: zero-day deadline");
    });

    it("advance is set only at declaration and entitled at activation", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(deployFixture);
      const ADV = 100_000n;
      await th.connect(client).inviteContractor(contractor.address);
      await th.connect(contractor).joinContract();
      await th.connect(client).declareFunding(ADV, [M0, M1], [10, 20], 0);
      const advId = await th.advanceTokenId();
      expect(advId).to.equal(1n);
      expect(await th.totalFinancing()).to.equal(ADV + M0 + M1);
      expect((await th.tranches(advId)).entitled).to.equal(false);
      await th.connect(client).inviteArbiter(arbiter.address);
      await th.connect(contractor).approveArbiter();
      await th.connect(arbiter).arbiterAccept();
      await th.connect(contractor).activateContract();
      expect((await th.tranches(advId)).entitled).to.equal(true);
    });

    it("requires an arbiter before activation", async function () {
      const { th, contractor } = await loadFixture(declaredFixture);
      await expect(th.connect(contractor).activateContract()).to.be.revertedWith(
        "TH: appoint an arbiter first"
      );
    });

    it("activates with 1% collateral held by the CLIENT, non-transferable", async function () {
      const { th, client, contractor } = await loadFixture(withArbiterFixture);
      await th.connect(contractor).activateContract();
      const colId = await th.collateralTokenId();
      expect(await th.balanceOf(client.address, colId)).to.equal(COLLATERAL); // client holds it
      expect(await th.balanceOf(contractor.address, colId)).to.equal(0n);
      expect(await th.escrowReserve()).to.equal(COLLATERAL);
      // collateral cannot be transferred by the client
      await expect(
        th.connect(client).safeTransferFrom(client.address, contractor.address, colId, 1n, "0x")
      ).to.be.revertedWith("TH: collateral non-transferable");
    });
  });

  // ------------------------------------------------------------------ //
  describe("Role uniqueness & arbiter swap", function () {
    it("blocks one address from being two roles (reported bug)", async function () {
      const { th, client, outsider } = await loadFixture(deployFixture);
      await th.connect(client).inviteArbiter(outsider.address);
      await expect(th.connect(client).inviteContractor(outsider.address)).to.be.revertedWith(
        "TH: bad contractor"
      );
    });

    it("blocks swapping the arbiter once set (except via appeal)", async function () {
      const { th, client, arbiter2 } = await loadFixture(activeFixture);
      await expect(th.connect(client).inviteArbiter(arbiter2.address)).to.be.revertedWith(
        "TH: arbiter already set; use appeal"
      );
    });
  });

  // ------------------------------------------------------------------ //
  describe("Delivery, approval, rejection", function () {
    it("approves a delivery (with a reason) and entitles the milestone", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r1", h("r1"));
      await approve(th, client);
      expect((await th.tranches(1)).entitled).to.equal(true);
      expect(await th.currentMilestone()).to.equal(1n);
    });

    it("rejected delivery must be accepted before re-submitting (unlimited times)", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      for (let i = 0; i < 4; i++) {
        await th.connect(contractor).submitDelivery("ipfs://r", h("r" + i));
        await th.connect(client).rejectDelivery("ipfs://no", h("no" + i));
        expect(await th.deliveryRejected()).to.equal(true);
        // cannot resubmit until the rejection is accepted
        await expect(
          th.connect(contractor).submitDelivery("ipfs://r", h("x" + i))
        ).to.be.revertedWith("TH: accept the rejection first");
        await th.connect(contractor).acceptDeliveryRejection();
      }
      expect(await th.status()).to.equal(Status.Active); // never auto-suspends now
    });
  });

  // ------------------------------------------------------------------ //
  describe("Redemption & escrow", function () {
    it("redeems an entitled milestone above the reserve and burns it", async function () {
      const { th, client, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await approve(th, client);
      await th.connect(oracle).reportEscrow(M0 + COLLATERAL, COLLATERAL);
      await th.connect(contractor).redeem(1, M0);
      await expect(th.connect(oracle).settleRedemption(0))
        .to.emit(th, "RedemptionSettled")
        .withArgs(0, contractor.address, M0, false);
      expect(await th.balanceOf(contractor.address, 1)).to.equal(0n);
      expect(await th.escrowBalance()).to.equal(COLLATERAL); // reserve preserved
    });

    it("covers immediately via a bank loan when escrow is short", async function () {
      const { th, client, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await approve(th, client);
      await th.connect(oracle).reportEscrow(COLLATERAL, COLLATERAL); // nothing above reserve
      await th.connect(contractor).redeem(1, M0);
      // no waiting — settled at once via bank cover (viaBankCover = true)
      await expect(th.connect(oracle).settleRedemption(0))
        .to.emit(th, "RedemptionSettled")
        .withArgs(0, contractor.address, M0, true);
      expect(await th.balanceOf(contractor.address, 1)).to.equal(0n);
    });

    it("records escrow debt on bank cover and repays it on funding", async function () {
      const { th, client, contractor, oracle } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await approve(th, client);
      await th.connect(oracle).reportEscrow(COLLATERAL, COLLATERAL); // nothing above reserve
      await th.connect(contractor).redeem(1, M0);
      await th.connect(oracle).settleRedemption(0);
      expect(await th.escrowDebt()).to.equal(M0); // whole amount was bank-covered
      expect(await th.escrowReserve()).to.equal(COLLATERAL); // reserve untouched

      // client funds 300,000 -> debt drops, no spendable balance yet
      await th.connect(client).fundEscrow(300000n);
      expect(await th.escrowDebt()).to.equal(M0 - 300000n);
      // overpay the rest + extra -> debt cleared, remainder spendable
      await th.connect(client).fundEscrow(M0 - 300000n + 5000n);
      expect(await th.escrowDebt()).to.equal(0n);
      expect(await th.escrowBalance()).to.equal(COLLATERAL + 5000n);
    });
  });

  // ------------------------------------------------------------------ //
  describe("Frozen contract stops the clock", function () {
    it("does not advance milestone deadlines while frozen (dispute)", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      const before = await th.effectiveDeadline(0);
      // open a dispute -> contract frozen
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await th.connect(client).rejectDelivery("ipfs://no", h("no"));
      await th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c"));
      expect(await th.frozen()).to.equal(true);
      // 5 days pass while frozen -> the effective deadline shifts forward by ~5 days
      await time.increase(5 * DAY);
      const during = await th.effectiveDeadline(0);
      expect(during - before).to.be.greaterThanOrEqual(BigInt(5 * DAY));
    });
  });

  // ------------------------------------------------------------------ //
  describe("Warranty & collateral return", function () {
    it("returns the bond to the contractor after the warranty period", async function () {
      const ctx = await loadFixture(deployFixture);
      const { th, client, contractor, arbiter } = ctx;
      await th.connect(client).inviteContractor(contractor.address);
      await th.connect(contractor).joinContract();
      await th.connect(client).declareFunding(0, [M0, M1], [10, 20], 30); // 30-day warranty
      await th.connect(client).inviteArbiter(arbiter.address);
      await th.connect(contractor).approveArbiter();
      await th.connect(arbiter).arbiterAccept();
      await th.connect(contractor).activateContract();
      const colId = await th.collateralTokenId();

      // complete both milestones
      await th.connect(contractor).submitDelivery("ipfs://r1", h("r1"));
      await approve(th, client);
      await th.connect(contractor).submitDelivery("ipfs://r2", h("r2"));
      await approve(th, client);
      expect(await th.status()).to.equal(Status.Completed);

      await expect(th.releaseWarranty()).to.be.revertedWith("TH: warranty period running");
      await time.increase(30 * DAY + 1);
      await th.releaseWarranty();
      expect(await th.balanceOf(contractor.address, colId)).to.equal(COLLATERAL);
      expect((await th.tranches(colId)).entitled).to.equal(true);
      expect(await th.escrowReserve()).to.equal(0n);
    });
  });

  // ------------------------------------------------------------------ //
  describe("Penalty engine", function () {
    it("penalises the contractor for an overdue (undelivered) milestone", async function () {
      const { th, client } = await loadFixture(activeFixture);
      await time.increase(13 * DAY); // 3 days past the 10-day deadline
      await th.assessPenalties();
      expect(await th.balanceOf((await th.contractor()), 1)).to.equal(M0 - 3n * PPD);
      const pid = 4n; // m1,m2,collateral,penalty
      expect((await th.tranches(pid)).kind).to.equal(Kind.Penalty);
      expect(await th.balanceOf(client.address, pid)).to.equal(3n * PPD);
    });

    it("shifts fault to the client once the work is delivered", async function () {
      const { th, contractor } = await loadFixture(activeFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await time.increase(13 * DAY);
      await th.assessPenalties();
      expect(await th.balanceOf(contractor.address, 1)).to.equal(M0); // not penalised
      expect(await th.balanceOf(contractor.address, 4n)).to.be.greaterThan(0n); // client-late penalty
    });

    it("suspends when overdue penalty reaches half the milestone", async function () {
      const { th } = await loadFixture(activeFixture);
      const days = 10 + Math.ceil(500000 / 600) + 1;
      await time.increase(days * DAY);
      await th.assessPenalties();
      expect(await th.status()).to.equal(Status.Suspended);
    });
  });

  // ------------------------------------------------------------------ //
  describe("Loans (simplified: amount-only, id-order)", function () {
    it("pledges an amount; collateral is gathered in token-id order", async function () {
      const { th, client, contractor, lender } = await loadFixture(activeFixture);
      await th.connect(contractor).requestLoan(lender.address, 1_200_000n);
      await th.connect(lender).offerLoan(0, "ipfs://terms", h("t"), 1_200_000n);
      await th.connect(contractor).acceptLoan(0);
      await th.connect(client).approveLoanTransfer(0);
      // pulled 1,000,000 from id1 then 200,000 from id2
      expect(await th.balanceOf(lender.address, 1)).to.equal(1_000_000n);
      expect(await th.balanceOf(lender.address, 2)).to.equal(200_000n);
      expect(await th.balanceOf(contractor.address, 1)).to.equal(0n);
      expect(await th.balanceOf(contractor.address, 2)).to.equal(M1 - 200_000n);
      expect((await th.loans(0)).state).to.equal(4n); // Transferred
    });

    it("contractor can reject a lender's offer, then re-request from them", async function () {
      const { th, contractor, lender } = await loadFixture(activeFixture);
      await th.connect(contractor).requestLoan(lender.address, 100000n);
      await th.connect(lender).offerLoan(0, "ipfs://terms", h("t"), 90000n);
      await th.connect(contractor).rejectLoan(0);
      expect((await th.loans(0)).state).to.equal(5n); // Rejected
      // a rejected loan no longer blocks a new request to the same lender
      await th.connect(contractor).requestLoan(lender.address, 50000n);
      expect((await th.loans(1)).state).to.equal(1n); // Requested
    });

    it("blocks a second open loan to the same lender", async function () {
      const { th, contractor, lender } = await loadFixture(activeFixture);
      await th.connect(contractor).requestLoan(lender.address, 100000n);
      await expect(
        th.connect(contractor).requestLoan(lender.address, 50000n)
      ).to.be.revertedWith("TH: an open loan to this lender exists");
    });
  });

  // ------------------------------------------------------------------ //
  describe("Arbiter (no subject selection)", function () {
    it("contractor disputes a rejected delivery; arbiter sides with contractor", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await th.connect(client).rejectDelivery("ipfs://no", h("no"));
      await th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c")); // auto-detects Delivery
      expect(await th.frozen()).to.equal(true);
      expect((await th.disputes(0)).subject).to.equal(1n); // Delivery
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), contractor.address);
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);

      expect(await th.frozen()).to.equal(false);
      expect(await th.status()).to.equal(Status.Active); // back to active after the dispute
      expect((await th.tranches(1)).entitled).to.equal(true); // delivery approved
    });

    it("reverts callArbiter when there is nothing to dispute", async function () {
      const { th, contractor } = await loadFixture(arbitratedFixture);
      await expect(
        th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c"))
      ).to.be.revertedWith("TH: nothing to dispute");
    });

    it("loser pays the fee as a fine but the contract stays Active", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await th.connect(client).rejectDelivery("ipfs://no", h("no"));
      await th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), client.address); // contractor loses
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);
      expect(await th.status()).to.equal(Status.Active);
      expect(await th.frozen()).to.equal(false);
    });

    it("only the losing party can appeal, and the appellant pays the new fee", async function () {
      const { th, client, contractor, arbiter, arbiter2 } = await loadFixture(arbitratedFixture);
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await th.connect(client).rejectDelivery("ipfs://no", h("no"));
      await th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c"));
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), client.address); // client wins

      // the winner (client) cannot appeal
      await expect(th.connect(client).appeal(arbiter2.address)).to.be.revertedWith(
        "TH: the winning party cannot appeal"
      );
      // the loser (contractor) appeals -> becomes the successor initiator
      await th.connect(contractor).appeal(arbiter2.address);
      // the appellant (contractor) named the arbiter, so they cannot approve it
      await expect(th.connect(contractor).approveArbiter()).to.be.revertedWith(
        "TH: nominator cannot approve"
      );
      // the counter-party (client) approves the new arbiter
      await th.connect(client).approveArbiter();
      await th.connect(arbiter2).arbiterAccept(); // auto-binds to the successor dispute

      // the non-appellant (client) cannot fund the appeal fee
      await expect(th.connect(client).fundAppealArbiter(FEE)).to.be.revertedWith(
        "TH: only the appellant pays"
      );
      await th.connect(contractor).fundAppealArbiter(FEE); // appellant pays
      expect((await th.disputes(1)).feeAmount).to.equal(FEE);
    });
  });

  // ------------------------------------------------------------------ //
  describe("Amendments (proposer stages, other party approves)", function () {
    const stage = (th, who, topUps, news) =>
      th
        .connect(who)
        .stageAmendment("ipfs://reason", h("reason"), ...topUps, ...news);

    it("contractor can propose; applies when the OTHER party approves", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      // contractor stages directly (no separate propose step)
      await stage(th, contractor, [[0], [500000], [5]], [[700000], [30]]);
      const before = await th.totalFinancing();
      await expect(th.connect(contractor).respondToAmendment(true)).to.be.revertedWith(
        "TH: proposer already approved"
      );
      await th.connect(client).respondToAmendment(true); // the other party
      expect(await th.totalFinancing()).to.equal(before + 500000n + 700000n);
      expect(await th.milestoneCount()).to.equal(3n);
    });

    it("a rejected amendment must be accepted (or disputed) before re-proposing", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      await stage(th, client, [[], [], []], [[700000], [30]]);
      await th.connect(contractor).respondToAmendment(false); // rejected
      await expect(stage(th, client, [[], [], []], [[700000], [30]])).to.be.revertedWith(
        "TH: amendment in progress"
      );
      await th.connect(client).acceptAmendmentRejection();
      await stage(th, client, [[], [], []], [[700000], [30]]); // now allowed
      expect(await th.amendState()).to.equal(1n); // Staged
    });

    it("rejected amendment enforced by the arbiter for the proposer", async function () {
      const { th, client, contractor, arbiter } = await loadFixture(arbitratedFixture);
      await stage(th, client, [[], [], []], [[700000], [30]]);
      await th.connect(contractor).respondToAmendment(false);
      await th.connect(client).callArbiter(FEE, "ipfs://c", h("c")); // auto-detects Amendment
      expect((await th.disputes(0)).subject).to.equal(2n);
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), client.address);
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);
      expect(await th.milestoneCount()).to.equal(3n);
      expect(await th.status()).to.equal(Status.Active);
    });

    it("cannot top up an already-completed milestone", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      // complete milestone #0
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await approve(th, client);
      expect(await th.currentMilestone()).to.equal(1n);
      // try to top up milestone idx 0 (done) -> rejected
      await expect(
        stage(th, client, [[0], [5000], [1]], [[], []])
      ).to.be.revertedWith("TH: milestone already completed");
      // topping up the current milestone (idx 1) is fine
      await stage(th, client, [[1], [5000], [1]], [[], []]);
      expect(await th.amendState()).to.equal(1n); // Staged
    });

    it("delivery rejection and amendment block each other until resolved", async function () {
      const { th, client, contractor } = await loadFixture(activeFixture);
      // delivery rejected -> cannot stage an amendment
      await th.connect(contractor).submitDelivery("ipfs://r", h("r"));
      await th.connect(client).rejectDelivery("ipfs://no", h("no"));
      await expect(stage(th, client, [[], [], []], [[700000], [30]])).to.be.revertedWith(
        "TH: resolve the delivery rejection first"
      );
      await th.connect(contractor).acceptDeliveryRejection();

      // amendment rejected -> cannot submit delivery
      await stage(th, client, [[], [], []], [[700000], [30]]);
      await th.connect(contractor).respondToAmendment(false);
      await expect(
        th.connect(contractor).submitDelivery("ipfs://r", h("r2"))
      ).to.be.revertedWith("TH: resolve the amendment rejection first");
    });
  });

  // ------------------------------------------------------------------ //
  describe("Cancellation", function () {
    it("mutual cancellation: collateral becomes the client's to redeem", async function () {
      const { th, client, contractor, oracle } = await loadFixture(activeFixture);
      await time.increase(11 * DAY); // past milestone-0 deadline
      await th.connect(contractor).requestCancellation();
      await th.connect(client).respondCancellation(true);
      expect(await th.status()).to.equal(Status.Cancelled);
      const colId = await th.collateralTokenId();
      expect(await th.balanceOf(client.address, colId)).to.equal(COLLATERAL);
      expect((await th.tranches(colId)).entitled).to.equal(true);
      expect(await th.escrowReserve()).to.equal(0n);
      await th.connect(client).redeem(colId, COLLATERAL);
      await th.connect(oracle).settleRedemption(0);
      expect(await th.balanceOf(client.address, colId)).to.equal(0n);
    });

    it("a refused cancellation is enforced by the arbiter (final, no appeal)", async function () {
      const { th, client, contractor, arbiter, arbiter2 } = await loadFixture(arbitratedFixture);
      await time.increase(11 * DAY);
      await th.connect(contractor).requestCancellation();
      await th.connect(client).respondCancellation(false);
      await th.connect(contractor).callArbiter(FEE, "ipfs://c", h("c")); // auto-detects Cancellation
      expect((await th.disputes(0)).subject).to.equal(3n);
      await th.connect(arbiter).issueRuling("ipfs://ru", h("ru"), contractor.address);
      await expect(th.connect(contractor).appeal(arbiter2.address)).to.be.revertedWith(
        "TH: cancellation is final"
      );
      await th.connect(client).respondToRuling(true);
      await th.connect(contractor).respondToRuling(true);
      expect(await th.status()).to.equal(Status.Cancelled);
    });
  });
});
