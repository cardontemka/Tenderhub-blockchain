import { ethers } from "ethers";

// Builds a self-contained NFT: a base64 data URI carrying the JSON metadata and
// a keccak256 hash of that JSON (anchored on-chain together with a timestamp).
// No IPFS needed for the demo — exactly the simulation approach recommended.
export function buildNft(meta) {
  const enriched = { ...meta, createdAt: new Date().toISOString() };
  const json = JSON.stringify(enriched);
  const base64 =
    typeof window !== "undefined"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf-8").toString("base64");
  const uri = `data:application/json;base64,${base64}`;
  const hash = ethers.keccak256(ethers.toUtf8Bytes(json));
  return { uri, hash, json };
}

// Decodes a data: URI produced by buildNft back into an object (for display).
export function decodeNft(uri) {
  try {
    if (!uri || !uri.startsWith("data:application/json;base64,")) return null;
    const b64 = uri.slice("data:application/json;base64,".length);
    const json =
      typeof window !== "undefined"
        ? decodeURIComponent(escape(atob(b64)))
        : Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}
