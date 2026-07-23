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
  const deadlineRaw = requireEnv("TYSM_V3_TEST_DEADLINE");
  const nonce = requireEnv("TYSM_V3_TEST_NONCE");
  const signature = requireEnv("TYSM_V3_TEST_SIGNATURE");

  const deadline = BigInt(deadlineRaw);

  const [claimer] = await ethers.getSigners();

  console.log("Claiming TYSM Faucet V3 on Base Sepolia...");
  console.log("Claimer:", claimer.address);
  console.log("Faucet:", faucetAddress);
  console.log("MockTYSM:", mockTysmAddress);
  console.log("Deadline:", deadline.toString());
  console.log("Nonce:", nonce);
  console.log("Signature preview:", `${signature.slice(0, 10)}...${signature.slice(-8)}`);

  const faucet = await ethers.getContractAt("TYSMFaucetV3", faucetAddress);
  const mockTYSM = await ethers.getContractAt("MockTYSM", mockTysmAddress);

  const beforeBalance = await mockTYSM.balanceOf(claimer.address);

  console.log("Claimer MockTYSM before:", beforeBalance.toString());

  const tx = await faucet.claimWithSignature(deadline, nonce, signature);

  console.log("Claim tx:", tx.hash);

  await tx.wait();

  const afterBalance = await mockTYSM.balanceOf(claimer.address);

  console.log("Claimer MockTYSM after:", afterBalance.toString());
  console.log("Received:", (afterBalance - beforeBalance).toString());

  const info = await faucet.userInfo(claimer.address);

  console.log("");
  console.log("User info:");
  console.log("lastClaim:", info[0].toString());
  console.log("streak:", info[1].toString());
  console.log("totalClaimed:", info[2].toString());
  console.log("totalDays:", info[3].toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
