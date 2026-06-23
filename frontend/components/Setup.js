"use client";
import { useState } from "react";
import { Action, Num, Text, AddressSelect, Run } from "./ui";
import { short } from "../lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Setup({ snap, me, accounts, call }) {
  const isClient = eq(me.address, snap.client);
  const isOracle = eq(me.address, snap.oracle);
  const isPendingContractor = eq(me.address, snap.pendingContractor);
  const isContractor = eq(me.address, snap.contractor);
  const isPendingArbiter = eq(me.address, snap.pendingArbiter);
  const fundingDeclared = snap.totalFinancing > 0n;

  const [advance, setAdvance] = useState("0");
  const [amounts, setAmounts] = useState("200, 300");
  const [deadlines, setDeadlines] = useState("604800, 1209600");
  const [contractorAddr, setContractorAddr] = useState("");
  const [arbiterAddr, setArbiterAddr] = useState("");

  const parseList = (s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length)
      .map((x) => BigInt(x));

  return (
    <div className="card">
      <h2>1. Гэрээ үүсгэх ба талуудыг томилох</h2>
      <div className="section-actions">
        <Action
          n="2"
          title="Санхүүжилт ба хугацааг зарлах"
          hint="Урьдчилгаа + шатлал бүрийн санхүүжилт + эцсийн хугацаа (секундээр). Урьдчилгаа + шатлалууд = нийт санхүүжилт."
          enabled={isClient && !fundingDeclared}
          why={!isClient ? "Зөвхөн Захиалагч" : "Аль хэдийн зарлагдсан"}
        >
          <div className="row">
            <Num label="Урьдчилгаа (₮)" value={advance} onChange={setAdvance} />
            <Text
              label="Шатлал бүрийн дүн (таслалаар)"
              value={amounts}
              onChange={setAmounts}
            />
            <Text
              label="Хугацаа сек (таслалаар)"
              value={deadlines}
              onChange={setDeadlines}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <Run
              onClick={() =>
                call("declareFunding", [
                  BigInt(advance || "0"),
                  parseList(amounts),
                  parseList(deadlines),
                ])
              }
            >
              Зарлах
            </Run>
          </div>
        </Action>

        <Action
          n="3"
          title="Гүйцэтгэгчийг урих"
          enabled={isClient}
          why="Зөвхөн Захиалагч"
        >
          <div className="row">
            <AddressSelect
              label="Гүйцэтгэгчийн хаяг"
              value={contractorAddr}
              onChange={setContractorAddr}
              accounts={accounts}
            />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("inviteContractor", [contractorAddr])}>
                Урих
              </Run>
            </div>
          </div>
          {snap.pendingContractor !== ZERO && (
            <div className="sub" style={{ marginTop: 6 }}>
              Уригдсан: <span className="mono">{short(snap.pendingContractor)}</span>{" "}
              {snap.collateralConfirmed ? "· барьцаа баталгаажсан ✓" : "· барьцаа хүлээгдэж буй"}
            </div>
          )}
        </Action>

        <Action
          n="4a"
          title="Банк: барьцаа орж ирснийг баталгаажуулах (Oracle)"
          hint="Гүйцэтгэгч барьцаагаа Escrow данс руу тушаасныг банк баталгаажуулна."
          enabled={isOracle && snap.pendingContractor !== ZERO && !snap.collateralConfirmed}
          why={!isOracle ? "Зөвхөн Банк/Oracle" : "Боломжгүй"}
        >
          <Run onClick={() => call("confirmCollateral", [])}>Барьцаа баталгаажуулах</Run>
        </Action>

        <Action
          n="4b"
          title="Гэрээг шалгаж зөвшөөрөх (Идэвхжүүлэх)"
          hint="Гүйцэтгэгч нөхцлийг хүлээн зөвшөөрөхөд гэрээ ИДЭВХТЭЙ болж токенууд гүйцэтгэгчид үүснэ."
          enabled={isPendingContractor && snap.collateralConfirmed && fundingDeclared}
          why={!isPendingContractor ? "Зөвхөн уригдсан Гүйцэтгэгч" : "Барьцаа/санхүүжилт дутуу"}
        >
          <Run onClick={() => call("acceptContract", [])}>Зөвшөөрч идэвхжүүлэх</Run>
        </Action>

        <Action
          n="5"
          title="Арбитр урих"
          enabled={isClient}
          why="Зөвхөн Захиалагч"
        >
          <div className="row">
            <AddressSelect
              label="Арбитрын хаяг"
              value={arbiterAddr}
              onChange={setArbiterAddr}
              accounts={accounts}
            />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("inviteArbiter", [arbiterAddr])}>Урих</Run>
            </div>
          </div>
          {snap.pendingArbiter !== ZERO && (
            <div className="sub" style={{ marginTop: 6 }}>
              Уригдсан арбитр: <span className="mono">{short(snap.pendingArbiter)}</span>{" "}
              {snap.contractorApprovedArbiter ? "· Гүйцэтгэгч зөвшөөрсөн ✓" : "· Гүйцэтгэгчийн зөвшөөрөл хүлээж буй"}
            </div>
          )}
        </Action>

        <Action
          n="6"
          title="Арбитрыг батлах (Гүйцэтгэгч)"
          enabled={isContractor && snap.pendingArbiter !== ZERO && !snap.contractorApprovedArbiter}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Боломжгүй"}
        >
          <Run onClick={() => call("approveArbiter", [])}>Батлах</Run>
        </Action>

        <Action
          n="7"
          title="Арбитр үүргээ хүлээн авах"
          enabled={isPendingArbiter && snap.contractorApprovedArbiter}
          why={!isPendingArbiter ? "Зөвхөн уригдсан Арбитр" : "Гүйцэтгэгчийн зөвшөөрөл хэрэгтэй"}
        >
          <Run onClick={() => call("arbiterAccept", [])}>Хүлээн авах</Run>
        </Action>
      </div>
    </div>
  );
}
