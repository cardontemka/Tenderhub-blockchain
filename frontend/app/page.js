"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  getProvider,
  getAccounts,
  getContractRead,
  getContractWrite,
  deployTender,
  RPC_URL,
} from "../lib/chain";
import { loadSnapshot } from "../lib/snapshot";
import { computeBankBalances, bankAutomation } from "../lib/bank";
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
  ["disputes", "4. Маргаан ба цуцлах"],
  ["amend", "5. Өөрчлөлт"],
];
const ORACLE_IDX = 3;

export default function Page() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(0);
  const [provider, setProvider] = useState(null);
  const [chainOk, setChainOk] = useState(null);

  const [address, setAddress] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [snap, setSnap] = useState(null);
  const [bankBalances, setBankBalances] = useState(null);
  const [tab, setTab] = useState("setup");
  const [toast, setToast] = useState(null);
  const busyRef = useRef(false);

  const [escrow, setEscrow] = useState("ESCROW-001");
  const [contractNote, setContractNote] = useState("Тендерийн гэрээ #1");

  useEffect(() => {
    const p = getProvider();
    setProvider(p);
    try {
      setAccounts(getAccounts(p));
    } catch (e) {
      console.error(e);
    }
    p.getBlockNumber().then(() => setChainOk(true)).catch(() => setChainOk(false));
    const saved = typeof window !== "undefined" && localStorage.getItem("th_address");
    if (saved) {
      setAddress(saved);
      setAddressInput(saved);
    }
  }, []);

  const me = accounts[selected];

  const loadSnap = useCallback(async () => {
    if (!address || !provider || accounts.length === 0) return null;
    const c = getContractRead(address, provider);
    const s = await loadSnapshot(c, accounts);
    setSnap(s);
    const bal = await computeBankBalances(c, accounts);
    setBankBalances(bal);
    return s;
  }, [address, provider, accounts]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const s = await loadSnap();
      // run the simulated bank (oracle automation) once per refresh
      if (s && accounts[ORACLE_IDX]) {
        const actions = await bankAutomation(address, accounts[ORACLE_IDX].wallet, s);
        if (actions.length > 0) {
          setToast({ type: "ok", msg: "🏦 Банк: " + actions.join(", ") });
          await loadSnap();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      busyRef.current = false;
    }
  }, [loadSnap, address, accounts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!address) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [address, refresh]);

  const call = useCallback(
    async (method, args = [], cost = 0n) => {
      if (!address || !me) return;
      // Real-bank rule: a party can only spend money it actually holds. (The only
      // "loan" is the Escrow shortfall during redemption, handled by the bank for
      // the Client — never a party's personal balance.)
      if (cost && cost > 0n) {
        const myBal = (bankBalances && bankBalances[me.address]) ?? 0n;
        if (myBal < cost) {
          setToast({
            type: "err",
            msg: `✗ ${method}: Дансны үлдэгдэл хүрэлцэхгүй (хэрэгтэй ${cost.toLocaleString(
              "mn-MN"
            )} ₮, байгаа ${myBal.toLocaleString("mn-MN")} ₮)`,
          });
          return;
        }
      }
      const w = getContractWrite(address, me.wallet);
      try {
        setToast({ type: "pending", msg: `⏳ ${method} …` });
        const tx = await w[method](...args);
        await tx.wait();
        setToast({ type: "ok", msg: `✓ ${method}` });
        await refresh();
      } catch (e) {
        try { me.wallet.reset?.(); } catch {}
        const reason = e.reason || e.shortMessage || e.info?.error?.message || e.message || "алдаа";
        setToast({ type: "err", msg: `✗ ${method}: ${reason}` });
      }
    },
    [address, me, refresh, bankBalances]
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
        oracle: accounts[ORACLE_IDX].address,
      });
      localStorage.setItem("th_address", addr);
      setAddress(addr);
      setAddressInput(addr);
      setToast({ type: "ok", msg: "✓ Deploy: " + short(addr) });
    } catch (e) {
      try { me.wallet.reset?.(); } catch {}
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
        <div className="sub" style={{ marginBottom: 14 }}>Тендерийн блокчейн туршилтын орчин (v2)</div>

        <div style={{ marginBottom: 12 }}>
          {chainOk === true && <span className="badge ok">Hardhat node холбогдсон</span>}
          {chainOk === false && <span className="badge danger">Node олдсонгүй</span>}
          {chainOk === null && <span className="badge muted">Шалгаж байна…</span>}
          <div className="sub mono" style={{ marginTop: 4 }}>{RPC_URL}</div>
          {chainOk === false && (
            <div className="disabled-note">Эхлээд: <span className="mono">npx hardhat node</span></div>
          )}
        </div>

        <h3>Хэн болж нэвтрэх вэ</h3>
        <div>
          {accounts.map((a) => (
            <div key={a.address} className={"acct" + (selected === a.index ? " active" : "")} onClick={() => setSelected(a.index)}>
              <div className="nm">#{a.index} · {a.role}{a.index === ORACLE_IDX ? " 🏦" : ""}</div>
              <div className="ad mono">{a.address}</div>
            </div>
          ))}
        </div>

        <h3>Гэрээ</h3>
        <div className="col">
          <input value={addressInput} onChange={(e) => setAddressInput(e.target.value)} placeholder="0x… гэрээний хаяг" />
          <div className="row">
            <button className="secondary" onClick={loadAddress}>Ачаалах</button>
            {address && <span className="sub mono" style={{ alignSelf: "center" }}>{short(address)}</span>}
          </div>
        </div>

        <h3>Шинэ тендер deploy хийх (Функц 1)</h3>
        <div className="col">
          <div><label>Гэрээний тайлбар (NFT)</label><input value={contractNote} onChange={(e) => setContractNote(e.target.value)} /></div>
          <div><label>Escrow дансны дугаар</label><input value={escrow} onChange={(e) => setEscrow(e.target.value)} /></div>
          <button onClick={handleDeploy} disabled={!me}>Deploy (#{selected}-р хаягаар)</button>
          <div className="sub">Deploy хийсэн хаяг Захиалагч болно (#0 сонгож хий). Банк/Oracle = #{ORACLE_IDX} автоматаар.</div>
        </div>
      </aside>

      <main className="main">
        {!address && (
          <div className="card">
            <h2>Эхлэхийн тулд</h2>
            <ol className="sub" style={{ lineHeight: 1.8 }}>
              <li>Терминал дээр <span className="mono">npx hardhat node</span> ажиллуул.</li>
              <li>Зүүн талаас <b>#0 (Захиалагч)</b>-г сонго.</li>
              <li>"Шинэ тендер deploy хийх"-ээр гэрээ үүсгэ. Дараа нь талуудаар нэвтэрч workflow-г туршина. Банк (#{ORACLE_IDX}) автоматаар ажиллана.</li>
            </ol>
          </div>
        )}

        {address && !snap && <div className="card"><div className="sub">Гэрээний мэдээллийг уншиж байна…</div></div>}

        {address && snap && me && (
          <>
            <div className="card" style={{ padding: "12px 18px" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Идэвхтэй хэрэглэгч: <b>{me.role}</b> <span className="mono sub">{short(me.address)}</span></div>
                <button className="ghost" onClick={refresh}>⟳ Шинэчлэх / Банк ажиллуулах</button>
              </div>
            </div>

            <Overview snap={snap} accounts={accounts} bankBalances={bankBalances} />

            <div className="pill-row">
              {TABS.map(([k, label]) => (
                <button key={k} className={tab === k ? "" : "secondary"} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>

            {tab === "setup" && <Setup snap={snap} me={me} accounts={accounts} call={call} />}
            {tab === "work" && <Work snap={snap} me={me} call={call} />}
            {tab === "loans" && <Loans snap={snap} me={me} accounts={accounts} call={call} />}
            {tab === "disputes" && <Disputes snap={snap} me={me} accounts={accounts} call={call} />}
            {tab === "amend" && <Amendments snap={snap} me={me} call={call} />}
          </>
        )}
      </main>

      {toast && (
        <div className={"toast " + (toast.type === "err" ? "err" : toast.type === "ok" ? "ok" : "")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{toast.msg}</span>
            <span style={{ cursor: "pointer" }} onClick={() => setToast(null)}>✕</span>
          </div>
        </div>
      )}
    </div>
  );
}
