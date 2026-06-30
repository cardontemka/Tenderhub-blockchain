// Simulated off-chain bank for the PoC.
//
// - It NEVER acts as an on-chain party; it only uses the registered `oracle`
//   account and reads authoritative on-chain state, so it cannot accept false data.
// - Personal balances (everyone starts at 100,000 ₮) are derived deterministically
//   from on-chain events, so they stay in sync no matter who refreshes.
// - It automatically: assesses penalties, finalizes rulings past the window, and
//   settles redemption requests (respecting the escrow reserve, the 1-day cover
//   delay and the holder's consent).
import { getContractWrite } from "./chain";

export const START_BALANCE = 100000n;

export function acctNumber(index) {
  return "MN-" + String(100100 + index);
}

// Deterministically rebuild every party's bank balance from chain events.
export async function computeBankBalances(read, accounts) {
  const bal = {};
  accounts.forEach((a) => (bal[a.address] = START_BALANCE));
  const sub = (addr, amt) => {
    if (bal[addr] !== undefined) bal[addr] -= amt;
  };
  const add = (addr, amt) => {
    if (bal[addr] !== undefined) bal[addr] += amt;
  };

  try {
    const acts = await read.queryFilter(read.filters.ContractActivated());
    for (const e of acts) sub(e.args.contractor, e.args.collateral);
    const funded = await read.queryFilter(read.filters.EscrowFunded());
    for (const e of funded) sub(e.args.from, e.args.amount);
    const calls = await read.queryFilter(read.filters.ArbiterCalled());
    for (const e of calls) sub(e.args.initiator, e.args.feeAmount);
    const settled = await read.queryFilter(read.filters.RedemptionSettled());
    for (const e of settled) add(e.args.holder, e.args.amount);
    // A loan: when collateral moves to the lender, the lender disburses the loan
    // principal (== collateral here) to the contractor.
    const contractor = await read.contractor();
    const loans = await read.queryFilter(read.filters.LoanTransferred());
    for (const e of loans) {
      sub(e.args.lender, e.args.collateralAmount);
      add(contractor, e.args.collateralAmount);
    }
  } catch (e) {
    console.warn("bank balance scan failed", e);
  }
  return bal;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function canSettle(snap, r) {
  if (snap.frozen) return false;
  const t = snap.tranches.find((x) => x.id === r.tokenId);
  if (!t) return false;
  const amount = r.amount;
  if (t.kind === 1 /* Collateral */) {
    return snap.escrowBalance >= amount;
  }
  // Non-collateral: pay from escrow if possible, otherwise the bank covers it
  // IMMEDIATELY by lending to the Client (no waiting; interest handled off-chain).
  return true;
}

// Returns whether assessing penalties now would change anything (avoid tx spam).
function shouldAssess(snap) {
  if (snap.status !== 2 /* Active */ || snap.frozen) return false;
  if (snap.penaltyPerDay === 0n) return false;
  // any overdue milestone or any pending response past grace is enough of a hint;
  // the contract is idempotent so an occasional no-op is harmless.
  const now = nowSec();
  const idx = Number(snap.currentMilestone);
  const dl = snap.deadlines[idx];
  if (dl && now > Number(dl)) return true;
  return false;
}

// Run one automation pass using the oracle account. Returns a list of actions taken.
export async function bankAutomation(address, oracleWallet, snap) {
  const w = getContractWrite(address, oracleWallet);
  const done = [];

  if (shouldAssess(snap)) {
    try {
      const tx = await w.assessPenalties();
      await tx.wait();
      done.push("алданги тооцов");
    } catch {}
  }

  if (snap.disputeActive) {
    const d = snap.disputes[Number(snap.activeDisputeId) - 1];
    if (d && d.state === 2 && nowSec() >= Number(d.rulingTime) + 7 * 24 * 60 * 60) {
      try {
        const tx = await w.finalizeRuling();
        await tx.wait();
        done.push("тогтоол эцэслэв");
      } catch {}
    }
  }

  // Auto-return the collateral bond after the warranty period on completion.
  if (snap.status === 5 /* Completed */) {
    const col = snap.tranches.find((t) => t.id === snap.collateralTokenId);
    const ready = nowSec() >= Number(snap.completedAt) + Number(snap.warrantyDays) * 24 * 60 * 60;
    if (col && !col.entitled && ready) {
      try {
        const tx = await w.releaseWarranty();
        await tx.wait();
        done.push("барьцаа буцаав");
      } catch {}
    }
  }

  for (const r of snap.redemptions) {
    if (r.settled) continue;
    if (!canSettle(snap, r)) continue;
    try {
      const tx = await w.settleRedemption(r.id);
      await tx.wait();
      done.push("солилт #" + r.id.toString());
    } catch {}
  }

  return done;
}
