// Off-chain document store (a stand-in for a real database / file server),
// backed by the browser's localStorage. Blockchain keeps ONLY the keccak256
// hash of each material; the actual content (addressed by a URL) lives here.
// If the off-chain content is later edited, its recomputed hash no longer
// matches the on-chain hash — which is exactly what we surface in the UI.
const KEY = "th_docstore";

function readAll() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(map) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function saveDoc(url, content) {
  const m = readAll();
  m[url] = content;
  writeAll(m);
}

export function loadDoc(url) {
  const m = readAll();
  return url in m ? m[url] : null;
}

export function newUrl() {
  return (
    "thdoc://" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}
