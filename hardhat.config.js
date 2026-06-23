require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // OpenZeppelin v5.1 uses the `mcopy` opcode (Cancun).
      evmVersion: "cancun",
      // The contract is large; enable viaIR so the optimizer can fit it.
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // The TenderHub contract is feature-rich; lift the 24KB code-size limit
      // for the local test/dev network so it can be deployed for visual testing.
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};
