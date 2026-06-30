import { ethers } from "ethers";
import { saveDoc, loadDoc, newUrl } from "./docstore";

// keccak256 of the UTF-8 content — the same hashing the contract stores on-chain.
export function hashContent(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

// Build an NFT material. The content (a JSON document addressed by a URL) is
// stored OFF-CHAIN in localStorage; only its hash is anchored on-chain (passed
// to the contract alongside the URL). No IPFS / real DB needed for the demo.
export function buildNft(meta) {
  const content = JSON.stringify({ ...meta, createdAt: new Date().toISOString() });
  const uri = newUrl();
  saveDoc(uri, content);
  return { uri, hash: hashContent(content), content };
}

// Verify an on-chain document: fetch its off-chain content, recompute the hash
// and compare it to the hash stored on-chain. A mismatch means the off-chain
// material was altered after it was anchored.
export function verifyDoc(uri, onchainHash) {
  const content = loadDoc(uri);
  if (content == null) {
    return { found: false, match: false, content: null, recomputed: null };
  }
  const recomputed = hashContent(content);
  const match = recomputed.toLowerCase() === String(onchainHash).toLowerCase();
  return { found: true, match, content, recomputed };
}

// Pretty-print stored JSON content (best effort).
export function prettyContent(content) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content ?? "";
  }
}
