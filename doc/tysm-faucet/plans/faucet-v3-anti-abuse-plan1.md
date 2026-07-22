# TYSM Daily Faucet V3 — Anti-Abuse Design Plan

Status: **draft contract reviewed, GitHub Actions test suite passing, backend authorization not started, frontend integration not started, Base Sepolia testing not completed, mainnet deployment blocked.**

---

## 1. Problem statement

`TYSMFaucetV2` (`0x43B68e86F6D6B3ED8d94c2A51015602c7338f124`) lets **any**
wallet call `claim()` with no identity check beyond the 24h cooldown per
address. Because Base supports cheap smart-contract wallets / Account
Abstraction, this is trivially farmable: spin up many wallets, claim
2,000 TYSM from each, forward everything to a collection address.

Observed evidence: multiple UserOperation (`HandleOps`) bundles sweeping
claimed TYSM to `chickenattack.base.eth`, consistent with coordinated multi-wallet farming and smart-wallet farming operations rather than organic community usage.

**Important constraint:** `TYSMFaucetV2` has no native `pause()`
function. It cannot be halted with a single owner call. Any plan to stop
V2 activity at cutover has to work within the functions V2 actually has
(`setCooldown`, `withdrawAll`, `setMilestoneRewards`, `setBaseReward`,
`transferOwnership`) — see §12 "V2 Deprecation Options" below.

**Goal for V3:** make unauthorized, automated multi-wallet farming, smart-wallet farming, unfair farming, and general abuse impractical, without punishing existing genuine daily users any more than necessary. This was an abuse issue and should not be described as a hack.

---

## 2. Design approach: signed claim authorization

Move from "anyone can call `claim()`" to "only wallets holding a valid,
short-lived, backend-issued signature can call `claimWithSignature()`."

High-level flow:

```text
User opens app
   → Frontend calls backend API: "give me a claim authorization"
   → Backend checks: FID/wallet legitimacy, blocklist, rate limits,
     recent share cast (see §8 and §9)
   → Backend signs an authorization (deadline, nonce, signature) with a
     dedicated signer key
   → Frontend calls claimWithSignature(deadline, nonce, signature)
   → Contract verifies signature, deadline, nonce, blocklist, cooldown
   → Contract pays out and marks nonce used

This shifts the actual anti-farming logic (FID checks, wallet clustering,
rate limiting, share verification) to the backend, where it's flexible
and can evolve without a redeploy — the contract's job is just to
trust-but-verify a signature from a key the backend controls.

2.1 Signature contents & order
The contract function signature and param ordering is strictly:
claimWithSignature(uint256 deadline, bytes32 nonce, bytes signature)

It must not use claimWithSignature(signature, deadline, nonce).
The signed message binds to:
 * user address (the wallet claiming)
 * nonce (unique per authorization, prevents replay)
 * deadline (unix timestamp after which the signature is invalid)
 * chainId and contract address (prevents cross-chain / cross-contract
   replay if the same signer key is ever reused)
Recommended: EIP-712 typed data rather than a raw hash, so wallets/tools
can display a readable signing/verification structure and so the
contract-side verification is standard and auditable.

2.2 Signer key
 * address public signer — set at deployment and configurable by owner via setSigner(address).
 * The constructor signature is:
   constructor(address _tysm, address _signer, address _owner)

   It has no V2 dependency.
 * The signer is a separate hot key held only by the backend, not the
   contract owner/multisig. If it's ever compromised, setSigner() lets
   the owner rotate it immediately without touching the token treasury or
   pausing the whole system unnecessarily (though pausing is also an
   option — see §6).

2.3 Deadline
Each authorization includes a deadline (e.g. issued time + 5–10
minutes). claimWithSignature reverts if block.timestamp > deadline.
This limits how long a leaked/observed signature could be replayed if
nonce tracking somehow failed, and forces users to actually go through
the backend shortly before claiming rather than stockpiling
authorizations.

2.4 Nonce / replay protection
 * mapping(bytes32 => bool) public usedAuthorizations keyed by the full
   EIP-712 digest or tracking nonces to ensure once a specific signed
   message/nonce is used, it can never be used again.
 * Mark used before the token transfer (checks-effects-interactions).

3. Fresh Start V3
V3 is a Fresh Start daily faucet for everyone. Everyone starts again at Day 1. In simple terms:
 * Every wallet starts at Day 1 the first time it makes a successful
   claim on V3. It doesn't matter how much (or how little) history that
   wallet has on V2.
 * V3 does not use V2 history for daily faucet claims. The V3 daily faucet
   does not read from V2, does not copy V2 state, does not migrate V2 users,
   and does not use oldFaucet or migrated flags. V3 does not copy lastClaim,
   streak, totalClaimed, or totalDays.
 * This avoids carrying unfair farming-inflated V2 history into the new
   system. Any wallet with V2 history gets no advantage on V3 and no
   automatic penalty either — it just starts like every other wallet, at
   Day 1.
 * V2 history is not deleted. V2 history remains on-chain and may be
   reviewed separately for future separate loyalty or bonus programs.
 * The Special Bonus Pool (TYSMSpecialBonusPool) is a separate
   contract from the V3 daily faucet and isn't affected by any of this —
   it has its own eligibility logic independent of what's described here.

4. Reward schedule
V3 keeps the exact same repeating 30-day schedule as V2 — this design is
about who can claim, not how much. Every wallet starts this
schedule from Day 1 on its first V3 claim (see §3):
 * Days 1–6: 2,000 TYSM
 * Day 7: 10,000 TYSM
 * Days 8–14: 2,000 TYSM
 * Day 15: 40,000 TYSM
 * Days 16–29: 2,000 TYSM
 * Day 30: 90,000 TYSM
 * Day 31+: resets to Day 1

5. Blocklist
 * mapping(address => bool) public blocked.
 * claimWithSignature reverts immediately if blocked[msg.sender] is
   true, regardless of signature validity — this is a contract-level
   backstop in case a bad wallet somehow obtains a valid signature.
 * Owner functions: setBlocked(address, bool) and a batch version
   setBlockedBatch(address[], bool) so known farming clusters can be
   blocked in one transaction as they're identified.

6. Pause / unpause
 * bool public paused, pause() / unpause() (owner only).
 * claimWithSignature reverts when paused.
 * Use case: emergency stop if the signer key is suspected compromised, if
   a bug is found post-launch, or during the V3 launch window.

7. Cooldown behavior
Cooldown uses only V3's own lastClaim for the calling wallet:
 * A brand new wallet has lastClaim == 0, so the cooldown check is
   trivially satisfied — a new user can claim their Day 1 reward
   immediately, as long as the backend has issued them a valid
   authorization.
 * After that first claim, lastClaim is set to the claim's
   block.timestamp, and every subsequent claim is gated by the normal
   24-hour cooldown from there.
 * V2 history is not used by the V3 daily faucet.

8. Admin functions
| Function | Purpose |
|---|---|
| setSigner(address newSigner) | Rotate the backend signing key |
| setBlocked(address user, bool isBlocked) | Block/unblock a single wallet |
| setBlockedBatch(address[] users, bool isBlocked) | Block/unblock many wallets in one tx |
| pause() / unpause() | Emergency stop / resume claiming |
| withdrawTokens(address to, uint256 amount) | Owner-controlled treasury management |
| transferOwnership(address newOwner) | Standard ownership handoff |
All state-changing admin functions emit standard events for on-chain auditability.

9. Backend responsibilities & anti-abuse requirements
The backend (serverless function issuing signatures) is where the actual
anti-abuse intelligence lives. Requirements:
 * Signer key isolation: The signer private key lives only on the backend secret store. It is never shipped to the client, never logged, and never exposed to the frontend.
 * Frontend limitations: The frontend must never sign faucet authorizations. Frontend hasShared / localStorage is only UI state, not proof of eligibility.
 * Wallet / FID association: The backend must verify wallet/FID association and confirm the requesting wallet is genuinely linked to the Farcaster account claiming to own it.
 * Verify real Farcaster share cast: The backend must verify an actual recent Farcaster share cast before signing using Neynar or another trusted Farcaster data source.
   * The cast author FID must match the requester.
   * The cast should include a marker such as #TYSMFaucet, the app URL, or @tops87sqweezz.base.eth.
   * The backend should store used cast hashes to prevent reuse.
 * Nonce management: The backend should use random nonces and either store used nonces or rely on contract nonce replay protection plus backend logs.
 * Rate limiting & blocklist: The backend should rate limit requests per FID / wallet / IP / session and use a denylist / blocklist to filter out known farming clusters.
 * Risk score strategy: Neynar User Quality Score can be used as one risk signal, but must not be the only rule. The backend must not expose risk thresholds publicly.
 * Backend JSON API response shape: When issuing authorization, the backend response payload must follow this exact order:
   {
  "deadline": 1234567890,
  "nonce": "0x...",
  "signature": "0x..."
}

10. Frontend integration
 * Before showing an active "Claim" button, the frontend requests an
   authorization from the backend API, passing the connected wallet
   address and Farcaster context.
 * Backend responds with { deadline, nonce, signature } or a friendly error.
 * The frontend must never sign faucet authorizations itself or rely on local UI state as verification.
 * Frontend executes contract call using:
   claimWithSignature(deadline, nonce, signature)

 * Error handling covers backend rejections and contract reverts (expired deadline, used nonce, blocked, paused, insufficient pool balance).

11. Fresh Start risks & user communication
 * Communication: Explain clearly that everyone starts at Day 1 on V3 to ensure a clean slate free of coordinated multi-wallet farming.
 * V2 History: State plainly that V2 history remains on-chain and may be reviewed separately for future separate loyalty/bonus review.
 * Availability: Be transparent that claim availability now depends on backend eligibility checks in addition to contract rules.

12. V2 Deprecation Options
V2 deprecation is strictly operational (stopping refills, increasing cooldown via owner controls, withdrawing remaining TYSM) to prevent further pool draining. V2 history is not used by the V3 daily faucet.

13. Security and Production Readiness
> WARNING: Before production/mainnet, replace the hand-written _recoverSigner draft logic with OpenZeppelin ECDSA/EIP712 or complete a dedicated signature verification audit.
> 

14. Test plan (Base Sepolia & Automated Suite)
The V3 test suite must explicitly cover:
 * Deployment checks
 * Fresh Start behavior
 * EIP-712 signature verification
 * Replay protection
 * Wrong signer rejection
 * Wallet binding
 * Cooldown enforcement
 * Streak reset
 * Reward schedule
 * Blocklist
 * Pause / unpause
 * Pool empty behavior
 * Owner-only controls
 * Withdraw behavior
 * View function tests
 * Direct ETH / fallback revert tests

15. Next steps
 * Finalize production-grade signature verification with OpenZeppelin ECDSA/EIP712 or equivalent audit.
 * Implement /api/claim-authorization backend.
 * Verify wallet/FID association before signing.
 * Verify real recent Farcaster share casts using Neynar or another trusted Farcaster data source.
 * Add denylist and risk controls.
 * Keep Neynar User Quality Score as one signal only, not the only rule.
 * Integrate frontend using claimWithSignature(deadline, nonce, signature).
 * Complete Base Sepolia testing.
 * Only then consider mainnet deployment.

