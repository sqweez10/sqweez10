import { ethers } from "hardhat";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value.trim();
}

async function main() {
  const signerAddress = requireEnv("TYSM_V3_SEPOLIA_SIGNER_ADDRESS");
  const ownerAddress = requireEnv("TYSM_V3_SEPOLIA_OWNER_ADDRESS");

  console.log("Deploying TYSM Faucet V3 Base Sepolia test contracts...");
  console.log("Signer:", signerAddress);
  console.log("Owner:", ownerAddress);

  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);

  const MockTYSM = await ethers.getContractFactory("MockTYSM");
  const mockTYSM = await MockTYSM.deploy();

  await mockTYSM.waitForDeployment();

  const mockTYSMAddress = await mockTYSM.getAddress();

  console.log("MockTYSM deployed:", mockTYSMAddress);

  const TYSMFaucetV3 = await ethers.getContractFactory("TYSMFaucetV3");
  const faucet = await TYSMFaucetV3.deploy(
    mockTYSMAddress,
    signerAddress,
    ownerAddress
  );

  await faucet.waitForDeployment();

  const faucetAddress = await faucet.getAddress();

  console.log("TYSMFaucetV3 deployed:", faucetAddress);

  const fundAmount = ethers.parseUnits("1000000", 18);

  const fundTx = await mockTYSM.transfer(faucetAddress, fundAmount);
  await fundTx.wait();

  console.log("Funded faucet with MockTYSM:", fundAmount.toString());

  const faucetBalance = await mockTYSM.balanceOf(faucetAddress);
  const contractSigner = await faucet.signer();
  const contractOwner = await faucet.owner();

  console.log("");
  console.log("Deployment summary:");
  console.log("MOCK_TYSM_SEPOLIA_ADDRESS=", mockTYSMAddress);
  console.log("TYSM_V3_SEPOLIA_CONTRACT_ADDRESS=", faucetAddress);
  console.log("TYSM_V3_SEPOLIA_SIGNER_ADDRESS=", contractSigner);
  console.log("TYSM_V3_SEPOLIA_OWNER_ADDRESS=", contractOwner);
  console.log("FAUCET_MOCK_TYSM_BALANCE=", faucetBalance.toString());

  console.log("");
  console.log("Next Vercel env vars:");
  console.log(`TYSM_V3_SEPOLIA_CONTRACT_ADDRESS=${faucetAddress}`);
  console.log(`TYSM_V3_SEPOLIA_SIGNER_ADDRESS=${contractSigner}`);
  console.log("TYSM_V3_SEPOLIA_SIGNER_PRIVATE_KEY=<DO_NOT_COMMIT>");
  console.log("NEYNAR_API_KEY=<DO_NOT_COMMIT>");
  console.log("UPSTASH_REDIS_REST_URL=<DO_NOT_COMMIT>");
  console.log("UPSTASH_REDIS_REST_TOKEN=<DO_NOT_COMMIT>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
