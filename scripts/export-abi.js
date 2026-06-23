// Copies the compiled ABI + bytecode into the frontend so it can deploy and
// interact with TenderHub against the local Hardhat node.
const fs = require("fs");
const path = require("path");

async function main() {
  const artifact = require("../artifacts/contracts/TenderHub.sol/TenderHub.json");
  const out = {
    contractName: artifact.contractName,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  };
  const destDir = path.join(__dirname, "..", "frontend", "lib");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "TenderHub.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log("Exported ABI + bytecode ->", dest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
