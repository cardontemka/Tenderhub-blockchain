import { ethers } from "ethers";
import artifact from "./TenderHub.json";

export const RPC_URL = "http://127.0.0.1:8545";
// Hardhat's deterministic dev mnemonic — these are the funded local accounts.
export const MNEMONIC =
  "test test test test test test test test test test test junk";

// Suggested role layout used by the demo (the contract enforces the real roles).
export const ACCOUNT_ROLES = [
  "Захиалагч (Client)",
  "Гүйцэтгэгч (Contractor)",
  "Арбитр (Arbiter)",
  "Банк / Oracle",
  "Зээл олгогч (Lender)",
  "Арбитр 2 (Appeal)",
  "Гадны хаяг 1",
  "Гадны хаяг 2",
  "Гадны хаяг 3",
  "Гадны хаяг 4",
];

export function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

export function getAccounts(provider) {
  const mnemonic = ethers.Mnemonic.fromPhrase(MNEMONIC);
  const out = [];
  for (let i = 0; i < ACCOUNT_ROLES.length; i++) {
    const w = ethers.HDNodeWallet.fromMnemonic(
      mnemonic,
      `m/44'/60'/0'/0/${i}`
    ).connect(provider);
    // NonceManager keeps sequential sends from the same account from racing on
    // the pending nonce (e.g. deploy immediately followed by another tx).
    const wallet = new ethers.NonceManager(w);
    out.push({ index: i, address: w.address, role: ACCOUNT_ROLES[i], wallet });
  }
  return out;
}

export function getContractRead(address, provider) {
  return new ethers.Contract(address, artifact.abi, provider);
}

export function getContractWrite(address, wallet) {
  return new ethers.Contract(address, artifact.abi, wallet);
}

export async function deployTender(wallet, { uri, hash, escrow, oracle }) {
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );
  // The contract is >24KB, so the node's gas estimation balks on the creation
  // tx; pass an explicit gas limit (the local network allows unlimited size).
  const c = await factory.deploy(uri, hash, escrow, oracle, {
    gasLimit: 12_000_000,
  });
  await c.waitForDeployment();
  return await c.getAddress();
}

export { artifact };
