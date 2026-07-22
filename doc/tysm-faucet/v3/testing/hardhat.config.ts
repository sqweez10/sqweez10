import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

/**
 * Draft / testing-only Hardhat config for TYSMFaucetV3 (Fresh Start).
 *
 * IMPORTANT:
 * - This config intentionally defines only the local in-memory Hardhat
 *   Network. No mainnet, testnet, or any other live network is
 *   configured here.
 * - Do not add a mainnet network entry to this file.
 * - Do not add real private keys, mnemonics, or RPC URls with embedded
 *   secrets to this file or to a .env file committed alongside it.
 * - This project exists purely to run automated tests against
 *   TYSMFaucetV3.draft.sol and MockTYSM.sol locally.
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Local in-memory network only. No forking, no external RPC.
    },
  },
};

export default config;
