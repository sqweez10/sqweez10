import { ethers } from "hardhat";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads faucet + claimer MockTYSM balances, retrying a few times with a
 * short delay between attempts, until either balance actually differs
 * from the pre-claim snapshot (or attempts run out). This exists
 * because some RPC providers (especially on testnets) can briefly serve
 * a stale state right after a transaction confirms — a single
 * immediate read can report the *same* balances as before the claim
 * even though the claim already succeeded on-chain (as confirmed
 * separately by check-balance.cjs). Retrying avoids misreporting a
 * successful payout as "Received: 0" / "Faucet spent: 0".
 *
 * Note: checking for non-zero balances alone isn't enough here, since
 * the faucet's balance is already large and non-zero *before* the
 * claim too — a stale read of the pre-claim balance would pass a
 * "is it non-zero" check on the very first attempt while still being
 * wrong. Comparing against the known "before" snapshot is what
 * actually detects staleness.
 */
async function readBalancesWithRetry(
  mockTYSM: any,
  faucetAddress: string,
  claimerAddress: string,
  beforeFaucetBalance: bigint,
  beforeClaimerBalance: bigint,
  attempts = 5,
  delayMs = 2500
): Promise<{ faucetBalance: bigint; claimerBalance: bigint }> {
  let faucetBalance = beforeFaucetBalance;
  let claimerBalance = beforeClaimerBalance;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    faucetBalance = await mockTYSM.balanceOf(faucetAddress);
    claimerBalance = await mockTYSM.balanceOf(claimerAddress);

    const changed =
      faucetBalance !== beforeFaucetBalance ||
      claimerBalance !== beforeClaimerBalance;

    if (changed) {
      return { faucetBalance, claimerBalance };
    }

    if (attempt < attempts) {
      console.log(
        `  (attempt ${attempt}/${attempts}) balances read identical to pre-claim snapshot, retrying in ${
          delayMs / 1000
        }s...`
      );
      await sleep(delayMs);
    }
  }

  // Ran out of attempts without seeing a change. Return the last read
  // as-is — the caller decides how to report/warn about this.
  return { faucetBalance, claimerBalance };
}

/**
 * Best-effort check for an ERC20 Transfer event in the receipt logs, so
 * we can tell the difference between "no transfer happened" and "a
 * transfer happened but this script's balance reads are stale/wrong".
 * Only logs emitted by the MockTYSM token contract itself are parsed —
 * logs from other contracts in the same tx (if any) are skipped before
 * attempting to decode them, to avoid mis-parsing unrelated log data.
 */
function findTransferInReceipt(
  mockTYSM: any,
  receipt: any,
  faucetAddress: string,
  claimerAddress: string,
  mockTysmAddress: string
): { found: boolean; from?: string; to?: string; amount?: bigint } {
  if (!receipt?.logs) return { found: false };

  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== mockTysmAddress.toLowerCase()) {
      continue;
    }

    try {
      const parsed = mockTYSM.interface.parseLog(log);
      if (!parsed || parsed.name !== "Transfer") continue;

      const from = String(parsed.args.from).toLowerCase();
      const to = String(parsed.args.to).toLowerCase();

      if (
        from === faucetAddress.toLowerCase() &&
        to === claimerAddress.toLowerCase()
      ) {
        return { found: true, from, to, amount: parsed.args.value as bigint };
      }
    } catch {
      // Not a log this interface knows how to parse (e.g. a log from a
      // different contract) — skip it.
      continue;
    }
  }

  return { found: false };
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
  console.log("Expected claimer:  ", expectedClaimer);
  console.log("Faucet:            ", faucetAddress);
  console.log("MockTYSM:          ", mockTysmAddress);
  console.log("Deadline:          ", deadline.toString());
  console.log("Nonce:             ", nonce);
  console.log(
    "Signature preview: ",
    `${signature.slice(0, 10)}...${signature.slice(-8)}`
  );

  if (claimer.address.toLowerCase() !== expectedClaimer.toLowerCase()) {
    throw new Error(
      `BASE_SEPOLIA_PRIVATE_KEY does not match expected claimer. signer=${claimer.address}, expected=${expectedClaimer}`
    );
  }

  const faucet = await ethers.getContractAt("TYSMFaucetV3", faucetAddress);
  const mockTYSM = await ethers.getContractAt("MockTYSM", mockTysmAddress);

  const faucetTokenBalanceBefore: bigint = await mockTYSM.balanceOf(
    faucetAddress
  );
  const beforeBalance: bigint = await mockTYSM.balanceOf(claimer.address);

  console.log("");
  console.log("Before claim:");
  console.log("Faucet MockTYSM:  ", faucetTokenBalanceBefore.toString());
  console.log("Claimer MockTYSM: ", beforeBalance.toString());

  const tx = await faucet.claimWithSignature(deadline, nonce, signature);

  console.log("");
  console.log("Claim tx:", tx.hash);

  const receipt = await tx.wait();

  console.log("Claim tx status:", receipt?.status);
  console.log("Claim tx block: ", receipt?.blockNumber);

  if (receipt?.status !== 1) {
    throw new Error("Claim transaction failed");
  }

  // Give the RPC a brief moment before the first read attempt. This is
  // deliberately short — readBalancesWithRetry() below handles the real
  // retrying/backoff; this is just a small head start.
  await sleep(1500);

  console.log("");
  console.log("Reading post-claim balances (with retry)...");

  const { faucetBalance: faucetTokenBalanceAfter, claimerBalance: afterBalance } =
    await readBalancesWithRetry(
      mockTYSM,
      faucetAddress,
      claimer.address,
      faucetTokenBalanceBefore,
      beforeBalance
    );

  const received = afterBalance - beforeBalance;
  const faucetSpent = faucetTokenBalanceBefore - faucetTokenBalanceAfter;

  console.log("");
  console.log("After claim:");
  console.log("Faucet MockTYSM:  ", faucetTokenBalanceAfter.toString());
  console.log("Claimer MockTYSM: ", afterBalance.toString());
  console.log("Received:         ", received.toString());
  console.log("Faucet spent:     ", faucetSpent.toString());

  if (received === 0n || faucetSpent === 0n || received !== faucetSpent) {
    // The transaction succeeded (status 1, checked above). A genuinely
    // zero reward, or a mismatch between what the claimer received and
    // what the faucet spent, would both be unusual — rather than assert
    // that definitely didn't happen, look for a matching Transfer event
    // in this exact receipt as one more independent signal before
    // deciding how to phrase the warning.
    const transfer = findTransferInReceipt(
      mockTYSM,
      receipt,
      faucetAddress,
      claimer.address,
      mockTysmAddress
    );

    console.log("");
    if (transfer.found) {
      console.log(
        `Note: a Transfer event of ${transfer.amount?.toString()} was found in this transaction's logs (faucet -> claimer), but the balance reads above look inconsistent (received=${received.toString()}, faucetSpent=${faucetSpent.toString()}).`
      );
      console.log(
        "Warning: tx succeeded and a token transfer was recorded in this transaction, but this script's balance reads did not match cleanly. This looks like a stale/lagging RPC read, not a failed payout."
      );
    } else {
      console.log(
        "Warning: tx succeeded but this script's balance reads look inconsistent, and no matching Transfer event was found in this transaction's logs."
      );
    }
    console.log(
      "Tip: if balances look stale, run: pnpm exec hardhat run check-balance.cjs --network baseSepolia"
    );
  }

  const info = await faucet.userInfo(claimer.address);

  console.log("");
  console.log("User info:");
  console.log("lastClaim:   ", info[0].toString());
  console.log("streak:      ", info[1].toString());
  console.log("totalClaimed:", info[2].toString());
  console.log("totalDays:   ", info[3].toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
