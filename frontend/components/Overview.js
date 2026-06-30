"use client";
import { STATUS_MN, TRANCHE_KIND, short, tugrug, countdown } from "../lib/format";
import { acctNumber } from "../lib/bank";
import Documents from "./Documents";

function nameFor(addr, snap, accounts) {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return "—";
  if (addr.toLowerCase() === snap.client.toLowerCase()) return "Захиалагч";
  if (addr.toLowerCase() === (snap.contractor || "").toLowerCase()) return "Гүйцэтгэгч";
  if (addr.toLowerCase() === (snap.arbiter || "").toLowerCase()) return "Арбитр";
  if (addr.toLowerCase() === snap.oracle.toLowerCase()) return "Банк/Oracle";
  const a = accounts.find((x) => x.address.toLowerCase() === addr.toLowerCase());
  return a ? a.role.split(" ")[0] : short(addr);
}

export default function Overview({ snap, accounts, bankBalances }) {
  const watchers = accounts.slice(0, 6);
  const idx = Number(snap.currentMilestone);
  const curDeadline = snap.deadlines[idx];
  // While frozen/suspended/cancelled the on-chain clock is paused, so freeze the
  // displayed timer too (use the snapshot's read-time as a fixed reference).
  const paused = snap.frozen || snap.status === 3 || snap.status === 4;
  const cd = curDeadline ? countdown(curDeadline, paused ? snap.snapshotAt : undefined) : null;

  return (
    <div className="card">
      <h2>Тойм / Overview</h2>

      <div className="pill-row">
        <span className="badge ok">{STATUS_MN[snap.status]}</span>
        {snap.frozen && <span className="badge danger">ЦАРЦСАН (маргаан)</span>}
        {snap.disputeActive && <span className="badge warn">Маргаан хянагдаж буй</span>}
        {snap.amendState > 0 && <span className="badge warn">Өөрчлөлт явагдаж буй</span>}
        {snap.cancelRequested && <span className="badge danger">Цуцлах хүсэлт</span>}
        {snap.deliveryRejected && <span className="badge warn">Ажил татгалзагдсан</span>}
        {snap.status === 5 && <span className="badge ok">Дууссан (баталгаат хугацаа)</span>}
      </div>

      <div className="grid2">
        <div>
          <div className="kv"><span>Захиалагч</span><span className="mono">{short(snap.client)}</span></div>
          <div className="kv"><span>Гүйцэтгэгч</span><span className="mono">{short(snap.contractor)}</span></div>
          <div className="kv"><span>Арбитр</span><span className="mono">{short(snap.arbiter)}</span></div>
          <div className="kv"><span>Банк / Oracle</span><span className="mono">{short(snap.oracle)}</span></div>
        </div>
        <div>
          <div className="kv"><span>Escrow данс</span><span className="mono">{snap.escrowAccount}</span></div>
          <div className="kv"><span>Escrow үлдэгдэл</span><span>{tugrug(snap.escrowBalance)}</span></div>
          <div className="kv"><span>Escrow доод нөөц (барьцаа)</span><span>{tugrug(snap.escrowReserve)}</span></div>
          <div className="kv">
            <span>Escrow банкны өр</span>
            <span className={snap.escrowDebt > 0n ? "badge danger" : ""}>{tugrug(snap.escrowDebt)}</span>
          </div>
          <div className="kv"><span>Нийт санхүүжилт</span><span>{tugrug(snap.totalFinancing)}</span></div>
          <div className="kv"><span>Өдрийн алданги (0.02%)</span><span>{tugrug(snap.penaltyPerDay)}</span></div>
        </div>
      </div>

      {snap.status === 2 && cd && (
        <div
          className="kv"
          style={{ marginTop: 8, fontSize: 13, borderBottom: "none" }}
        >
          <span>Одоогийн шат #{idx + 1} эцсийн хугацаа</span>
          <span className={paused ? "badge muted" : cd.overdue ? "badge danger" : "badge ok"}>
            {paused ? `⏸ зогссон · ${cd.text}` : cd.text}
          </span>
        </div>
      )}

      <h3>Банкны дансны үлдэгдэл (симуляц)</h3>
      <table>
        <thead>
          <tr><th>Хэрэглэгч</th><th>Данс</th><th>Үлдэгдэл</th></tr>
        </thead>
        <tbody>
          {watchers.map((w) => (
            <tr key={w.address}>
              <td>{w.role}</td>
              <td className="mono">{acctNumber(w.index)}</td>
              <td>{bankBalances ? tugrug(bankBalances[w.address] ?? 0n) : "…"}</td>
            </tr>
          ))}
          <tr>
            <td><b>Escrow (тендер)</b></td>
            <td className="mono">{snap.escrowAccount}</td>
            <td><b>{tugrug(snap.escrowBalance)}</b></td>
          </tr>
        </tbody>
      </table>

      <h3>Токенууд (Tranches)</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Төрөл</th><th>Хэмжээ</th><th>Эрх</th>
            {watchers.map((w) => (<th key={w.address}>{w.role.split(" ")[0]}</th>))}
          </tr>
        </thead>
        <tbody>
          {snap.tranches.length === 0 && (
            <tr><td colSpan={4 + watchers.length} className="sub">Токен үүсээгүй.</td></tr>
          )}
          {snap.tranches.map((t) => (
            <tr key={t.id.toString()}>
              <td>{t.id.toString()}</td>
              <td>{TRANCHE_KIND[t.kind]}</td>
              <td>{tugrug(t.amount)}</td>
              <td>{t.entitled ? <span className="badge ok">Эрхтэй</span> : <span className="badge muted">Эрхгүй</span>}</td>
              {watchers.map((w) => (
                <td key={w.address}>{t.balances[w.address] > 0n ? t.balances[w.address].toString() : "·"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <Documents
        documents={snap.documents}
        label={(addr) => nameFor(addr, snap, accounts)}
      />
    </div>
  );
}
