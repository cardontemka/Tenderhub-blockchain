"use client";
import { useState } from "react";
import { Action, Text, AddressSelect, Run } from "./ui";
import { short } from "../lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Setup({ snap, me, accounts, call }) {
  const isClient = eq(me.address, snap.client);
  const isPendingContractor = eq(me.address, snap.pendingContractor);
  const isContractor = eq(me.address, snap.contractor);
  const isPendingArbiter = eq(me.address, snap.pendingArbiter);
  const joined = snap.contractor !== ZERO;
  const fundingDeclared = snap.totalFinancing > 0n;
  const active = snap.status >= 2;

  const [advance, setAdvance] = useState("0");
  const [amounts, setAmounts] = useState("20000, 30000");
  const [days, setDays] = useState("10, 20");
  const [warranty, setWarranty] = useState("30");
  const [contractorAddr, setContractorAddr] = useState("");
  const [arbiterAddr, setArbiterAddr] = useState("");
  const requiredCollateral = snap.totalFinancing / 100n; // 1%

  const parse = (s) =>
    s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => BigInt(x));

  return (
    <div className="card">
      <h2>1. Гэрээ ба талуудыг томилох</h2>
      <div className="section-actions">
        <Action
          n="3"
          title="Гүйцэтгэгчийг урих"
          enabled={isClient && !active}
          why={!isClient ? "Зөвхөн Захиалагч" : "Гэрээ идэвхжсэн"}
        >
          <div className="row">
            <AddressSelect label="Гүйцэтгэгчийн хаяг" value={contractorAddr} onChange={setContractorAddr} accounts={accounts}
              exclude={[snap.client, snap.arbiter, snap.oracle, snap.pendingArbiter]} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("inviteContractor", [contractorAddr])}>Урих</Run>
            </div>
          </div>
          {snap.pendingContractor !== ZERO && (
            <div className="sub" style={{ marginTop: 6 }}>
              Уригдсан: <span className="mono">{short(snap.pendingContractor)}</span> {joined ? "· орсон ✓" : "· хариу хүлээж буй"}
            </div>
          )}
        </Action>

        <Action
          n="4a"
          title="Гэрээнд орох (зөвшөөрөх)"
          hint="Гүйцэтгэгч уригдсаны дараа зүгээр л зөвшөөрч гэрээний нэг хэсэг болно."
          enabled={isPendingContractor && !joined}
          why={!isPendingContractor ? "Зөвхөн уригдсан Гүйцэтгэгч" : "Аль хэдийн орсон"}
        >
          <Run onClick={() => call("joinContract", [])}>Гэрээнд орох</Run>
        </Action>

        <Action
          n="2"
          title="Санхүүжилт ба хугацааг зарлах"
          hint="Урьдчилгаа (заавал биш, зөвхөн энд тавьж болно, дараа өөрчлөгдөхгүй) + шатлал бүрийн санхүүжилт + эцсийн хугацаа (ХОНОГоор, 0 байж болохгүй). Урьдчилгаа + Шатлалууд = Нийт санхүүжилт. Токен Гүйцэтгэгч дээр үүснэ."
          enabled={isClient && joined && !fundingDeclared}
          why={!isClient ? "Зөвхөн Захиалагч" : !joined ? "Эхлээд гүйцэтгэгч орох ёстой" : "Зарлагдсан"}
        >
          <div className="row">
            <Text label="Урьдчилгаа (₮)" value={advance} onChange={setAdvance} />
            <Text label="Шатлал бүрийн дүн (₮, таслалаар)" value={amounts} onChange={setAmounts} />
            <Text label="Хугацаа (хоног, таслалаар)" value={days} onChange={setDays} />
            <Text label="Баталгаат хугацаа (хоног)" value={warranty} onChange={setWarranty} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("declareFunding", [BigInt(advance || "0"), parse(amounts), parse(days), BigInt(warranty || "0")])}>Зарлах</Run>
            </div>
          </div>
        </Action>

        <Action
          n="4b"
          title="Барьцаа тушааж гэрээг идэвхжүүлэх"
          hint="Барьцаа нь нийт санхүүжилтийн 1%-тай тэнцэнэ. Гүйцэтгэгчийн банкны данснаас хасагдаж Escrow данс руу орно (данс хүрэлцэхгүй бол боломжгүй). АРБИТР заавал томилогдсон байх ёстой. Тэнцэх барьцааны токен үүсэж Escrow доод нөөц болж, гэрээ ИДЭВХТЭЙ болж хугацаа эхэлнэ."
          enabled={isContractor && joined && fundingDeclared && snap.arbiter !== ZERO && snap.status === 1}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : snap.arbiter === ZERO ? "Эхлээд арбитр томилогдсон байх ёстой" : "Санхүүжилт зарлагдаагүй эсвэл аль хэдийн идэвхтэй"}
        >
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Шаардагдах барьцаа (нийт санхүүжилтийн 1%)</label>
              <div style={{ padding: "8px 0", fontWeight: 600 }}>
                {requiredCollateral.toLocaleString("mn-MN")} ₮
              </div>
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("activateContract", [], requiredCollateral)}>Барьцаа тушааж идэвхжүүлэх</Run>
            </div>
          </div>
        </Action>

        <Action
          n="5"
          title="Арбитр урих"
          hint="Анхны томилгоо. Арбитр гэрээний нэг хэсэг болсны дараа энд солих боломжгүй — зөвхөн давж заалдах үед (4-р таб) шинэ арбитр томилогдоно."
          enabled={isClient && snap.arbiter === ZERO}
          why={!isClient ? "Зөвхөн Захиалагч" : "Арбитр аль хэдийн томилогдсон (давж заалдаж сольно)"}
        >
          <div className="row">
            <AddressSelect label="Арбитрын хаяг" value={arbiterAddr} onChange={setArbiterAddr} accounts={accounts}
              exclude={[snap.client, snap.contractor, snap.oracle, snap.pendingContractor]} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("inviteArbiter", [arbiterAddr])}>Урих</Run>
            </div>
          </div>
          {snap.pendingArbiter !== ZERO && (
            <div className="sub" style={{ marginTop: 6 }}>
              Уригдсан арбитр: <span className="mono">{short(snap.pendingArbiter)}</span> {snap.contractorApprovedArbiter ? "· батлагдсан ✓" : "· батлахыг хүлээж буй"}
            </div>
          )}
        </Action>

        <Action
          n="6"
          title="Арбитрыг батлах (Гүйцэтгэгч)"
          enabled={isContractor && snap.arbiter === ZERO && snap.pendingArbiter !== ZERO && !snap.contractorApprovedArbiter}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Боломжгүй (давж заалдах бол 4-р таб)"}
        >
          <Run onClick={() => call("approveArbiter", [])}>Батлах</Run>
        </Action>

        <Action
          n="7"
          title="Арбитр үүргээ хүлээн авах"
          enabled={isPendingArbiter && snap.arbiter === ZERO && snap.contractorApprovedArbiter}
          why={!isPendingArbiter ? "Зөвхөн уригдсан Арбитр" : "Гүйцэтгэгчийн зөвшөөрөл хэрэгтэй (давж заалдах бол 4-р таб)"}
        >
          <Run onClick={() => call("arbiterAccept", [])}>Хүлээн авах</Run>
        </Action>
      </div>
    </div>
  );
}
