"use client";
import { useState } from "react";
import { Action, Num, Text, AddressSelect, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { DISPUTE_STATE, short, tugrug, ts } from "../lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Disputes({ snap, me, accounts, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);
  const isParty = isClient || isContractor;
  const isArbiter = eq(me.address, snap.arbiter);
  const hasArbiter = snap.arbiter !== ZERO;

  const active = snap.disputeActive
    ? snap.disputes[Number(snap.activeDisputeId) - 1]
    : null;
  const isActiveArbiter = active && eq(me.address, active.arbiter);

  const [fee, setFee] = useState("50");
  const [complaint, setComplaint] = useState("Гомдол: нөхцөл зөрчигдсөн.");
  const [ruling, setRuling] = useState("Шийдвэр: ...");
  const [winner, setWinner] = useState("");
  const [newArb, setNewArb] = useState("");
  const [appealFee, setAppealFee] = useState("60");

  return (
    <div className="card">
      <h2>Арбитр, маргаан, давж заалдах (Функц 17–24)</h2>

      {active && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
            background: "var(--panel-2)",
          }}
        >
          <b>Идэвхтэй маргаан #{active.id.toString()}</b>{" "}
          <span className="badge warn">{DISPUTE_STATE[active.state]}</span>
          <div className="sub" style={{ marginTop: 6 }}>
            Дуудсан: {short(active.initiator)} · Арбитр: {short(active.arbiter)} ·
            Хөлс: {tugrug(active.feeAmount)} (токен ID {active.feeTokenId.toString()})
          </div>
          {active.state >= 2 && (
            <div className="sub">
              Зөв тал: <b>{short(active.winner)}</b> · Шийдвэрийн огноо:{" "}
              {ts(active.rulingTime)} · Захиалагч{" "}
              {active.clientAccepted ? "✓" : "—"} / Гүйцэтгэгч{" "}
              {active.contractorAccepted ? "✓" : "—"}
            </div>
          )}
        </div>
      )}

      <div className="section-actions">
        <Action
          n="17 / 24"
          title="Арбитр дуудах (гэрээг царцаах)"
          hint="Арбитрын хөлсийг Escrow-д тушааж, тэнцэх хэмжээний хөлсний токен арбитрт үүснэ. Гэрээ ИДЭВХГҮЙ болж хугацаа зогсоно."
          enabled={isParty && hasArbiter && !snap.frozen}
          why={!isParty ? "Зөвхөн тал" : !hasArbiter ? "Эхлээд арбитр томил" : "Аль хэдийн царцсан"}
        >
          <div className="row">
            <Num label="Арбитрын хөлс (₮)" value={fee} onChange={setFee} />
            <Text label="Гомдол" value={complaint} onChange={setComplaint} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() => {
                  const { uri, hash } = buildNft({
                    title: "Өргөдөл / Гомдол",
                    note: complaint,
                  });
                  return call("callArbiter", [BigInt(fee), uri, hash]);
                }}
              >
                Дуудах
              </Run>
            </div>
          </div>
        </Action>

        <Action
          n="18"
          title="Арбитрын шийдвэр гаргах"
          hint="Шийдвэрийн тайланг NFT болгон, зөв гэж үзсэн талыг сонгоно. 7 хоногийн давж заалдах хугацаа эхэлнэ."
          enabled={isActiveArbiter && active && active.state === 1}
          why="Зөвхөн тухайн маргааны арбитр"
        >
          <div className="row">
            <Text label="Шийдвэр" value={ruling} onChange={setRuling} />
            <AddressSelect
              label="Зөв тал"
              value={winner}
              onChange={setWinner}
              accounts={accounts.filter(
                (a) =>
                  eq(a.address, snap.client) || eq(a.address, snap.contractor)
              )}
            />
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() => {
                  const { uri, hash } = buildNft({
                    title: "Арбитрын тогтоол",
                    note: ruling,
                    winner,
                  });
                  return call("issueRuling", [uri, hash, winner]);
                }}
              >
                Шийдвэр гаргах
              </Run>
            </div>
          </div>
        </Action>

        <Action
          n="19"
          title="Тогтоолыг хүлээн зөвшөөрөх"
          hint="Хоёр тал зөвшөөрвөл шийдвэр шууд хэрэгжинэ. Эсэргүүцвэл доорх давж заалдахыг ашиглана."
          enabled={isParty && active && active.state === 2}
          why="Зөвхөн тал, шийдвэр гарсан байх"
        >
          <Run onClick={() => call("respondToRuling", [true])}>
            Зөвшөөрөх
          </Run>
        </Action>

        <Action
          n="—"
          title="7 хоног өнгөрсний дараа эцэслэх"
          hint="Хэн ч давж заалдаагүй бол 7 хоногийн дараа шийдвэрийг эцэслэнэ."
          enabled={active && active.state === 2}
        >
          <Run onClick={() => call("finalizeRuling", [])}>Эцэслэх</Run>
        </Action>

        <Action
          n="20"
          title="Давж заалдах (шинэ арбитр)"
          hint="7 хоногийн дотор шинэ арбитр нэрлэж давж заалдана. Дараа нь доорх 21-р алхмаар арбитрыг батлана."
          enabled={isParty && active && active.state === 2}
          why="Зөвхөн тал, шийдвэр гарсан байх"
        >
          <div className="row">
            <AddressSelect
              label="Шинэ арбитр"
              value={newArb}
              onChange={setNewArb}
              accounts={accounts}
            />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("appeal", [newArb])}>Давж заалдах</Run>
            </div>
          </div>
        </Action>

        <Action
          n="21"
          title="Шинэ арбитрыг батлах / хүлээн авах / холбох"
          hint="Гүйцэтгэгч батална → шинэ арбитр хүлээн авна → маргаанд холбогдоно → хөлсийг тушаана."
        >
          <div className="row" style={{ gap: 8 }}>
            {isContractor && (
              <Run onClick={() => call("approveArbiter", [])}>
                Батлах (Гүйцэтгэгч)
              </Run>
            )}
            {eq(me.address, snap.pendingArbiter) && (
              <Run onClick={() => call("arbiterAccept", [])}>
                Хүлээн авах (Арбитр)
              </Run>
            )}
            {isArbiter && active && active.arbiter === ZERO && (
              <Run onClick={() => call("bindArbiterToDispute", [])}>
                Маргаанд холбогдох
              </Run>
            )}
            {isParty && active && active.arbiter !== ZERO && active.feeTokenId === 0n && (
              <>
                <Num label="Хөлс (₮)" value={appealFee} onChange={setAppealFee} />
                <div style={{ alignSelf: "flex-end" }}>
                  <Run onClick={() => call("fundAppealArbiter", [BigInt(appealFee)])}>
                    Хөлс тушаах
                  </Run>
                </div>
              </>
            )}
          </div>
        </Action>
      </div>
    </div>
  );
}
