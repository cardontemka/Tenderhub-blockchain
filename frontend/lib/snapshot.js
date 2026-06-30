// Reads a full v2 picture of a TenderHub instance for the dashboard.
const DOC_ID_BASE = 1_000_000_000n;

export async function loadSnapshot(c, accounts) {
  const watchers = accounts.map((a) => a.address);

  const [
    client,
    contractor,
    arbiter,
    oracle,
    pendingContractor,
    pendingArbiter,
    contractorApprovedArbiter,
    status,
    frozen,
    activatedAt,
    escrowAccount,
    escrowBalance,
    escrowReserve,
    escrowDebt,
    totalFinancing,
    milestoneCount,
    currentMilestone,
    collateralTokenId,
    nextTokenId,
    nextDocId,
    contractDocId,
    disputeActive,
    activeDisputeId,
    amendState,
    amendProposer,
    deliveryRejected,
    cancelRequested,
    cancelRequester,
    cancelRefused,
    penaltyPerDay,
    warrantyDays,
    completedAt,
  ] = await Promise.all([
    c.client(),
    c.contractor(),
    c.arbiter(),
    c.oracle(),
    c.pendingContractor(),
    c.pendingArbiter(),
    c.contractorApprovedArbiter(),
    c.status(),
    c.frozen(),
    c.activatedAt(),
    c.escrowAccount(),
    c.escrowBalance(),
    c.escrowReserve(),
    c.escrowDebt(),
    c.totalFinancing(),
    c.milestoneCount(),
    c.currentMilestone(),
    c.collateralTokenId(),
    c.nextTokenId(),
    c.nextDocId(),
    c.contractDocId(),
    c.disputeActive(),
    c.activeDisputeId(),
    c.amendState(),
    c.amendProposer(),
    c.deliveryRejected(),
    c.cancelRequested(),
    c.cancelRequester(),
    c.cancelRefused(),
    c.penaltyPerDay(),
    c.warrantyDays(),
    c.completedAt(),
  ]);

  // tranches 1..nextTokenId-1 with per-watcher balances
  const tranches = [];
  for (let id = 1n; id < nextTokenId; id++) {
    const t = await c.tranches(id);
    const balances = {};
    await Promise.all(
      watchers.map(async (addr) => {
        balances[addr] = await c.balanceOf(addr, id);
      })
    );
    tranches.push({
      id,
      kind: Number(t.kind),
      amount: t.amount,
      deadlineDays: t.deadlineDays,
      entitled: t.entitled,
      delivered: t.delivered,
      beneficiary: t.beneficiary,
      balances,
    });
  }

  // milestone ids + effective deadlines
  const milestoneIds = [];
  const deadlines = [];
  for (let i = 0n; i < milestoneCount; i++) {
    milestoneIds.push(await c.milestoneIds(i));
    deadlines.push(await c.effectiveDeadline(i));
  }

  // documents
  const documents = [];
  for (let id = DOC_ID_BASE; id < nextDocId; id++) {
    const d = await c.documents(id);
    documents.push({
      id,
      hash: d.hash,
      uri: d.uri,
      timestamp: d.timestamp,
      submitter: d.submitter,
      docType: d.docType,
    });
  }

  // loans
  const loanCount = await c.loanCount();
  const loans = [];
  for (let i = 0n; i < loanCount; i++) {
    const l = await c.loans(i);
    loans.push({
      id: i,
      lender: l.lender,
      requestedAmount: l.requestedAmount,
      collateralAmount: l.collateralAmount,
      state: Number(l.state),
    });
  }

  // disputes
  const disputeCount = await c.disputeCount();
  const disputes = [];
  for (let i = 0n; i < disputeCount; i++) {
    const d = await c.disputes(i);
    disputes.push({
      id: i,
      subject: Number(d.subject),
      initiator: d.initiator,
      arbiter: d.arbiter,
      feeTokenId: d.feeTokenId,
      feeAmount: d.feeAmount,
      winner: d.winner,
      rulingTime: d.rulingTime,
      state: Number(d.state),
      clientAccepted: d.clientAccepted,
      contractorAccepted: d.contractorAccepted,
    });
  }

  // redemptions + per-holder consent
  const redemptionCount = await c.redemptionCount();
  const redemptions = [];
  for (let i = 0n; i < redemptionCount; i++) {
    const r = await c.redemptions(i);
    redemptions.push({
      id: i,
      holder: r.holder,
      tokenId: r.tokenId,
      amount: r.amount,
      requestedAt: r.requestedAt,
      settled: r.settled,
    });
  }

  return {
    client,
    contractor,
    arbiter,
    oracle,
    pendingContractor,
    pendingArbiter,
    contractorApprovedArbiter,
    status: Number(status),
    frozen,
    activatedAt,
    escrowAccount,
    escrowBalance,
    escrowReserve,
    escrowDebt,
    totalFinancing,
    milestoneIds,
    deadlines,
    currentMilestone,
    collateralTokenId,
    contractDocId,
    disputeActive,
    activeDisputeId,
    amendState: Number(amendState),
    amendProposer,
    deliveryRejected,
    cancelRequested,
    cancelRequester,
    cancelRefused,
    penaltyPerDay,
    warrantyDays,
    completedAt,
    tranches,
    documents,
    loans,
    disputes,
    redemptions,
    snapshotAt: Date.now(), // wall-clock at read time (used to freeze the timer when paused)
  };
}
