// Reads a full picture of a TenderHub instance for the dashboard.
const DOC_ID_BASE = 1_000_000_000n;

export async function loadSnapshot(c, accounts) {
  const [
    client,
    contractor,
    arbiter,
    oracle,
    pendingContractor,
    pendingArbiter,
    contractorApprovedArbiter,
    collateralConfirmed,
    status,
    frozen,
    activatedAt,
    escrowAccount,
    escrowBalance,
    totalFinancing,
    advanceId,
    milestoneCount,
    currentMilestone,
    nextTokenId,
    nextDocId,
    contractDocId,
    disputeActive,
    activeDisputeId,
    amendmentPending,
    amendmentProposer,
    amendmentApproved,
  ] = await Promise.all([
    c.client(),
    c.contractor(),
    c.arbiter(),
    c.oracle(),
    c.pendingContractor(),
    c.pendingArbiter(),
    c.contractorApprovedArbiter(),
    c.collateralConfirmed(),
    c.status(),
    c.frozen(),
    c.activatedAt(),
    c.escrowAccount(),
    c.escrowBalance(),
    c.totalFinancing(),
    c.advanceId(),
    c.milestoneCount(),
    c.currentMilestone(),
    c.nextTokenId(),
    c.nextDocId(),
    c.contractDocId(),
    c.disputeActive(),
    c.activeDisputeId(),
    c.amendmentPending(),
    c.amendmentProposer(),
    c.amendmentApproved(),
  ]);

  // Financing / fee tranches: ids 1 .. nextTokenId-1
  const tranches = [];
  const watchers = accounts.map((a) => a.address);
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
      deadlineOffset: t.deadlineOffset,
      entitled: t.entitled,
      delivered: t.delivered,
      beneficiary: t.beneficiary,
      balances,
    });
  }

  // Milestone ids in order
  const milestoneIds = [];
  for (let i = 0n; i < milestoneCount; i++) {
    milestoneIds.push(await c.milestoneIds(i));
  }

  // Document NFTs: ids DOC_ID_BASE .. nextDocId-1
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

  // Loans
  const loanCount = await c.loanCount();
  const loans = [];
  for (let i = 0n; i < loanCount; i++) {
    const l = await c.loans(i);
    loans.push({
      id: i,
      lender: l.lender,
      tokenId: l.tokenId,
      requestedAmount: l.requestedAmount,
      collateralAmount: l.collateralAmount,
      termsDocId: l.termsDocId,
      contractDocId: l.contractDocId,
      lenderBank: l.lenderBank,
      state: Number(l.state),
      contractorAccepted: l.contractorAccepted,
      clientApproved: l.clientApproved,
    });
  }

  // Disputes
  const disputeCount = await c.disputeCount();
  const disputes = [];
  for (let i = 0n; i < disputeCount; i++) {
    const d = await c.disputes(i);
    disputes.push({
      id: i,
      initiator: d.initiator,
      arbiter: d.arbiter,
      feeTokenId: d.feeTokenId,
      feeAmount: d.feeAmount,
      complaintDocId: d.complaintDocId,
      rulingDocId: d.rulingDocId,
      winner: d.winner,
      rulingTime: d.rulingTime,
      state: Number(d.state),
      clientAccepted: d.clientAccepted,
      contractorAccepted: d.contractorAccepted,
    });
  }

  // Redemptions
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
    collateralConfirmed,
    status: Number(status),
    frozen,
    activatedAt,
    escrowAccount,
    escrowBalance,
    totalFinancing,
    advanceId,
    milestoneIds,
    currentMilestone,
    contractDocId,
    disputeActive,
    activeDisputeId,
    amendmentPending,
    amendmentProposer,
    amendmentApproved,
    tranches,
    documents,
    loans,
    disputes,
    redemptions,
  };
}
