"use client";
import { useState } from "react";
import { Action, Num, Text, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { tugrug, short, TRANCHE_KIND } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Work({ snap, me, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);

  const [report, setReport] = useState("Гүйцэтгэлийн тайлан: ажил хийгдсэн.");
  const [fund, setFund] = useState("50000");
  const [reason, setReason] = useState("Шалтгаан / тайлбар…");
  const [fee, setFee] = useState("2000");
  const [complaint, setComplaint] = useState("Ажлыг үндэслэлгүй татгалзав.");
  const [redeemId, setRedeemId] = useState("");
  const [redeemAmt, setRedeemAmt] = useState("");
  const isCompleted = snap.status === 5;
  const colTranche = snap.tranches.find((t) => t.id === snap.collateralTokenId);

  const moreMilestones = snap.currentMilestone < BigInt(snap.milestoneIds.length);
  const curId = moreMilestones ? snap.milestoneIds[Number(snap.currentMilestone)] : null;
  const curTranche = curId ? snap.tranches.find((t) => t.id === curId) : null;
  const delivered = curTranche?.delivered;

  // tokens I hold that are entitled (redeemable)
  const myEntitled = snap.tranches.filter(
    (t) => t.entitled && (t.balances[me.address] || 0n) > 0n
  );

  return (
    <div className="card">
      <h2>2. Ажил хүлээлгэн өгөх ба санхүүжилт татах</h2>
      <div className="section-actions">
        <Action
          n="15"
          title="Шат / ажлыг хүлээлгэн өгөх"
          hint={
            curId
              ? `Одоогийн шат #${Number(snap.currentMilestone) + 1}: ${tugrug(curTranche.amount)}. Тайланг NFT болгон илгээнэ.`
              : "Бүх шат хүлээлгэн өгсөн."
          }
          enabled={isContractor && moreMilestones && snap.status === 2}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Боломжгүй (идэвхгүй/царцсан)"}
        >
          {snap.deliveryRejected && isContractor && (
            <div style={{ marginBottom: 10 }}>
              <div className="disabled-note" style={{ marginBottom: 8 }}>
                ⚠ Таны ажил татгалзагдсан. Дахин илгээхийн тулд татгалзлыг хүлээн зөвшөөрөх,
                эс зөвшөөрвөл хажуугийн товчоор Арбитр дуудна.
              </div>
              <div className="row">
                <Run onClick={() => call("acceptDeliveryRejection", [])}>Татгалзлыг хүлээн зөвшөөрөх</Run>
                <Num label="Арбитрын хөлс (₮)" value={fee} onChange={setFee} />
                <Text label="Гомдол" value={complaint} onChange={setComplaint} />
                <div style={{ alignSelf: "flex-end" }}>
                  <Run kind="secondary" onClick={() => {
                    const { uri, hash } = buildNft({ title: "Өргөдөл / Гомдол", note: complaint });
                    return call("callArbiter", [BigInt(fee), uri, hash], BigInt(fee || "0"));
                  }}>Арбитр дуудах</Run>
                </div>
              </div>
            </div>
          )}
          <Text label="Тайлан" value={report} onChange={setReport} />
          <div style={{ marginTop: 10 }}>
            <Run
              onClick={() => {
                const { uri, hash } = buildNft({ title: "Гүйцэтгэлийн тайлан", note: report });
                return call("submitDelivery", [uri, hash]);
              }}
            >
              Тайлан илгээх
            </Run>
          </div>
        </Action>

        <Action
          n="16"
          title="Ажлыг шалгаж эрх нээх / татгалзах"
          hint="Зөвхөн гүйцэтгэгч ажлаа илгээсний дараа идэвхжинэ. Зөвшөөрөх болон татгалзах аль алинд нь шалтгаа­ны тайлбарыг NFT болгон хавсаргана."
          enabled={isClient && delivered && snap.status === 2}
          why={!isClient ? "Зөвхөн Захиалагч" : "Гүйцэтгэгч ажлаа илгээгээгүй байна"}
        >
          <Text label="Шалтгаан / тайлбар" value={reason} onChange={setReason} />
          <div className="row" style={{ marginTop: 8 }}>
            <Run
              onClick={() => {
                const { uri, hash } = buildNft({ title: "Ажил зөвшөөрсөн", note: reason });
                return call("approveDelivery", [uri, hash]);
              }}
            >
              Зөвшөөрч эрх нээх
            </Run>
            <Run
              kind="danger"
              onClick={() => {
                const { uri, hash } = buildNft({ title: "Ажил татгалзсан", note: reason });
                return call("rejectDelivery", [uri, hash]);
              }}
            >
              Татгалзах
            </Run>
          </div>
        </Action>

        <Action
          n="—"
          title="Баталгаат хугацааны дараа барьцаа буцаах"
          hint="Гэрээ амжилттай дуусаж баталгаат хугацаа өнгөрсний дараа барьцаа Гүйцэтгэгч рүү шилжиж мөнгө болох эрхтэй болно. Банк автоматаар гүйцэтгэдэг."
          enabled={isCompleted && colTranche && !colTranche.entitled}
          why="Гэрээ дуусаагүй эсвэл барьцаа аль хэдийн буцсан"
        >
          <Run onClick={() => call("releaseWarranty", [])}>Барьцаа буцаах</Run>
        </Action>

        <Action
          n="25*"
          title="Захиалагч: Escrow данс санхүүжүүлэх"
          hint="Захиалагч тендерийн мөнгийг Escrow данс руу тушаана (банкны данснаас хасагдана). Энэ мөнгөөр токенуудыг солино. Хэрэв тушаахгүй бол банк Захиалагчийн нэр дээр зээл гарган 1 хоногийн дотр нөхөн олгоно."
          enabled={isClient}
          why="Зөвхөн Захиалагч"
        >
          <div className="row">
            <Text label="Дүн (₮)" value={fund} onChange={setFund} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("fundEscrow", [BigInt(fund || "0")], BigInt(fund || "0"))}>Escrow санхүүжүүлэх</Run>
            </div>
          </div>
        </Action>

        <Action
          n="25b"
          title="Токенийг тушааж мөнгө болгох (солих хүсэлт)"
          hint="Эрхтэй токеноо сонгож солих хүсэлт гаргана. Банк автоматаар шалгаж Escrow данснаас мөнгийг тань данс руу шилжүүлнэ."
          enabled={!snap.frozen}
          why="Гэрээ царцсан үед боломжгүй"
        >
          <div className="row">
            <div style={{ flex: 1, minWidth: 220 }}>
              <label>Миний эрхтэй токен</label>
              <select
                value={redeemId}
                onChange={(e) => {
                  setRedeemId(e.target.value);
                  const t = myEntitled.find((x) => x.id.toString() === e.target.value);
                  if (t) setRedeemAmt((t.balances[me.address] || 0n).toString());
                }}
              >
                <option value="">— сонгох —</option>
                {myEntitled.map((t) => (
                  <option key={t.id.toString()} value={t.id.toString()}>
                    ID {t.id.toString()} · {TRANCHE_KIND[t.kind]} · үлдэгдэл {t.balances[me.address].toString()}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label>Хэмжээ</label>
              <input type="number" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("redeem", [BigInt(redeemId), BigInt(redeemAmt)])}>Солих хүсэлт</Run>
            </div>
          </div>
          {myEntitled.length === 0 && <div className="sub" style={{ marginTop: 6 }}>Танд эрхтэй токен алга.</div>}
        </Action>

        <Action n={null} title="Солих хүсэлтүүд (банк автоматаар гүйцэтгэнэ)">
          {snap.redemptions.length === 0 && <div className="sub">Хүсэлт алга.</div>}
          {snap.redemptions.map((r) => (
            <div key={r.id.toString()} className="kv">
              <span className="sub">
                #{r.id.toString()} · {short(r.holder)} · ID {r.tokenId.toString()} · {tugrug(r.amount)}
              </span>
              {r.settled ? <span className="badge ok">Төлөгдсөн</span> : <span className="badge warn">Хүлээгдэж буй…</span>}
            </div>
          ))}
        </Action>
      </div>
    </div>
  );
}
