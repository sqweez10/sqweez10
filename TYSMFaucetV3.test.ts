import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * TYSMFaucetV3 (Fresh Start) — draft test suite.
 *
 * IMPORTANT:
 * - Testing only. Nothing here deploys to, or interacts with, any real
 *   network. All signer wallets used to sign claim authorizations are
 *   freshly generated random test wallets (`ethers.Wallet.createRandom()`),
 *   never real private keys.
 * - V3 is Fresh Start: it never reads from or depends on V2 / MockFaucetV2.
 *   No MockFaucetV2 contract is deployed or referenced anywhere in this
 *   file.
 */

const DAY = 24 * 60 * 60;

const REWARD_2000 = ethers.parseUnits("2000", 18);
const REWARD_10000 = ethers.parseUnits("10000", 18);
const REWARD_40000 = ethers.parseUnits("40000", 18);
const REWARD_90000 = ethers.parseUnits("90000", 18);

// Plenty of TYSM to cover a full 30+ day claim cycle in tests.
const POOL_FUNDING = ethers.parseUnits("5000000", 18);

const CLAIM_TYPES = {
  ClaimAuthorization: [
    { name: "user", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

async function eip712Domain(faucet: any, chainId: bigint) {
  return {
    name: "TYSMFaucetV3",
    version: "1",
    chainId,
    verifyingContract: await faucet.getAddress(),
  };
}

function randomNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

async function futureDeadline(secondsFromNow = 600): Promise<number> {
  const now = await time.latest();
  return now + secondsFromNow;
}

async function signClaim(
  signerWallet: any,
  faucet: any,
  chainId: bigint,
  user: string,
  deadline: number,
  nonce: string
): Promise<string> {
  const domain = await eip712Domain(faucet, chainId);
  const value = { user, deadline, nonce };
  return signerWallet.signTypedData(domain, CLAIM_TYPES, value);
}

/**
 * Signs and submits a claim on behalf of `userSigner`, using a fresh
 * random nonce and a near-future deadline unless overridden.
 */
async function claim(
  faucet: any,
  signerWallet: any,
  chainId: bigint,
  userSigner: any,
  overrides?: { deadline?: number; nonce?: string }
) {
  const deadline = overrides?.deadline ?? (await futureDeadline());
  const nonce = overrides?.nonce ?? randomNonce();
  const signature = await signClaim(
    signerWallet,
    faucet,
    chainId,
    userSigner.address,
    deadline,
    nonce
  );
  return faucet.connect(userSigner).claimWithSignature(deadline, nonce, signature);
}

/** Deploys MockTYSM + TYSMFaucetV3, without funding the faucet. */
async function deployCore() {
  const [owner, userA, userB, other] = await ethers.getSigners();

  // Dedicated test-only signer wallet. Freshly generated every test run —
  // never a real private key.
  const signerWallet = ethers.Wallet.createRandom();

  const MockTYSM = await ethers.getContractFactory("MockTYSM");
  const tysm = await MockTYSM.deploy();
  await tysm.waitForDeployment();

  const TYSMFaucetV3 = await ethers.getContractFactory("TYSMFaucetV3");
  const faucet = await TYSMFaucetV3.deploy(
    await tysm.getAddress(),
    signerWallet.address,
    owner.address
  );
  await faucet.waitForDeployment();

  const network = await ethers.provider.getNetwork();

  return {
    faucet,
    tysm,
    owner,
    userA,
    userB,
    other,
    signerWallet,
    chainId: network.chainId,
  };
}

/** Deploys and funds the faucet with a large MockTYSM balance. */
async function deployFixture() {
  const ctx = await deployCore();
  await ctx.tysm.mint(await ctx.faucet.getAddress(), POOL_FUNDING);
  return ctx;
}

describe("TYSMFaucetV3 (Fresh Start)", function () {
  // =========================================================
  // 1. Deployment
  // =========================================================
  describe("Deployment", () => {
    it("sets tysm, signer, and owner correctly", async () => {
      const { faucet, tysm, owner, signerWallet } = await deployFixture();

      expect(await faucet.tysm()).to.equal(await tysm.getAddress());
      expect(await faucet.signer()).to.equal(signerWallet.address);
      expect(await faucet.owner()).to.equal(owner.address);
    });

    it("funds the faucet with the expected MockTYSM balance", async () => {
      const { faucet, tysm } = await deployFixture();
      expect(await tysm.balanceOf(await faucet.getAddress())).to.equal(POOL_FUNDING);
    });

    it("has a non-zero DOMAIN_SEPARATOR", async () => {
      const { faucet } = await deployFixture();
      expect(await faucet.DOMAIN_SEPARATOR()).to.not.equal(ethers.ZeroHash);
    });

    it("reverts on a zero TYSM token address", async () => {
      const [owner] = await ethers.getSigners();
      const signerWallet = ethers.Wallet.createRandom();
      const TYSMFaucetV3 = await ethers.getContractFactory("TYSMFaucetV3");

      await expect(
        TYSMFaucetV3.deploy(ethers.ZeroAddress, signerWallet.address, owner.address)
      ).to.be.revertedWith("Zero token address");
    });

    it("reverts on a zero signer address", async () => {
      const [owner] = await ethers.getSigners();
      const MockTYSM = await ethers.getContractFactory("MockTYSM");
      const tysm = await MockTYSM.deploy();
      await tysm.waitForDeployment();
      const TYSMFaucetV3 = await ethers.getContractFactory("TYSMFaucetV3");

      await expect(
        TYSMFaucetV3.deploy(await tysm.getAddress(), ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Zero signer address");
    });

    it("reverts on a zero owner address", async () => {
      const signerWallet = ethers.Wallet.createRandom();
      const MockTYSM = await ethers.getContractFactory("MockTYSM");
      const tysm = await MockTYSM.deploy();
      await tysm.waitForDeployment();
      const TYSMFaucetV3 = await ethers.getContractFactory("TYSMFaucetV3");

      await expect(
        TYSMFaucetV3.deploy(await tysm.getAddress(), signerWallet.address, ethers.ZeroAddress)
      ).to.be.revertedWith("Zero owner address");
    });
  });

  // =========================================================
  // 2. Fresh Start
  // =========================================================
  describe("Fresh Start", () => {
    it("gives a brand new wallet all-zero userInfo", async () => {
      const { faucet, userA } = await deployFixture();
      const info = await faucet.userInfo(userA.address);

      expect(info.lastClaim).to.equal(0);
      expect(info.streak).to.equal(0);
      expect(info.totalClaimed).to.equal(0);
      expect(info.totalDays).to.equal(0);
    });

    it("pays exactly 2,000 TYSM on the first valid claim and sets fields correctly", async () => {
      const { faucet, tysm, userA, signerWallet, chainId } = await deployFixture();

      const balBefore = await tysm.balanceOf(userA.address);
      await claim(faucet, signerWallet, chainId, userA);
      const balAfter = await tysm.balanceOf(userA.address);

      expect(balAfter - balBefore).to.equal(REWARD_2000);

      const info = await faucet.userInfo(userA.address);
      expect(info.streak).to.equal(1);
      expect(info.totalDays).to.equal(1);
      expect(info.totalClaimed).to.equal(REWARD_2000);
      expect(info.lastClaim).to.be.gt(0);
    });

    it("has no V2-related functions in its ABI (no oldFaucet/migrated)", async () => {
      const { faucet } = await deployFixture();
      const fragmentNames = faucet.interface.fragments
        .map((f: any) => f.name)
        .filter(Boolean);

      expect(fragmentNames).to.not.include("oldFaucet");
      expect(fragmentNames).to.not.include("migrated");
    });
  });

  // =========================================================
  // 3. EIP-712 signature
  // =========================================================
  describe("EIP-712 signature", () => {
    it("accepts a valid signature", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();
      await expect(claim(faucet, signerWallet, chainId, userA)).to.not.be.reverted;
    });

    it("reverts with an expired deadline", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();

      const now = await time.latest();
      const expiredDeadline = now - 10;
      const nonce = randomNonce();
      const signature = await signClaim(
        signerWallet,
        faucet,
        chainId,
        userA.address,
        expiredDeadline,
        nonce
      );

      await expect(
        faucet.connect(userA).claimWithSignature(expiredDeadline, nonce, signature)
      ).to.be.revertedWith("Signature expired");
    });

    it("reverts on a reused signature/nonce/deadline", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();

      const deadline = await futureDeadline();
      const nonce = randomNonce();
      const signature = await signClaim(
        signerWallet,
        faucet,
        chainId,
        userA.address,
        deadline,
        nonce
      );

      await faucet.connect(userA).claimWithSignature(deadline, nonce, signature);

      await expect(
        faucet.connect(userA).claimWithSignature(deadline, nonce, signature)
      ).to.be.revertedWith("Authorization already used");
    });

    it("reverts when signed by the wrong signer", async () => {
      const { faucet, userA, chainId } = await deployFixture();
      const wrongSigner = ethers.Wallet.createRandom();

      const deadline = await futureDeadline();
      const nonce = randomNonce();
      const signature = await signClaim(
        wrongSigner,
        faucet,
        chainId,
        userA.address,
        deadline,
        nonce
      );

      await expect(
        faucet.connect(userA).claimWithSignature(deadline, nonce, signature)
      ).to.be.revertedWith("Invalid signer");
    });

    it("does not allow a signature issued for Wallet A to be used by Wallet B", async () => {
      const { faucet, userA, userB, signerWallet, chainId } = await deployFixture();

      const deadline = await futureDeadline();
      const nonce = randomNonce();
      // Signed specifically authorizing userA.
      const signature = await signClaim(
        signerWallet,
        faucet,
        chainId,
        userA.address,
        deadline,
        nonce
      );

      await expect(
        faucet.connect(userB).claimWithSignature(deadline, nonce, signature)
      ).to.be.revertedWith("Invalid signer");
    });
  });

  // =========================================================
  // 4. Cooldown
  // =========================================================
  describe("Cooldown", () => {
    it("reverts on an immediate second claim", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();

      await claim(faucet, signerWallet, chainId, userA);

      await expect(claim(faucet, signerWallet, chainId, userA)).to.be.revertedWith(
        "Come back in 24 hours"
      );
    });

    it("succeeds after 24 hours and increments the streak", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();

      await claim(faucet, signerWallet, chainId, userA);
      await time.increase(DAY);

      await expect(claim(faucet, signerWallet, chainId, userA)).to.not.be.reverted;

      const info = await faucet.userInfo(userA.address);
      expect(info.streak).to.equal(2);
    });

    it("resets the streak to 1 if more than 48 hours pass between claims", async () => {
      const { faucet, userA, signerWallet, chainId } = await deployFixture();

      await claim(faucet, signerWallet, chainId, userA);
      await time.increase(48 * 60 * 60 + 60); // just over 48h

      await claim(faucet, signerWallet, chainId, userA);

      const info = await faucet.userInfo(userA.address);
      expect(info.streak).to.equal(1);
    });
  });

  // =========================================================
  // 5. Reward schedule
  // =========================================================
  describe("Reward schedule", () => {
    it("pays the correct amount across a full 30-day cycle, then resets on day 31", async () => {
      const { faucet, tysm, userA, signerWallet, chainId } = await deployFixture();

      const expectedForDay: Record<number, bigint> = {};
      for (let d = 1; d <= 30; d++) {
        if (d === 7) expectedForDay[d] = REWARD_10000;
        else if (d === 15) expectedForDay[d] = REWARD_40000;
        else if (d === 30) expectedForDay[d] = REWARD_90000;
        else expectedForDay[d] = REWARD_2000;
      }

      for (let day = 1; day <= 30; day++) {
        if (day > 1) {
          await time.increase(DAY);
        }

        const balBefore = await tysm.balanceOf(userA.address);
        await claim(faucet, signerWallet, chainId, userA);
        const balAfter = await tysm.balanceOf(userA.address);

        expect(balAfter - balBefore, `day ${day} reward amount`).to.equal(
          expectedForDay[day]
        );

        const info = await faucet.userInfo(userA.address);
        expect(info.streak, `day ${day} streak`).to.equal(day);
        expect(info.totalDays, `day ${day} totalDays`).to.equal(day);
      }

      // Day 31: streak resets to 1, base reward paid again, totalDays
      // keeps increasing (it never resets).
      await time.increase(DAY);

      const balBefore = await tysm.balanceOf(userA.address);
      await claim(faucet, signerWallet, chainId, userA);
      const balAfter = await tysm.balanceOf(userA.address);

      expect(balAfter - balBefore).to.equal(REWARD_2000);

      const info = await faucet.userInfo(userA.address);
      expect(info.streak).to.equal(1);
      expect(info.totalDays).to.equal(31);
    });
  });

  // =========================================================
  // 6. Blocklist
  // =========================================================
  describe("Blocklist", () => {
    it("prevents a blocked wallet from claiming, and canClaim reflects it", async () => {
      const { faucet, owner, userA, signerWallet, chainId } = await deployFixture();

      await faucet.connect(owner).setBlocked(userA.address, true);
      expect(await faucet.canClaim(userA.address)).to.equal(false);

      await expect(claim(faucet, signerWallet, chainId, userA)).to.be.revertedWith(
        "Blocked"
      );
    });

    it("allows claiming again after the owner unblocks a wallet", async () => {
      const { faucet, owner, userA, signerWallet, chainId } = await deployFixture();

      await faucet.connect(owner).setBlocked(userA.address, true);
      await faucet.connect(owner).setBlocked(userA.address, false);

      await expect(claim(faucet, signerWallet, chainId, userA)).to.not.be.reverted;
    });

    it("setBlockedBatch blocks multiple wallets in one call", async () => {
      const { faucet, owner, userA, userB, signerWallet, chainId } = await deployFixture();

      await faucet.connect(owner).setBlockedBatch([userA.address, userB.address], true);

      expect(await faucet.canClaim(userA.address)).to.equal(false);
      expect(await faucet.canClaim(userB.address)).to.equal(false);

      await expect(claim(faucet, signerWallet, chainId, userA)).to.be.revertedWith(
        "Blocked"
      );
      await expect(claim(faucet, signerWallet, chainId, userB)).to.be.revertedWith(
        "Blocked"
      );
    });
  });

  // =========================================================
  // 7. Pause
  // =========================================================
  describe("Pause", () => {
    it("blocks claims while paused and allows them again after unpause", async () => {
      const { faucet, owner, userA, signerWallet, chainId } = await deployFixture();

      await faucet.connect(owner).pause();

      expect(await faucet.canClaim(userA.address)).to.equal(false);
      await expect(claim(faucet, signerWallet, chainId, userA)).to.be.revertedWith(
        "Faucet is paused"
      );

      await faucet.connect(owner).unpause();
      await expect(claim(faucet, signerWallet, chainId, userA)).to.not.be.reverted;
    });
  });

  // =========================================================
  // 8. Pool empty
  // =========================================================
  describe("Pool empty", () => {
    it("reverts with Faucet empty when the contract has insufficient MockTYSM", async () => {
      // Deliberately use the unfunded core deployment.
      const { faucet, userA, signerWallet, chainId } = await deployCore();

      await expect(claim(faucet, signerWallet, chainId, userA)).to.be.revertedWith(
        "Faucet empty"
      );
    });
  });

  // =========================================================
  // 9. Owner-only
  // =========================================================
  describe("Owner-only functions", () => {
    it("setSigner: reverts for non-owner, succeeds for owner", async () => {
      const { faucet, owner, other } = await deployFixture();
      const newSigner = ethers.Wallet.createRandom();

      await expect(
        faucet.connect(other).setSigner(newSigner.address)
      ).to.be.revertedWith("Not owner");

      await expect(faucet.connect(owner).setSigner(newSigner.address)).to.not.be.reverted;
      expect(await faucet.signer()).to.equal(newSigner.address);
    });

    it("setBlocked: reverts for non-owner, succeeds for owner", async () => {
      const { faucet, owner, userA, other } = await deployFixture();

      await expect(
        faucet.connect(other).setBlocked(userA.address, true)
      ).to.be.revertedWith("Not owner");

      await expect(faucet.connect(owner).setBlocked(userA.address, true)).to.not.be
        .reverted;
    });

    it("setBlockedBatch: reverts for non-owner, succeeds for owner", async () => {
      const { faucet, owner, userA, userB, other } = await deployFixture();

      await expect(
        faucet.connect(other).setBlockedBatch([userA.address, userB.address], true)
      ).to.be.revertedWith("Not owner");

      await expect(
        faucet.connect(owner).setBlockedBatch([userA.address, userB.address], true)
      ).to.not.be.reverted;
    });

    it("pause/unpause: revert for non-owner, succeed for owner", async () => {
      const { faucet, owner, other } = await deployFixture();

      await expect(faucet.connect(other).pause()).to.be.revertedWith("Not owner");
      await expect(faucet.connect(owner).pause()).to.not.be.reverted;

      await expect(faucet.connect(other).unpause()).to.be.revertedWith("Not owner");
      await expect(faucet.connect(owner).unpause()).to.not.be.reverted;
    });

    it("withdrawTokens: reverts for non-owner, succeeds for owner", async () => {
      const { faucet, owner, other } = await deployFixture();

      await expect(
        faucet.connect(other).withdrawTokens(other.address, REWARD_2000)
      ).to.be.revertedWith("Not owner");

      await expect(
        faucet.connect(owner).withdrawTokens(owner.address, REWARD_2000)
      ).to.not.be.reverted;
    });

    it("transferOwnership: reverts for non-owner, succeeds for owner", async () => {
      const { faucet, owner, other } = await deployFixture();

      await expect(
        faucet.connect(other).transferOwnership(other.address)
      ).to.be.revertedWith("Not owner");

      await expect(faucet.connect(owner).transferOwnership(other.address)).to.not.be
        .reverted;
      expect(await faucet.owner()).to.equal(other.address);
    });
  });

  // =========================================================
  // 10. Withdraw
  // =========================================================
  describe("Withdraw", () => {
    it("lets the owner withdraw MockTYSM", async () => {
      const { faucet, tysm, owner } = await deployFixture();

      const balBefore = await tysm.balanceOf(owner.address);
      await faucet.connect(owner).withdrawTokens(owner.address, REWARD_2000);
      const balAfter = await tysm.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(REWARD_2000);
    });

    it("reverts when withdrawing a zero amount", async () => {
      const { faucet, owner } = await deployFixture();

      await expect(
        faucet.connect(owner).withdrawTokens(owner.address, 0)
      ).to.be.revertedWith("Amount must be greater than zero");
    });

    it("reverts when withdrawing to the zero address", async () => {
      const { faucet, owner } = await deployFixture();

      await expect(
        faucet.connect(owner).withdrawTokens(ethers.ZeroAddress, REWARD_2000)
      ).to.be.revertedWith("Zero address");
    });

    it("reverts when withdrawing more than the contract's balance", async () => {
      const { faucet, tysm, owner } = await deployFixture();

      const balance: bigint = await tysm.balanceOf(await faucet.getAddress());

      await expect(
        faucet.connect(owner).withdrawTokens(owner.address, balance + 1n)
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  // =========================================================
  // 11. View functions
  // =========================================================
  describe("View functions", () => {
    it("canClaim, getTimeLeft, nextReward, faucetBalance, userInfo, totalClaimsCount", async () => {
      const { faucet, tysm, userA, signerWallet, chainId } = await deployFixture();

      // Before any claim.
      expect(await faucet.canClaim(userA.address)).to.equal(true);
      expect(await faucet.getTimeLeft(userA.address)).to.equal(0);
      expect(await faucet.nextReward(userA.address)).to.equal(REWARD_2000);
      expect(await faucet.faucetBalance()).to.equal(
        await tysm.balanceOf(await faucet.getAddress())
      );
      expect(await faucet.totalClaimsCount()).to.equal(0);

      // After the first claim.
      await claim(faucet, signerWallet, chainId, userA);

      expect(await faucet.canClaim(userA.address)).to.equal(false);
      expect(await faucet.getTimeLeft(userA.address)).to.be.gt(0);
      expect(await faucet.totalClaimsCount()).to.equal(1);

      const info = await faucet.userInfo(userA.address);
      expect(info.streak).to.equal(1);

      // Fewer than 48h have passed, so the predicted next streak is 2,
      // which still pays the 2,000 TYSM base reward.
      expect(await faucet.nextReward(userA.address)).to.equal(REWARD_2000);

      // Eligible again after 24h.
      await time.increase(DAY);
      expect(await faucet.canClaim(userA.address)).to.equal(true);
      expect(await faucet.getTimeLeft(userA.address)).to.equal(0);
    });
  });

  // =========================================================
  // 12. ETH / fallback
  // =========================================================
  describe("Direct ETH / fallback", () => {
    it("reverts a plain ETH transfer with Direct ETH not accepted", async () => {
      const { faucet, userA } = await deployFixture();

      await expect(
        userA.sendTransaction({
          to: await faucet.getAddress(),
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("Direct ETH not accepted");
    });

    it("reverts unknown calldata with Unsupported call", async () => {
      const { faucet, userA } = await deployFixture();

      await expect(
        userA.sendTransaction({
          to: await faucet.getAddress(),
          data: "0xdeadbeef",
        })
      ).to.be.revertedWith("Unsupported call");
    });
  });
});
