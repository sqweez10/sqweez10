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

  const expectedClaimer =
    process.env.TYSM_V3_TEST_CLAIMER_ADDRESS?.trim() ||
    "0x9132cff1d4f2555d0fd09bde8486ab5ba3aed9ad";

  const deadline = BigInt(deadlineRaw);

  const [claimer] = await ethers.getSigners();

  console.log("Claiming TYSM Faucet V3 on Base Sepolia...");
  console.log("Signer / tx sender:", claimer.address);
  console.log("Expected claimer:", expectedClaimer);
  console.log("Faucet:", faucetAddress);
  console.log("MockTYSM:", mockTysmAddress);
  console.log("Deadline:", deadline.toString());
  console.log("Nonce:", nonce);
  console.log(
    "Signature preview:",
    `${signature.slice(0, 10)}...${signature.slice(-8)}`
  );

  if (claimer.address.toLowerCase() !== expectedClaimer.toLowerCase()) {
    throw new Error(
      `BASE_SEPOLIA_PRIVATE_KEY does not match expected claimer. signer=${claimer.address}, expected=${expectedClaimer}`
    );
  }

  const faucet = await ethers.getContractAt("TYSMFaucetV3", faucetAddress);
  const mockTYSM = await ethers.getContractAt("MockTYSM", mockTysmAddress);

  const faucetTokenBalanceBefore = await mockTYSM.balanceOf(faucetAddress);
  const beforeBalance = await mockTYSM.balanceOf(claimer.address);

  console.log("");
  console.log("Before claim:");
  console.log("Faucet MockTYSM:", faucetTokenBalanceBefore.toString());
  console.log("Claimer MockTYSM:", beforeBalance.toString());

  const tx = await faucet.claimWithSignature(deadline, nonce, signature);

  console.log("");
  console.log("Claim tx:", tx.hash);

  const receipt = await tx.wait();

  console.log("Claim tx status:", receipt?.status);
  console.log("Claim tx block:", receipt?.blockNumber);

  if (receipt?.status !== 1) {
    throw new Error("Claim transaction failed");
  }

  const faucetTokenBalanceAfter = await mockTYSM.balanceOf(faucetAddress);
  const afterBalance = await mockTYSM.balanceOf(claimer.address);

  console.log("");
  console.log("After claim:");
  console.log("Faucet MockTYSM:", faucetTokenBalanceAfter.toString());
  console.log("Claimer MockTYSM:", afterBalance.toString());
  console.log("Received:", (afterBalance - beforeBalance).toString());
  console.log(
    "Faucet spent:",
    (faucetTokenBalanceBefore - faucetTokenBalanceAfter).toString()
  );

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
