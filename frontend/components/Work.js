"use client";
import { useState } from "react";
import { Action, Num, Text, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { tugrug, short } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Work({ snap, me, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);
  const isOracle = eq(me.address, snap.oracle);

  const [report, setReport] = useState("Гүйцэтгэлийн тайлан: ажил хийгдсэн.");
  const [bank, setBank] = useState("BANK-" + me.address.slice(2, 8));
  const [allowCover, setAllowCover] = useState(true);
  const [redeemId, setRedeemId] = useState("");
  const [redeemAmt, setRedeemAmt] = useState("");
  const [escrow, setEscrow] = useState("");

  const moreMilestones = snap.currentMilestone < BigInt(snap.milestoneIds.length);
  const curMilestoneId = moreMilestones
    ? snap.milestoneIds[Number(snap.currentMilestone)]
    : null;

  // entitled tokens the current account holds (for redemption convenience)
  const myEntitled = snap.tranches.filter(
    (t) => t.entitled && (t.balances[me.address] || 0n) > 0n
  );

  return (
    <div className="card">
      <h2>Ажил хүлээлгэн өгөх ба санхүүжилт татах</h2>
      <div className="section-actions">
        <Action
          n="15"
          title="Шатлал / ажлыг хүлээлгэн өгөх"
          hint={
            curMilestoneId
              ? `Одоогийн шат: токен ID ${curMilestoneId} (${tugrug(
                  snap.tranches.find((t) => t.id === curMilestoneId)?.amount || 0n
                )}). Тайланг NFT болгон илгээнэ.`
              : "Бүх шатлал хүлээлгэн өгсөн."
          }
          enabled={isContractor && moreMilestones && !snap.frozen}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Боломжгүй"}
        >
          <Text label="Тайлан" value={report} onChange={setReport} />
          <div style={{ marginTop: 10 }}>
            <Run
              onClick={() => {
                const { uri, hash } = buildNft({
                  title: "Гүйцэтгэлийн тайлан",
                  note: report,
                  milestoneId: curMilestoneId?.toString(),
                });
                return call("submitDelivery", [uri, hash]);
              }}
            >
              Тайлан илгээх
            </Run>
          </div>
        </Action>

        <Action
          n="16"
          title="Ажлыг шалгаж токений эрхийг нээх"
          hint="Захиалагч зөвшөөрвөл тухайн шатны токенууд мөнгө болох эрхтэй болно."
          enabled={isClient && moreMilestones && !snap.frozen}
          why={!isClient ? "Зөвхөн Захиалагч" : "Боломжгүй"}
        >
          <Run onClick={() => call("approveDelivery", [])}>Зөвшөөрч эрх нээх</Run>
        </Action>

        <Action
          n="25a"
          title="Банкны данс / зөвшөөрөл бүртгэх"
          hint="Токен мөнгө болоход орлого хүлээж авах банкны дансаа бүртгэнэ. Escrow хоосон үед банк нөхөж олгохыг зөвшөөрч болно."
        >
          <div className="row">
            <Text label="Банкны данс" value={bank} onChange={setBank} />
            <label style={{ display: "flex", gap: 6, alignItems: "center", alignSelf: "flex-end" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={allowCover}
                onChange={(e) => setAllowCover(e.target.checked)}
              />
              Банк нөхөн олгохыг зөвшөөрөх
            </label>
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() =>
                  call("setBankAccount", [bank, allowCover, allowCover])
                }
              >
                Хадгалах
              </Run>
            </div>
          </div>
        </Action>

        <Action
          n="25b"
          title="Токенийг тушааж мөнгө болгох (солих хүсэлт)"
          hint="Эрхтэй, идэвхтэй токенийг тушааж Escrow данснаас мөнгө авах хүсэлт гаргана."
          enabled={!snap.frozen}
          why="Гэрээ царцсан үед боломжгүй"
        >
          {myEntitled.length > 0 && (
            <div className="sub" style={{ marginBottom: 8 }}>
              Таны эрхтэй токенууд:{" "}
              {myEntitled
                .map((t) => `ID ${t.id} (${t.balances[me.address]})`)
                .join(", ")}
            </div>
          )}
          <div className="row">
            <Num label="Токен ID" value={redeemId} onChange={setRedeemId} />
            <Num label="Хэмжээ" value={redeemAmt} onChange={setRedeemAmt} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() =>
                  call("redeem", [BigInt(redeemId), BigInt(redeemAmt)])
                }
              >
                Солих хүсэлт
              </Run>
            </div>
          </div>
        </Action>

        <Action
          n="25c"
          title="Банк: Escrow үлдэгдэл мэдээлэх (Oracle)"
          enabled={isOracle}
          why="Зөвхөн Банк/Oracle"
        >
          <div className="row">
            <Num label="Escrow үлдэгдэл (₮)" value={escrow} onChange={setEscrow} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("reportEscrowBalance", [BigInt(escrow || "0")])}>
                Мэдээлэх
              </Run>
            </div>
          </div>
        </Action>

        <Action
          n="25d"
          title="Банк: солих хүсэлтийг гүйцэтгэх (Oracle)"
          hint="Escrow хүрэлцэхгүй бол 1 хоногийн дараа эзэмшигчийн зөвшөөрөлтэйгээр нөхөн олгоно."
          enabled={isOracle}
          why="Зөвхөн Банк/Oracle"
        >
          {snap.redemptions.length === 0 && (
            <div className="sub">Хүсэлт алга.</div>
          )}
          {snap.redemptions.map((r) => (
            <div
              key={r.id.toString()}
              className="row"
              style={{ justifyContent: "space-between", borderBottom: "1px dashed var(--border)", padding: "6px 0" }}
            >
              <span className="sub">
                #{r.id.toString()} · {short(r.holder)} · ID {r.tokenId.toString()} ·{" "}
                {tugrug(r.amount)} ·{" "}
                {r.settled ? (
                  <span className="badge ok">Төлөгдсөн</span>
                ) : (
                  <span className="badge warn">Хүлээгдэж буй</span>
                )}
              </span>
              {!r.settled && (
                <Run onClick={() => call("settleRedemption", [r.id])}>
                  Гүйцэтгэх
                </Run>
              )}
            </div>
          ))}
        </Action>
      </div>
    </div>
  );
}
