"use client";
import { useState } from "react";
import { Action, Num, Text, AddressSelect, Run } from "./ui";
import { buildNft } from "../lib/nft";
import { LOAN_STATE, short, tugrug } from "../lib/format";

const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export default function Loans({ snap, me, accounts, call }) {
  const isContractor = eq(me.address, snap.contractor);
  const isClient = eq(me.address, snap.client);

  const [lender, setLender] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [offerCol, setOfferCol] = useState({}); // per loan collateral input
  const [bankIn, setBankIn] = useState({});

  return (
    <div className="card">
      <h2>Токен барьцаалж зээл авах (Функц 8–14)</h2>
      <div className="section-actions">
        <Action
          n="8"
          title="Зээлийн хүсэлт гаргах"
          hint="Тендерийн гэрээний NFT автоматаар хавсаргагдана. Зээл олгогч банк байх албагүй."
          enabled={isContractor && !snap.frozen}
          why={!isContractor ? "Зөвхөн Гүйцэтгэгч" : "Гэрээ царцсан"}
        >
          <div className="row">
            <AddressSelect
              label="Зээл олгогч"
              value={lender}
              onChange={setLender}
              accounts={accounts}
            />
            <Num label="Токен ID" value={tokenId} onChange={setTokenId} />
            <Num label="Барьцаалах хэмжээ" value={amount} onChange={setAmount} />
            <div style={{ alignSelf: "flex-end" }}>
              <Run
                onClick={() =>
                  call("requestLoan", [lender, BigInt(tokenId), BigInt(amount)])
                }
              >
                Хүсэлт илгээх
              </Run>
            </div>
          </div>
        </Action>

        <Action n={null} title="Зээлүүд">
          {snap.loans.length === 0 && <div className="sub">Зээл алга.</div>}
          {snap.loans.map((l) => {
            const isLender = eq(me.address, l.lender);
            return (
              <div
                key={l.id.toString()}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    <b>#{l.id.toString()}</b> · Олгогч {short(l.lender)} · Токен ID{" "}
                    {l.tokenId.toString()} · Хүсэлт {tugrug(l.requestedAmount)}
                    {l.collateralAmount > 0n &&
                      ` · Барьцаа ${tugrug(l.collateralAmount)}`}
                  </span>
                  <span className="badge muted">{LOAN_STATE[l.state]}</span>
                </div>

                <div className="row" style={{ marginTop: 8 }}>
                  {/* 9: lender offers */}
                  {l.state === 1 && isLender && (
                    <>
                      <Num
                        label="Барьцаанд авах хэмжээ (≤ хүсэлт)"
                        value={offerCol[l.id] || ""}
                        onChange={(v) => setOfferCol({ ...offerCol, [l.id]: v })}
                      />
                      <div style={{ alignSelf: "flex-end" }}>
                        <Run
                          onClick={() => {
                            const { uri, hash } = buildNft({
                              title: "Зээлийн нөхцөл",
                              note: "Зээл олгох нөхцөл, гэрээ",
                              loanId: l.id.toString(),
                            });
                            return call("offerLoan", [
                              l.id,
                              uri,
                              hash,
                              BigInt(offerCol[l.id] || "0"),
                            ]);
                          }}
                        >
                          9. Нөхцөл санал болгох
                        </Run>
                      </div>
                    </>
                  )}
                  {/* 10: contractor accepts */}
                  {l.state === 2 && isContractor && (
                    <Run onClick={() => call("acceptLoan", [l.id])}>
                      10. Зээл хүлээн авах
                    </Run>
                  )}
                  {/* 11: client approves transfer */}
                  {l.state === 3 && isClient && (
                    <Run onClick={() => call("approveLoanTransfer", [l.id])}>
                      11. Токен шилжүүлэхийг зөвшөөрөх
                    </Run>
                  )}
                  {/* 12: lender funds */}
                  {l.state === 4 && isLender && (
                    <>
                      <Text
                        label="Олгогчийн банк"
                        value={bankIn[l.id] || ""}
                        onChange={(v) => setBankIn({ ...bankIn, [l.id]: v })}
                      />
                      <div style={{ alignSelf: "flex-end" }}>
                        <Run
                          onClick={() =>
                            call("fundLoan", [l.id, bankIn[l.id] || "BANK"])
                          }
                        >
                          12. Зээл олгох
                        </Run>
                      </div>
                    </>
                  )}
                  {/* 13: contractor repays */}
                  {l.state === 5 && isContractor && (
                    <>
                      <Text
                        label="Эргэн төлөх банк"
                        value={bankIn[l.id] || ""}
                        onChange={(v) => setBankIn({ ...bankIn, [l.id]: v })}
                      />
                      <div style={{ alignSelf: "flex-end" }}>
                        <Run
                          onClick={() =>
                            call("repayLoan", [l.id, bankIn[l.id] || "BANK"])
                          }
                        >
                          13. Зээл эргэн төлсөн
                        </Run>
                      </div>
                    </>
                  )}
                  {/* 14: lender returns collateral */}
                  {l.state === 6 && isLender && (
                    <Run onClick={() => call("returnCollateral", [l.id])}>
                      14. Барьцааг буцаах
                    </Run>
                  )}
                </div>
              </div>
            );
          })}
        </Action>
      </div>
    </div>
  );
}
