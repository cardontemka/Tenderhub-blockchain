"use client";
import { useState } from "react";

export function Action({ n, title, hint, children, enabled = true, why }) {
  return (
    <div className="action">
      <div className="title">
        <span>{title}</span>
        {n != null && <span className="fnum">Функц {n}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
      <div className={enabled ? "" : "disabled-wrap"} style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
        {children}
      </div>
      {!enabled && why && <div className="disabled-note">⚠ {why}</div>}
    </div>
  );
}

export function Text({ label, value, onChange, placeholder }) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      {label && <label>{label}</label>}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Num({ label, value, onChange, placeholder }) {
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      {label && <label>{label}</label>}
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Area({ label, value, onChange, placeholder }) {
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      {label && <label>{label}</label>}
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function AddressSelect({ label, value, onChange, accounts }) {
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      {label && <label>{label}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— сонгох —</option>
        {accounts.map((a) => (
          <option key={a.address} value={a.address}>
            {a.role} · {a.address.slice(0, 8)}…
          </option>
        ))}
      </select>
    </div>
  );
}

// A button that runs an async handler and disables while pending.
export function Run({ children, onClick, kind }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={kind}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : children}
    </button>
  );
}
