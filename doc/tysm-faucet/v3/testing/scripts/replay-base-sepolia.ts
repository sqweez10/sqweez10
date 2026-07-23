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
  const deadlineRaw = requireEnv("TYSM_V3_TEST_DEADLINE");
  const nonce = requireEnv("TYSM_V3_TEST_NONCE");
  const signature = requireEnv("TYSM_V3_TEST_SIGNATURE");

  const deadline = BigInt(deadlineRaw);

  const [claimer] = await ethers.getSigners();

  console.log("Testing replay rejection on Base Sepolia...");
  console.log("Claimer:", claimer.address);
  console.log("Faucet:", faucetAddress);

  const faucet = await ethers.getContractAt("TYSMFaucetV3", faucetAddress);

  try {
    const tx = await faucet.claimWithSignature(deadline, nonce, signature);
    console.log("Unexpected replay tx sent:", tx.hash);
    await tx.wait();
    throw new Error("Replay unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.log("Replay rejected as expected.");
    console.log("Error preview:", message.slice(0, 500));

    if (!message.includes("Authorization already used")) {
      console.warn(
        "Warning: replay failed, but error message did not include expected text."
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
