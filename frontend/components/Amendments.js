"use client";
import { useState } from "react";
import { Action, Num, Text, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { short } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Amendments({ snap, me, call }) {
  const isClient = eq(me.address, snap.client);
  const isContractor = eq(me.address, snap.contractor);
  const isParty = isClient || isContractor;
  const isProposer = eq(me.address, snap.amendmentProposer);

  const [reason, setReason] = useState("Гэрээнд өөрчлөлт оруулах шалтгаан…");
  const [extraAdvance, setExtraAdvance] = useState("0");
  const [amounts, setAmounts] = useState("");
  const [deadlines, setDeadlines] = useState("");

  const parseList = (s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length)
      .map((x) => BigInt(x));

  return (
    <div className="card">
      <h2>Гэрээнд өөрчлөлт оруулах (Функц 22–23)</h2>
      <div className="section-actions">
        <Action
          n="22"
          title="Өөрчлөлт санал болгох"
          hint="Шалтгааны тайланг NFT хэлбэрээр илгээнэ."
          enabled={isParty && !snap.amendmentPending && !snap.frozen}
          why={!isParty ? "Зөвхөн тал" : "Хүлээгдэж буй өөрчлөлт бий"}
        >
          <Text label="Шалтгаан" value={reason} onChange={setReason} />
          <div style={{ marginTop: 10 }}>
            <Run
              onClick={() => {
                const { uri, hash } = buildNft({
                  title: "Гэрээний өөрчлөлтийн санал",
                  note: reason,
                });
                return call("proposeAmendment", [uri, hash]);
              }}
            >
              Санал илгээх
            </Run>
          </div>
        </Action>

        <Action
          n="23"
          title="Өөрчлөлтийг зөвшөөрөх / татгалзах"
          hint={
            snap.amendmentPending
              ? `Саналыг гаргасан: ${short(snap.amendmentProposer)}`
              : "Хүлээгдэж буй санал алга."
          }
          enabled={isParty && snap.amendmentPending && !isProposer}
          why={isProposer ? "Саналыг гаргагч өөрөө батлах боломжгүй" : "Зөвхөн нөгөө тал"}
        >
          <div className="row">
            <Run onClick={() => call("respondToAmendment", [true])}>Зөвшөөрөх</Run>
            <Run kind="danger" onClick={() => call("respondToAmendment", [false])}>
              Татгалзах
            </Run>
          </div>
        </Action>

        <Action
          n="2*"
          title="Өөрчлөлтийг хэрэгжүүлэх (зөвхөн нэмэгдүүлэх)"
          hint="Зөвшөөрөгдсөн өөрчлөлтийн дагуу урьдчилгаа нэмэх ба/эсвэл шинэ шатлал нэмнэ. Зөрүү гүйцэтгэгчид токеноор үүснэ."
          enabled={isClient && snap.amendmentApproved && !snap.frozen}
          why={!isClient ? "Зөвхөн Захиалагч" : "Өөрчлөлт батлагдаагүй"}
        >
          <div className="row">
            <Num label="Нэмэлт урьдчилгаа" value={extraAdvance} onChange={setExtraAdvance} />
            <Text label="Шинэ шатлалууд (таслалаар)" value={amounts} onChange={setAmounts} />
            <Text label="Хугацаа сек (таслалаар)" value={deadlines} onChange={setDeadlines} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() =>
                  call("amendFunding", [
                    BigInt(extraAdvance || "0"),
                    parseList(amounts),
                    parseList(deadlines),
                  ])
                }
              >
                Хэрэгжүүлэх
              </Run>
            </div>
          </div>
        </Action>
      </div>
    </div>
  );
}
