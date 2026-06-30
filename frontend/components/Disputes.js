"use client";
import { useState } from "react";
import { Action, Num, Text, AddressSelect, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { DISPUTE_STATE, SUBJECT, short, tugrug, ts } from "../lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Disputes({ snap, me, accounts, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);
  const isParty = isClient || isContractor;
  const isCancelRequester = eq(me.address, snap.cancelRequester);

  const active = snap.disputeActive ? snap.disputes[Number(snap.activeDisputeId) - 1] : null;
  const isActiveArbiter = active && eq(me.address, active.arbiter);
  const isWinner = active && eq(me.address, active.winner);
  const winnerName = (addr) =>
    eq(addr, snap.client) ? "Захиалагч" : eq(addr, snap.contractor) ? "Гүйцэтгэгч" : short(addr);

  const [ruling, setRuling] = useState("Шийдвэр: ...");
  const [winner, setWinner] = useState("");
  const [newArb, setNewArb] = useState("");
  const [appealFee, setAppealFee] = useState("2000");
  const [cancelFee, setCancelFee] = useState("2000");
  const [cancelComplaint, setCancelComplaint] = useState("Цуцлахаас үндэслэлгүй татгалзав.");

  const cancellable = snap.status === 2 || snap.status === 3;

  return (
    <div className="card">
      <h2>4. Арбитр, маргаан, цуцлах (Функц 17–24)</h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        Арбитрыг "Ажил" эсвэл "Өөрчлөлт" таб дахь татгалзлын хажуугаас дуудна. Энд тогтоол,
        давж заалдах, гэрээг цуцлах зэрэг явагдана.
      </div>

      {active && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 14, background: "var(--panel-2)" }}>
          <b>Идэвхтэй маргаан #{active.id.toString()}</b>{" "}
          <span className="badge warn">{DISPUTE_STATE[active.state]}</span>{" "}
          <span className="badge muted">{SUBJECT[active.subject]}</span>
          <div className="sub" style={{ marginTop: 6 }}>
            Дуудсан: {short(active.initiator)} · Арбитр: {short(active.arbiter)} · Хөлс: {tugrug(active.feeAmount)}
          </div>
          {active.state >= 2 && (
            <div style={{ marginTop: 8 }}>
              <span className="badge ok">
                ✓ Арбитрын шийдвэр: {winnerName(active.winner)} зөв
              </span>
              <div className="sub" style={{ marginTop: 6 }}>
                Шийдвэрийн огноо: {ts(active.rulingTime)} · Зөвшөөрөл — Захиалагч{" "}
                {active.clientAccepted ? "✓" : "—"} / Гүйцэтгэгч {active.contractorAccepted ? "✓" : "—"}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="section-actions">
        <Action
          n="18"
          title="Арбитрын шийдвэр гаргах"
          hint="Шийдвэрийг NFT болгож, зөв гэж үзсэн талыг сонгоно. Шийдвэр зөвхөн тухайн асуудлыг л шийднэ."
          enabled={isActiveArbiter && active && active.state === 1}
          why="Зөвхөн тухайн маргааны арбитр"
        >
          <div className="row">
            <Text label="Шийдвэр" value={ruling} onChange={setRuling} />
            <AddressSelect label="Зөв тал" value={winner} onChange={setWinner}
              accounts={accounts.filter((a) => eq(a.address, snap.client) || eq(a.address, snap.contractor))} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => {
                const { uri, hash } = buildNft({ title: "Арбитрын тогтоол", note: ruling, winner });
                return call("issueRuling", [uri, hash, winner]);
              }}>Шийдвэр гаргах</Run>
            </div>
          </div>
        </Action>

        <Action
          n="19"
          title="Тогтоолыг хүлээн зөвшөөрөх"
          hint="Хоёр тал зөвшөөрвөл шийдвэр шууд хэрэгжинэ. 7 хоног дотор давж заалдахгүй бол банк автоматаар эцэслэнэ."
          enabled={isParty && active && active.state === 2}
          why="Зөвхөн тал, шийдвэр гарсан байх"
        >
          <Run onClick={() => call("respondToRuling", [true])}>Зөвшөөрөх</Run>
        </Action>

        <Action
          n="20"
          title="Давж заалдах (шинэ арбитр)"
          hint="7 хоногийн дотор. Зөвхөн ялагдсан тал давж заалдана (зөв гэж үзсэн тал биш). Цуцлалтын шийдвэр эцсийн. Давж заалдсан хүн шинэ арбитрын хөлсийг төлнө."
          enabled={isParty && active && active.state === 2 && active.subject !== 3 && !isWinner}
          why={isWinner ? "Зөв гэж үзсэн тал давж заалдах боломжгүй" : "Зөвхөн тал; цуцлалт бол эцсийн"}
        >
          <div className="row">
            <AddressSelect label="Шинэ арбитр" value={newArb} onChange={setNewArb} accounts={accounts}
              exclude={[snap.client, snap.contractor, snap.arbiter, snap.oracle]} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("appeal", [newArb])}>Давж заалдах</Run>
            </div>
          </div>
        </Action>

        <Action n="21" title="Шинэ арбитрыг батлах / хүлээн авах / хөлс тушаах" hint="Давж заалдсаны дараа: давж заалдсан талын ЭСРЭГ тал батлах → шинэ арбитр хүлээн авах → давж заалдсан тал хөлсийг тушаах.">
          <div className="row" style={{ gap: 8 }}>
            {/* the counter-party of the appellant approves the new arbiter */}
            {isParty && active && active.arbiter === ZERO && snap.pendingArbiter !== ZERO &&
              !snap.contractorApprovedArbiter && !eq(me.address, active.initiator) && (
                <Run onClick={() => call("approveArbiter", [])}>Батлах (эсрэг тал)</Run>
              )}
            {eq(me.address, snap.pendingArbiter) && <Run onClick={() => call("arbiterAccept", [])}>Хүлээн авах (Арбитр)</Run>}
            {active && active.arbiter !== ZERO && active.feeTokenId === 0n && eq(me.address, active.initiator) && (
              <>
                <Num label="Хөлс (₮) — давж заалдсан тал төлнө" value={appealFee} onChange={setAppealFee} />
                <div style={{ alignSelf: "flex-end" }}><Run onClick={() => call("fundAppealArbiter", [BigInt(appealFee)], BigInt(appealFee || "0"))}>Хөлс тушаах</Run></div>
              </>
            )}
          </div>
        </Action>

        {/* Cancellation — placed last; shows disabled when not callable */}
        <Action
          n="Цуцлах"
          title="Гэрээг цуцлах"
          hint="Аль ч тал одоогийн шатны эцсийн хугацаанаас хойш 7 хоногийн дотор цуцлахыг хүсч болно. Нөгөө тал татгалзвал хүсэгч Арбитр дуудаж эцэслүүлнэ (давж заалдахгүй)."
          enabled={isParty && cancellable}
          why={!isParty ? "Зөвхөн тал" : "Гэрээ идэвхтэй/түр зогссон үед л"}
        >
          {!snap.cancelRequested && (
            <Run kind="danger" onClick={() => call("requestCancellation", [])}>Цуцлах хүсэлт гаргах</Run>
          )}
          {snap.cancelRequested && !snap.cancelRefused && !isCancelRequester && (
            <div className="row">
              <Run onClick={() => call("respondCancellation", [true])}>Зөвшөөрч цуцлах</Run>
              <Run kind="danger" onClick={() => call("respondCancellation", [false])}>Татгалзах</Run>
            </div>
          )}
          {snap.cancelRequested && snap.cancelRefused && isCancelRequester && (
            <div className="row">
              <Num label="Арбитрын хөлс (₮)" value={cancelFee} onChange={setCancelFee} />
              <Text label="Гомдол" value={cancelComplaint} onChange={setCancelComplaint} />
              <div style={{ alignSelf: "flex-end" }}>
                <Run onClick={() => {
                  const { uri, hash } = buildNft({ title: "Цуцлах гомдол", note: cancelComplaint });
                  return call("callArbiter", [BigInt(cancelFee), uri, hash], BigInt(cancelFee || "0"));
                }}>Арбитр дуудах</Run>
              </div>
            </div>
          )}
          {snap.cancelRequested && (
            <div className="sub" style={{ marginTop: 6 }}>
              Хүсэлт гаргасан: {short(snap.cancelRequester)} {snap.cancelRefused ? "· татгалзсан (Арбитр шийднэ)" : "· хариу хүлээж буй"}
            </div>
          )}
        </Action>
      </div>
    </div>
  );
}
