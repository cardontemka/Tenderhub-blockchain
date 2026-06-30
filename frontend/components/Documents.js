"use client";
import { useState } from "react";
import { verifyDoc, prettyContent } from "../lib/nft";
import { saveDoc, loadDoc } from "../lib/docstore";
import { ts } from "../lib/format";

export default function Documents({ documents, label }) {
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState(null);

  const sel = documents.find((d) => d.id.toString() === String(selId)) || null;

  function open(doc) {
    setSelId(doc.id.toString());
    setDraft(loadDoc(doc.uri) ?? "");
    setResult(verifyDoc(doc.uri, doc.hash));
  }

  function recheck(doc) {
    setResult(verifyDoc(doc.uri, doc.hash));
  }

  // Tamper test: overwrite the off-chain content; the on-chain hash is unchanged,
  // so verification should now FAIL.
  function applyEdit(doc) {
    saveDoc(doc.uri, draft);
    setResult(verifyDoc(doc.uri, doc.hash));
  }

  return (
    <>
      <h3>Баримт бичгүүд (NFT) — hash on-chain, контент off-chain</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Төрөл</th>
            <th>Илгээгч</th>
            <th>Огноо</th>
            <th>On-chain hash</th>
            <th>URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 && (
            <tr>
              <td colSpan={7} className="sub">Баримт алга.</td>
            </tr>
          )}
          {documents.map((d) => (
            <tr key={d.id.toString()}>
              <td>{d.id.toString()}</td>
              <td>{d.docType}</td>
              <td>{label(d.submitter)}</td>
              <td>{ts(d.timestamp)}</td>
              <td className="mono">{d.hash.slice(0, 10)}…</td>
              <td className="mono">{String(d.uri).slice(0, 18)}…</td>
              <td>
                <button className="ghost" onClick={() => open(d)}>Шалгах</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sel && result && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            marginTop: 10,
            background: "var(--panel-2)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Баримт #{sel.id.toString()} ({sel.docType}) шалгах</b>
            {!result.found ? (
              <span className="badge warn">Off-chain контент олдсонгүй</span>
            ) : result.match ? (
              <span className="badge ok">✓ Бүрэн бүтэн (hash таарсан)</span>
            ) : (
              <span className="badge danger">✗ Зөрчилтэй — контент өөрчлөгдсөн!</span>
            )}
          </div>

          <div className="kv" style={{ marginTop: 8 }}>
            <span>On-chain hash</span>
            <span className="mono">{sel.hash}</span>
          </div>
          <div className="kv">
            <span>Дахин тооцсон hash</span>
            <span className="mono">{result.recomputed || "—"}</span>
          </div>
          <div className="kv">
            <span>URL (off-chain)</span>
            <span className="mono">{String(sel.uri)}</span>
          </div>

          <label style={{ marginTop: 10 }}>Off-chain контент (засаж туршиж болно)</label>
          <textarea
            style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 11 }}
            value={result.found ? draft : "(localStorage-д контент алга)"}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!result.found}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => recheck(sel)}>Дахин шалгах</button>
            <button
              className="danger"
              disabled={!result.found}
              onClick={() => applyEdit(sel)}
              title="Контентыг өөрчилж хадгална — hash зөрнө"
            >
              Контентыг өөрчлөх (зөрчил үүсгэх тест)
            </button>
            <button className="secondary" onClick={() => setSelId(null)}>Хаах</button>
          </div>
          {result.found && (
            <details style={{ marginTop: 8 }}>
              <summary className="sub">JSON харах</summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                {prettyContent(loadDoc(sel.uri))}
              </pre>
            </details>
          )}
        </div>
      )}
    </>
  );
}
