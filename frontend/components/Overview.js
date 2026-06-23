"use client";
import {
  STATUS_MN,
  TRANCHE_KIND,
  short,
  tugrug,
  ts,
  ROLE,
} from "../lib/format";
import { decodeNft } from "../lib/nft";

function nameFor(addr, snap, accounts) {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return "—";
  const a = accounts.find((x) => x.address.toLowerCase() === addr.toLowerCase());
  if (addr.toLowerCase() === snap.client.toLowerCase()) return "Захиалагч";
  if (addr.toLowerCase() === snap.contractor.toLowerCase()) return "Гүйцэтгэгч";
  if (addr.toLowerCase() === snap.arbiter.toLowerCase()) return "Арбитр";
  if (addr.toLowerCase() === snap.oracle.toLowerCase()) return "Банк/Oracle";
  return a ? a.role : short(addr);
}

export default function Overview({ snap, accounts, address }) {
  const watchers = accounts.slice(0, 6); // show first 6 in balance table
  return (
    <div className="card">
      <h2>Тойм / Overview</h2>

      <div className="pill-row">
        <span className="badge ok">{STATUS_MN[snap.status]}</span>
        {snap.frozen ? (
          <span className="badge danger">ЦАРЦСАН (Идэвхгүй)</span>
        ) : (
          <span className="badge ok">Идэвхтэй</span>
        )}
        {snap.disputeActive && (
          <span className="badge warn">Маргаан хянагдаж байна</span>
        )}
        {snap.amendmentPending && (
          <span className="badge warn">Өөрчлөлт хүлээгдэж буй</span>
        )}
        {snap.amendmentApproved && (
          <span className="badge ok">Өөрчлөлт зөвшөөрөгдсөн</span>
        )}
      </div>

      <div className="grid2">
        <div>
          <div className="kv">
            <span>Захиалагч</span>
            <span className="mono">{short(snap.client)}</span>
          </div>
          <div className="kv">
            <span>Гүйцэтгэгч</span>
            <span className="mono">{short(snap.contractor) || "—"}</span>
          </div>
          <div className="kv">
            <span>Арбитр</span>
            <span className="mono">{short(snap.arbiter)}</span>
          </div>
          <div className="kv">
            <span>Банк / Oracle</span>
            <span className="mono">{short(snap.oracle)}</span>
          </div>
        </div>
        <div>
          <div className="kv">
            <span>Escrow данс</span>
            <span className="mono">{snap.escrowAccount}</span>
          </div>
          <div className="kv">
            <span>Escrow үлдэгдэл</span>
            <span>{tugrug(snap.escrowBalance)}</span>
          </div>
          <div className="kv">
            <span>Нийт санхүүжилт</span>
            <span>{tugrug(snap.totalFinancing)}</span>
          </div>
          <div className="kv">
            <span>Идэвхжсэн</span>
            <span>{ts(snap.activatedAt)}</span>
          </div>
        </div>
      </div>

      <h3>Токенууд (Tranches) ба эзэмшил</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Төрөл</th>
            <th>Хэмжээ</th>
            <th>Эрх</th>
            <th>Хүлээлгэн өгсөн</th>
            {watchers.map((w) => (
              <th key={w.address}>{w.role.split(" ")[0]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.tranches.length === 0 && (
            <tr>
              <td colSpan={5 + watchers.length} className="sub">
                Токен үүсээгүй байна.
              </td>
            </tr>
          )}
          {snap.tranches.map((t) => (
            <tr key={t.id.toString()}>
              <td>{t.id.toString()}</td>
              <td>{TRANCHE_KIND[t.kind]}</td>
              <td>{tugrug(t.amount)}</td>
              <td>
                {t.entitled ? (
                  <span className="badge ok">Эрхтэй</span>
                ) : (
                  <span className="badge muted">Эрхгүй</span>
                )}
              </td>
              <td>{t.delivered ? "✓" : "—"}</td>
              {watchers.map((w) => (
                <td key={w.address}>
                  {t.balances[w.address] > 0n
                    ? t.balances[w.address].toString()
                    : "·"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Баримт бичгүүд (NFT)</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Төрөл</th>
            <th>Илгээгч</th>
            <th>Огноо</th>
            <th>Hash</th>
            <th>Контент</th>
          </tr>
        </thead>
        <tbody>
          {snap.documents.length === 0 && (
            <tr>
              <td colSpan={6} className="sub">
                Баримт алга.
              </td>
            </tr>
          )}
          {snap.documents.map((d) => {
            const meta = decodeNft(d.uri);
            return (
              <tr key={d.id.toString()}>
                <td>{d.id.toString()}</td>
                <td>{d.docType}</td>
                <td>{nameFor(d.submitter, snap, accounts)}</td>
                <td>{ts(d.timestamp)}</td>
                <td className="mono">{d.hash.slice(0, 10)}…</td>
                <td className="sub">
                  {meta ? meta.title || meta.note || JSON.stringify(meta).slice(0, 40) : d.uri.slice(0, 30)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
