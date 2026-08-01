import { ethers } from "hardhat";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value.trim();
}

async function main() {
  const faucetAddress = requireEnv("TYSM_V3_SEPOLIA_CONTRACT_ADDRESS");
  const mockTysmAddress = requireEnv("MOCK_TYSM_SEPOLIA_ADDRESS");

  const claimerAddress =
    process.env.TYSM_V3_TEST_CLAIMER_ADDRESS?.trim() ||
    "0x9132cff1d4f2555d0fd09bde8486ab5ba3aed9ad";

  console.log("Reading TYSM Faucet V3 balances on Base Sepolia (read-only)...");
  console.log("Faucet:   ", faucetAddress);
  console.log("MockTYSM: ", mockTysmAddress);
  console.log("Claimer:  ", claimerAddress);

  const faucet = await ethers.getContractAt("TYSMFaucetV3", faucetAddress);
  const mockTYSM = await ethers.getContractAt("MockTYSM", mockTysmAddress);

  const faucetBalanceView: bigint = await faucet.faucetBalance();
  const faucetTokenBalance: bigint = await mockTYSM.balanceOf(faucetAddress);
  const claimerTokenBalance: bigint = await mockTYSM.balanceOf(claimerAddress);
  const info = await faucet.userInfo(claimerAddress);

  console.log("");
  console.log("Balances:");
  console.log("faucet.faucetBalance():        ", faucetBalanceView.toString());
  console.log("MockTYSM.balanceOf(faucet):    ", faucetTokenBalance.toString());
  console.log("MockTYSM.balanceOf(claimer):   ", claimerTokenBalance.toString());

  console.log("");
  console.log("User info (claimer):");
  console.log("lastClaim:   ", info[0].toString());
  console.log("streak:      ", info[1].toString());
  console.log("totalClaimed:", info[2].toString());
  console.log("totalDays:   ", info[3].toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
