// Deploys a sample TenderHub to the connected network and prints the address.
// Account[0] = client (deployer), Account[3] = oracle (the bank), by convention
// matching the frontend role layout.
const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  const client = signers[0];
  const oracle = signers[3];

  const Factory = await hre.ethers.getContractFactory("TenderHub");
  const th = await Factory.connect(client).deploy(
    "ipfs://demo-tender-contract",
    hre.ethers.id("demo-contract-document"),
    "ESCROW-DEMO-001",
    oracle.address
  );
  await th.waitForDeployment();

  console.log("TenderHub deployed to:", await th.getAddress());
  console.log("Client  (account 0):", client.address);
  console.log("Oracle  (account 3):", oracle.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
