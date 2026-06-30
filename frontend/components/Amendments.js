"use client";
import { useState } from "react";
import { Action, Num, Text, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { AMEND_STATE, short, tugrug } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Amendments({ snap, me, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);
  const isParty = isClient || isContractor;
  const isProposer = eq(me.address, snap.amendProposer);

  const [reason, setReason] = useState("Гэрээнд өөрчлөлт оруулах шалтгаан…");
  const [topUp, setTopUp] = useState({}); // idx -> {amt, days}
  const [newAmounts, setNewAmounts] = useState("");
  const [newDays, setNewDays] = useState("");
  const [fee, setFee] = useState("2000");
  const [complaint, setComplaint] = useState("Өөрчлөлтийг үндэслэлгүй татгалзав.");

  const parse = (s) =>
    s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => BigInt(x));

  function stage() {
    const idx = [], amt = [], days = [];
    snap.milestoneIds.forEach((_, i) => {
      if (BigInt(i) < snap.currentMilestone) return; // skip completed milestones
      const row = topUp[i];
      if (!row) return;
      const a = BigInt(row.amt || "0");
      const d = BigInt(row.days || "0");
      if (a > 0n || d > 0n) {
        idx.push(BigInt(i));
        amt.push(a);
        days.push(d);
      }
    });
    const { uri, hash } = buildNft({ title: "Гэрээний өөрчлөлтийн санал", note: reason });
    return call("stageAmendment", [uri, hash, idx, amt, days, parse(newAmounts), parse(newDays)]);
  }

  return (
    <div className="card">
      <h2>5. Гэрээнд өөрчлөлт оруулах (Функц 22–23)</h2>
      <div className="pill-row">
        <span className="badge muted">Төлөв: {AMEND_STATE[snap.amendState]}</span>
        {snap.amendState > 0 && <span className="sub">Санал гаргасан: {short(snap.amendProposer)}</span>}
      </div>

      <div className="section-actions">
        <Action
          n="22"
          title="Өөрчлөлт санал болгох (аль ч тал)"
          hint="Шалтгааны NFT + нэмэлт санхүүжилт/хугацаа эсвэл шинэ шатлалыг нэг дор илгээнэ (зөвхөн нэмэгдүүлэх). Санал гаргагч өөрөө зөвшөөрсөнд тооцогдох тул нөгөө тал л баталбал хэрэгжинэ."
          enabled={isParty && snap.amendState === 0 && (snap.status === 2 || snap.status === 3) && !snap.deliveryRejected}
          why={!isParty ? "Зөвхөн тал" : snap.deliveryRejected ? "Эхлээд ажлын татгалзлыг шийд" : "Өөрчлөлт явагдаж буй / гэрээ тохиромжгүй"}
        >
          <Text label="Шалтгаан" value={reason} onChange={setReason} />
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Шат</th><th>Одоогийн дүн</th><th>+ Дүн</th><th>+ Хоног</th></tr></thead>
            <tbody>
              {snap.milestoneIds.map((id, i) => {
                const t = snap.tranches.find((x) => x.id === id);
                const done = BigInt(i) < snap.currentMilestone; // already approved -> not editable
                return (
                  <tr key={id.toString()}>
                    <td>#{i + 1}</td>
                    <td>{t ? tugrug(t.amount) : "—"}</td>
                    {done ? (
                      <td colSpan={2} className="sub">✓ дууссан (өөрчлөх боломжгүй)</td>
                    ) : (
                      <>
                        <td><input type="number" placeholder="0" value={topUp[i]?.amt || ""}
                          onChange={(e) => setTopUp({ ...topUp, [i]: { ...topUp[i], amt: e.target.value } })} /></td>
                        <td><input type="number" placeholder="0" value={topUp[i]?.days || ""}
                          onChange={(e) => setTopUp({ ...topUp, [i]: { ...topUp[i], days: e.target.value } })} /></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <Text label="Шинэ шатлалын дүн (₮, таслалаар)" value={newAmounts} onChange={setNewAmounts} />
            <Text label="Шинэ шатлалын хугацаа (хоног)" value={newDays} onChange={setNewDays} />
            <div style={{ alignSelf: "flex-end" }}><Run onClick={stage}>Санал илгээх</Run></div>
          </div>
        </Action>

        <Action
          n="23"
          title="Өөрчлөлтийг зөвшөөрөх / татгалзах"
          hint="Санал гаргагчаас бусад тал баталснаар өөрчлөлт хэрэгжинэ."
          enabled={isParty && snap.amendState === 1 && !isProposer}
          why={isProposer ? "Та санал гаргасан тул аль хэдийн зөвшөөрсөн" : "Зөвхөн нөгөө тал, төлөвлөсөн байх"}
        >
          <div className="row">
            <Run onClick={() => call("respondToAmendment", [true])}>Зөвшөөрөх</Run>
            <Run kind="danger" onClick={() => call("respondToAmendment", [false])}>Татгалзах</Run>
          </div>
        </Action>

        <Action
          n="23*"
          title="Татгалзсан өөрчлөлтийг шийдэх (санал гаргагч)"
          hint="Татгалзлыг хүлээн зөвшөөрвөл шинээр санал гаргана. Эс зөвшөөрвөл хажуугийн товчоор Арбитр дуудна."
          enabled={isParty && snap.amendState === 2 && isProposer}
          why={!isProposer ? "Зөвхөн санал гаргагч" : "Татгалзсан өөрчлөлт алга"}
        >
          <div className="row">
            <Run onClick={() => call("acceptAmendmentRejection", [])}>Татгалзлыг хүлээн зөвшөөрөх</Run>
            <Num label="Арбитрын хөлс (₮)" value={fee} onChange={setFee} />
            <Text label="Гомдол" value={complaint} onChange={setComplaint} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run kind="secondary" onClick={() => {
                const { uri, hash } = buildNft({ title: "Өргөдөл / Гомдол", note: complaint });
                return call("callArbiter", [BigInt(fee), uri, hash], BigInt(fee || "0"));
              }}>Арбитр дуудах</Run>
            </div>
          </div>
        </Action>
      </div>
    </div>
  );
}
