import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "";
const baseSepoliaPrivateKey = process.env.BASE_SEPOLIA_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: baseSepoliaRpcUrl,
      accounts: baseSepoliaPrivateKey ? [baseSepoliaPrivateKey] : [],
      chainId: 84532,
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
