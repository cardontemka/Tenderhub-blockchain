"use client";
import { useState } from "react";
import { Action, Num, AddressSelect, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { LOAN_STATE, short, tugrug } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Loans({ snap, me, accounts, call }) {
  const isContractor = eq(me.address, snap.contractor);
  const isClient = eq(me.address, snap.client);

  const [lender, setLender] = useState("");
  const [amount, setAmount] = useState("");
  const [offerCol, setOfferCol] = useState({});

  return (
    <div className="card">
      <h2>3. Токен барьцаалж зээл авах (Функц 8–11)</h2>
      <div className="section-actions">
        <Action
          n="8"
          title="Зээлийн хүсэлт гаргах"
          hint="Барьцаалах токены ХЭМЖЭЭГ л бичнэ (ID хэрэггүй). Шилжих үед токенуудыг ID-ийн дарааллаар (багаас их рүү) нэгтгэж авна. Нэг хаяг руу нэг л нээлттэй хүсэлт. Тендерийн гэрээний NFT автоматаар хавсаргагдана."
          enabled={isContractor && !snap.frozen}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Гэрээ царцсан"}
        >
          <div className="row">
            <AddressSelect label="Зээл олгогч" value={lender} onChange={setLender} accounts={accounts}
              exclude={[snap.client, snap.contractor]} />
            <Num label="Барьцаалах токений хэмжээ" value={amount} onChange={setAmount} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run onClick={() => call("requestLoan", [lender, BigInt(amount || "0")])}>Хүсэлт илгээх</Run>
            </div>
          </div>
        </Action>

        <Action n={null} title="Зээлүүд">
          {snap.loans.length === 0 && <div className="sub">Зээл алга.</div>}
          {snap.loans.map((l) => {
            const isLender = eq(me.address, l.lender);
            return (
              <div key={l.id.toString()} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    <b>#{l.id.toString()}</b> · Олгогч {short(l.lender)} · Хүсэлт {tugrug(l.requestedAmount)}
                    {l.collateralAmount > 0n && ` · Барьцаа ${tugrug(l.collateralAmount)}`}
                  </span>
                  <span className="badge muted">{LOAN_STATE[l.state]}</span>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {l.state === 1 && isLender && (
                    <>
                      <Num label="Барьцаанд авах хэмжээ (≤ хүсэлт)" value={offerCol[l.id] || ""} onChange={(v) => setOfferCol({ ...offerCol, [l.id]: v })} />
                      <div style={{ alignSelf: "flex-end" }}>
                        <Run onClick={() => {
                          const { uri, hash } = buildNft({ title: "Зээлийн нөхцөл", loanId: l.id.toString() });
                          return call("offerLoan", [l.id, uri, hash, BigInt(offerCol[l.id] || "0")]);
                        }}>9. Нөхцөл санал болгох</Run>
                      </div>
                    </>
                  )}
                  {l.state === 2 && isContractor && (
                    <>
                      <Run onClick={() => call("acceptLoan", [l.id])}>10. Зээл хүлээн авах</Run>
                      <Run kind="danger" onClick={() => call("rejectLoan", [l.id])}>Татгалзах</Run>
                    </>
                  )}
                  {l.state === 3 && isClient && <Run onClick={() => call("approveLoanTransfer", [l.id])}>11. Токен шилжүүлэхийг зөвшөөрөх</Run>}
                  {l.state === 4 && <span className="sub">Барьцаа шилжсэн. Зээл/эргэн төлөлт нь талуудын хооронд off-chain.</span>}
                </div>
              </div>
            );
          })}
        </Action>
      </div>
    </div>
  );
}
