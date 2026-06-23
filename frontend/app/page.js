"use client";
import { useEffect, useState, useCallback } from "react";
import {
  getProvider,
  getAccounts,
  getContractRead,
  getContractWrite,
  deployTender,
  RPC_URL,
} from "../lib/chain";
import { loadSnapshot } from "../lib/snapshot";
import { buildNft } from "../lib/nft";
import { short } from "../lib/format";
import Overview from "../components/Overview";
import Setup from "../components/Setup";
import Work from "../components/Work";
import Loans from "../components/Loans";
import Disputes from "../components/Disputes";
import Amendments from "../components/Amendments";

const TABS = [
  ["setup", "1. Гэрээ ба талууд"],
  ["work", "2. Ажил ба санхүүжилт"],
  ["loans", "3. Зээл"],
  ["disputes", "4. Маргаан"],
  ["amend", "5. Өөрчлөлт"],
];

export default function Page() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(0);
  const [provider, setProvider] = useState(null);
  const [chainOk, setChainOk] = useState(null);

  const [address, setAddress] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [snap, setSnap] = useState(null);
  const [tab, setTab] = useState("setup");
  const [toast, setToast] = useState(null);

  // deploy form
  const [escrow, setEscrow] = useState("ESCROW-001");
  const [oracleIdx, setOracleIdx] = useState(3);
  const [contractNote, setContractNote] = useState("Тендерийн гэрээ #1");

  // init provider + accounts
  useEffect(() => {
    const p = getProvider();
    setProvider(p);
    try {
      setAccounts(getAccounts(p));
    } catch (e) {
      console.error(e);
    }
    p.getBlockNumber()
      .then(() => setChainOk(true))
      .catch(() => setChainOk(false));

    const saved = typeof window !== "undefined" && localStorage.getItem("th_address");
    if (saved) {
      setAddress(saved);
      setAddressInput(saved);
    }
  }, []);

  const me = accounts[selected];

  const refresh = useCallback(async () => {
    if (!address || !provider || accounts.length === 0) return;
    try {
      const c = getContractRead(address, provider);
      const s = await loadSnapshot(c, accounts);
      setSnap(s);
    } catch (e) {
      console.error(e);
      setToast({ type: "err", msg: "Уншихад алдаа: " + (e.shortMessage || e.message) });
    }
  }, [address, provider, accounts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // poll for changes so multi-role actions reflect quickly
  useEffect(() => {
    if (!address) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [address, refresh]);

  const call = useCallback(
    async (method, args = []) => {
      if (!address || !me) return;
      const w = getContractWrite(address, me.wallet);
      try {
        setToast({ type: "pending", msg: `⏳ ${method} …` });
        const tx = await w[method](...args);
        await tx.wait();
        setToast({ type: "ok", msg: `✓ ${method}` });
        await refresh();
      } catch (e) {
        // A reverted/failed tx can leave the NonceManager's local counter ahead;
        // reset it so the next action re-reads the real nonce from the node.
        try {
          me.wallet.reset?.();
        } catch {}
        const reason =
          e.reason ||
          e.shortMessage ||
          e.info?.error?.message ||
          e.message ||
          "алдаа";
        setToast({ type: "err", msg: `✗ ${method}: ${reason}` });
      }
    },
    [address, me, refresh]
  );

  async function handleDeploy() {
    if (!me) return;
    try {
      setToast({ type: "pending", msg: "⏳ Гэрээ deploy хийж байна…" });
      const { uri, hash } = buildNft({ title: "Тендерийн гэрээ", note: contractNote });
      const addr = await deployTender(me.wallet, {
        uri,
        hash,
        escrow,
        oracle: accounts[oracleIdx].address,
      });
      localStorage.setItem("th_address", addr);
      setAddress(addr);
      setAddressInput(addr);
      setToast({ type: "ok", msg: "✓ Deploy: " + short(addr) });
    } catch (e) {
      try {
        me.wallet.reset?.();
      } catch {}
      setToast({ type: "err", msg: "✗ Deploy: " + (e.shortMessage || e.message) });
    }
  }

  function loadAddress() {
    setAddress(addressInput.trim());
    localStorage.setItem("th_address", addressInput.trim());
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>TenderHub</h1>
        <div className="sub" style={{ marginBottom: 14 }}>
          Тендерийн блокчейн туршилтын орчин
        </div>

        <div style={{ marginBottom: 12 }}>
          {chainOk === true && <span className="badge ok">Hardhat node холбогдсон</span>}
          {chainOk === false && <span className="badge danger">Node олдсонгүй</span>}
          {chainOk === null && <span className="badge muted">Шалгаж байна…</span>}
          <div className="sub mono" style={{ marginTop: 4 }}>
            {RPC_URL}
          </div>
          {chainOk === false && (
            <div className="disabled-note">
              Эхлээд: <span className="mono">npx hardhat node</span>
            </div>
          )}
        </div>

        <h3>Хэн болж нэвтрэх вэ</h3>
        <div>
          {accounts.map((a) => (
            <div
              key={a.address}
              className={"acct" + (selected === a.index ? " active" : "")}
              onClick={() => setSelected(a.index)}
            >
              <div className="nm">
                #{a.index} · {a.role}
              </div>
              <div className="ad mono">{a.address}</div>
            </div>
          ))}
        </div>

        <h3>Гэрээ</h3>
        <div className="col">
          <input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="0x… гэрээний хаяг"
          />
          <div className="row">
            <button className="secondary" onClick={loadAddress}>
              Ачаалах
            </button>
            {address && (
              <span className="sub mono" style={{ alignSelf: "center" }}>
                {short(address)}
              </span>
            )}
          </div>
        </div>

        <h3>Шинэ тендер deploy хийх (Функц 1)</h3>
        <div className="col">
          <div>
            <label>Гэрээний тайлбар (NFT)</label>
            <input value={contractNote} onChange={(e) => setContractNote(e.target.value)} />
          </div>
          <div>
            <label>Escrow дансны дугаар</label>
            <input value={escrow} onChange={(e) => setEscrow(e.target.value)} />
          </div>
          <div>
            <label>Банк / Oracle хаяг</label>
            <select value={oracleIdx} onChange={(e) => setOracleIdx(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.address} value={a.index}>
                  #{a.index} · {a.role}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleDeploy} disabled={!me}>
            Deploy (Захиалагчаар)
          </button>
          <div className="sub">
            Deploy хийсэн хаяг автоматаар Захиалагч болно. Тиймээс #0-р deploy хий.
          </div>
        </div>
      </aside>

      <main className="main">
        {!address && (
          <div className="card">
            <h2>Эхлэхийн тулд</h2>
            <ol className="sub" style={{ lineHeight: 1.8 }}>
              <li>
                Терминал дээр <span className="mono">npx hardhat node</span> ажиллуул.
              </li>
              <li>Зүүн талаас <b>#0 (Захиалагч)</b>-г сонго.</li>
              <li>
                "Шинэ тендер deploy хийх"-ээр гэрээ үүсгэ. Дараа нь талуудаар нэвтэрч
                workflow-г туршина.
              </li>
            </ol>
          </div>
        )}

        {address && !snap && (
          <div className="card">
            <div className="sub">Гэрээний мэдээллийг уншиж байна…</div>
          </div>
        )}

        {address && snap && me && (
          <>
            <div className="card" style={{ padding: "12px 18px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  Идэвхтэй хэрэглэгч: <b>{me.role}</b>{" "}
                  <span className="mono sub">{short(me.address)}</span>
                </div>
                <button className="ghost" onClick={refresh}>
                  ⟳ Шинэчлэх
                </button>
              </div>
            </div>

            <Overview snap={snap} accounts={accounts} address={me.address} />

            <div className="pill-row">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  className={tab === k ? "" : "secondary"}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "setup" && (
              <Setup snap={snap} me={me} accounts={accounts} call={call} />
            )}
            {tab === "work" && <Work snap={snap} me={me} call={call} />}
            {tab === "loans" && (
              <Loans snap={snap} me={me} accounts={accounts} call={call} />
            )}
            {tab === "disputes" && (
              <Disputes snap={snap} me={me} accounts={accounts} call={call} />
            )}
            {tab === "amend" && <Amendments snap={snap} me={me} call={call} />}
          </>
        )}
      </main>

      {toast && (
        <div className={"toast " + (toast.type === "err" ? "err" : toast.type === "ok" ? "ok" : "")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{toast.msg}</span>
            <span style={{ cursor: "pointer" }} onClick={() => setToast(null)}>
              ✕
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
