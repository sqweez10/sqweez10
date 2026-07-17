# TYSM Daily Faucet V3 — Anti-Abuse Design Plan (Draft)

Status: **planning document only.** No contracts, no backend code, no frontend code have been written yet. Nothing here has been deployed, pushed, or applied to any existing file. This document exists to align on approach before any implementation begins.

---

## 1. Problem statement

`TYSMFaucetV2` (`0x43B68e86F6D6B3ED8d94c2A51015602c7338f124`) lets **any** wallet call `claim()` with no identity check beyond the 24h cooldown per address. Because Base supports cheap smart-contract wallets / Account Abstraction, this is trivially farmable: spin up many wallets, claim 2,000 TYSM from each, forward everything to a collection address.

Observed evidence: multiple UserOperation (`HandleOps`) bundles sweeping claimed TYSM to `chickenattack.base.eth`, consistent with an automated multi-wallet farming operation rather than organic community usage.

**Goal for V3:** make unauthorized/automated multi-wallet farming impractical, without punishing existing genuine daily users any more than necessary.

---

## 2. Design approach: signed claim authorization

Move from "anyone can call `claim()`" to "only wallets holding a valid, short-lived, backend-issued signature can call `claimWithSignature()`."

High-level flow:

User opens app
→ Frontend calls backend API: "give me a claim authorization"
→ Backend checks: FID/wallet legitimacy, blocklist, rate limits
→ Backend signs an authorization (wallet, deadline, nonce) with a dedicated signer key
→ Frontend calls claimWithSignature(signature, deadline, nonce)
→ Contract verifies signature, deadline, nonce, blocklist, cooldown
→ Contract pays out and marks nonce used

This shifts the actual anti-farming logic (FID checks, wallet clustering, rate limiting) to the backend, where it's flexible and can evolve without a redeploy — the contract's job is just to trust-but-verify a signature from a key the backend controls.

### 2.1 Signature contents

The signed message should bind to:

* `user` address (the wallet claiming)
* `nonce` (unique per authorization, prevents replay)
* `deadline` (unix timestamp after which the signature is invalid)
* `chainId` and `contract address` (prevents cross-chain / cross-contract replay if the same signer key is ever reused)

Recommended: EIP-712 typed data rather than a raw hash, so wallets/tools can display a readable signing/verification structure and so the contract-side verification is standard and auditable.

### 2.2 Signer key

* `address public signer` — set by `owner` via `setSigner(address)`.
* The signer is a **separate hot key held only by the backend**, not the contract owner/multisig. If it's ever compromised, `setSigner()` lets the owner rotate it immediately without touching the token treasury or pausing the whole system unnecessarily (though pausing is also an option — see §8).

### 2.3 Deadline

Each authorization includes a `deadline` (e.g. issued time + 5–10 minutes). `claimWithSignature` reverts if `block.timestamp > deadline`. This limits how long a leaked/observed signature could be replayed if nonce tracking somehow failed, and forces users to actually go through the backend shortly before claiming rather than stockpiling authorizations.

### 2.4 Nonce / replay protection

* `mapping(bytes32 => bool) public usedAuthorizations` keyed by the full EIP-712 digest (or an explicit `nonce` field per user, either works — recommend the full digest since it's simplest to reason about: once a specific signed message is used, it can never be used again).
* Mark used **before** the token transfer (checks-effects-interactions).

---

## 3. Reward schedule (unchanged from V2)

V3 keeps the exact same repeating 30-day schedule as V2 — this design is about **who** can claim, not **how much**:

| Day Period | Daily Reward |
| :--- | :--- |
| Days 1–6 | 2,000 TYSM / day |
| Day 7 | 10,000 TYSM |
| Days 8–14 | 2,000 TYSM / day |
| Day 15 | 40,000 TYSM |
| Days 16–29 | 2,000 TYSM / day |
| Day 30 | 90,000 TYSM |
| Day 31+ | Cycle repeats from Day 1 |

`calculateReward(streak)` logic can be ported over from V2 essentially unchanged.

---

## 4. Blocklist

* `mapping(address => bool) public blocked`.
* `claimWithSignature` reverts immediately if `blocked[msg.sender]` is true, regardless of signature validity — this is a contract-level backstop in case a bad wallet somehow obtains a valid signature (e.g. backend logic bug, or a wallet identified as farming *after* the signature was already issued but not yet used).
* Owner functions: `setBlocked(address, bool)` and a batch version `setBlockedBatch(address[], bool)` so known farming clusters (like wallets feeding `chickenattack.base.eth`) can be blocked in one transaction as they're identified.

---

## 5. Pause / unpause

* `bool public paused`, `pause()` / `unpause()` (owner only).
* `claimWithSignature` reverts when paused.
* Use case: emergency stop if the signer key is suspected compromised, if a bug is found post-launch, or during the V2→V3 migration cutover window to avoid double-claims across both contracts (see §7).

---

## 6. Migrating existing users from V2

### 6.1 Reading V2 state

V3 holds an immutable reference to the existing V2 contract and, on a user's **first V3 interaction**, reads their V2 history read-only:

```solidity
interface ITYSMFaucetV2 {
    function userInfo(address user) external view returns (
        uint256 lastClaim,
        uint256 streak,
        uint256 totalClaimed,
        uint256 totalDays
    );
}
```

V3 never writes to V2. V2 keeps operating exactly as it does today unless and until you decide separately to deprecate V2 or stop V2 refills / disable practical claiming (a decision this document doesn't make — see §11).

> Clarification: TYSMFaucetV2 does not possess a native pause() function. V3 should not assume V2 is technically paused unless explicit actions are taken to disable it.

### 6.2 Preserving totalDays and totalClaimed

On first claim through V3, before paying out, the contract:
* Checks if this address has already been "migrated" in V3 (`mapping(address => bool) public migrated`).
* If not migrated: reads `(lastClaim, streak, totalClaimed, totalDays)` from V2, copies `totalDays` and `totalClaimed` into the user's V3 record as starting values, and sets `migrated[user] = true`.
* Continues with the normal claim flow (signature check, cooldown, reward calculation, payout) using the now-initialized V3 record.

This is a lazy migration — no need for a bulk on-chain migration transaction touching every historical address. Users get their history carried over automatically the first time they claim via V3. A user who never returns simply never migrates, which is fine (V2 state is untouched either way).

### 6.3 Cooldown behavior during migration

This is the trickiest part to get right, because a naive migration could either let a V2 user double-dip immediately (claim in V2, then instantly claim again in V3) or unfairly force someone who claimed in V2 yesterday to wait a full new 24h period in V3 on top of what they already waited.

Recommended rule: on first migration, initialize the user's V3 `lastClaim` from their V2 `lastClaim`, not from `block.timestamp`. That means:
* If a user claimed in V2 22 hours ago, migrating to V3 and immediately trying to claim will correctly still show ~2 hours of cooldown remaining (respecting the real elapsed time since their last claim anywhere).
* Once fully migrated, all cooldown logic going forward uses V3's own `lastClaim`, updated normally on every V3 claim.

This assumes the cutover plan deprecates V2 claiming at (or shortly before) V3 launch — see §11 — so there's a clean, single source of truth for "when did this user last actually claim" at the moment of migration. If V2 is left claimable in parallel with V3 for any period, this guarantee breaks (a user could claim in both within the same day) — this is called out explicitly as a launch dependency, not something V3's contract logic alone can fully solve.

### 6.4 Streak continuity

Similarly, streak should be copied from V2 on migration so a user mid-cycle (e.g. Day 12) doesn't lose their progress toward the Day 15/30 milestones just because the contract changed underneath them.

---

## 7. V2 Deprecation Options

Because TYSMFaucetV2 lacks a native pausing implementation, the following strategies should be applied to deprecate V2 effectively:
* **Stop refilling V2:** Allow existing contract funds to deplete completely.
* **Withdraw remaining tokens:** Remove remaining TYSM liquidity directly from the V2 contract if appropriate.
* **Increase V2 cooldown:** Utilize `setCooldown(uint256)` to set a prohibitively long cooldown period, which reduces or effectively stops new claims.
* **Pre-announcement:** Publicly announce V2 as deprecated/read-only prior to the V3 cutover window.
* **State accessibility:** The V2 state remains permanently on-chain. V3 will still be capable of reading this immutable historical state for the purpose of lazy migration.

---

## 8. Admin functions

| Function | Purpose |
|---|---|
| `setSigner(address newSigner)` | Rotate the backend signing key |
| `setBlocked(address user, bool isBlocked)` | Block/unblock a single wallet |
| `setBlockedBatch(address[] users, bool isBlocked)` | Block/unblock many wallets in one tx |
| `pause() / unpause()` | Emergency stop / resume claiming |
| `withdrawTokens(address to, uint256 amount)` | Owner-controlled treasury management (e.g. rebalancing, emergency recovery) |
| `transferOwnership(address newOwner)` | Standard ownership handoff |

All state-changing admin functions should emit events (`SignerUpdated`, `BlockedStatusUpdated`, `Paused`, `Unpaused`, `TokensWithdrawn`, `OwnershipTransferred`) for on-chain auditability — mirroring the pattern already used in `TYSMSpecialBonusPool`.

---

## 9. Backend responsibilities

The backend (serverless function issuing signatures) is where the actual anti-abuse intelligence lives. Responsibilities:
* **Verify Farcaster FID / wallet association** — confirm the requesting wallet is genuinely linked to the Farcaster account claiming to own it (via the mini-app SDK context), not an arbitrary wallet spun up outside Farcaster entirely.
* **Deny known farming wallets** — cross-check against an internal list (and/or heuristics: wallets created via the same bundler/paymaster in rapid succession, wallets whose only outbound activity is a sweep to a known collector address like `chickenattack.base.eth`).
* **Issue a signature only to eligible users** — i.e. only after the above checks pass, and only for the user's own wallet address.
* **Rate limit requests** — cap how many authorization requests a given FID / IP / wallet can request per time window, independent of the on-chain cooldown, so the backend itself can't be hammered to fish for information or exhaust resources.
* **Never expose the signer private key** — key lives only in the serverless environment's secret store, never shipped to the client, never logged. Treat it with the same care as a treasury key, even though it can't directly move tokens (it can only authorize claims within the contract's own rules).

---

## 10. Frontend changes

At a high level (no code written yet, per instructions):
* Before showing an active "Claim" button, the frontend requests an authorization from the backend API, passing the connected wallet address and Farcaster context.
* Backend responds with either:
  * `{ signature, deadline, nonce }` → proceed to claim, or
  * an error (not eligible, rate limited, blocked, etc.) → show the appropriate message instead of a claim button.
* Frontend calls the new `claimWithSignature(signature, deadline, nonce)` (exact signature shape TBD in implementation) instead of the old `claim()`.
* Error handling needs to cover both backend-side rejections (shown before ever prompting a wallet transaction) and contract-side reverts (expired deadline, already used, blocked, paused, insufficient pool) — the latter should still be handled gracefully in case of a race condition (e.g. authorization expires between issuance and the user actually confirming the transaction).

---

## 11. Migration risks & user communication

### Risks:
* Users who don't return before any V2 stop refilling / deprecation could feel like they "lost" a claim window — needs clear advance communication.
* If V2 isn't deprecated cleanly at cutover via the options in §7, the lazy-migration cooldown logic in §6.3 can be gamed (claim in V2 right before cutover, then again in V3 immediately after migrating).
* **Backend outage = no one can claim**, even if the contract is healthy (this is a new single point of failure that V2 didn't have, and is the explicit tradeoff for anti-abuse capability — worth stating plainly to the community rather than glossing over it).
* False positives in backend eligibility checks could block genuine long-time users — needs an appeal/manual-override path (e.g. owner can `setBlocked(user, false)` after manual review).

### Suggested communication approach:
* Announce the anti-farming reason plainly and honestly (multi-wallet farming detected, tokens being drained to a specific address) — community members who've noticed the faucet's pool draining faster than expected will likely appreciate the transparency.
* Give a specific cutover date/time, not "coming soon."
* Reassure existing users explicitly: streak, `totalDays`, and `totalClaimed` carry over automatically the first time they claim on V3 — they don't need to do anything manually.
* Be upfront that a signature/eligibility check is now required to claim, and that legitimate users won't notice much difference day-to-day beyond a brief "checking eligibility" step before the claim button activates.

---

## 12. Open sequencing question (not resolved by this document)

This plan doesn't itself decide when/whether to stop V2 refills / disable practical claiming. Two options worth discussing before implementation:
* **Hard cutover by stopping V2 refills and launching V3 as the only actively funded faucet:** Cleanest cooldown semantics (§6.3) but requires a coordinated announcement.
* **Parallel period:** leave V2 open while V3 rolls out gradually. Simpler rollout, but reopens the exact farming loophole V3 exists to close, and complicates the migration cooldown guarantee. Not recommended unless there's a strong reason to avoid a hard cutover.

**Recommendation:** hard cutover, announced in advance, is the simpler and safer path — but this is ultimately your call as the project owner.

---

## 13. Test plan (Base Sepolia)

Before any mainnet deployment:
* Deploy a mock V2 faucet on Sepolia exposing the same `userInfo()` shape as mainnet `TYSMFaucetV2` (same pattern already used for the Special Bonus Pool testing plan), pre-populated with a few synthetic users at different streak/totalDays states.
* Deploy V3 pointed at the mock V2 and a test TYSM token.
* **Signature validity tests:**
  * Valid signature within deadline → claim succeeds.
  * Expired deadline → reverts.
  * Reused signature/nonce → reverts on second attempt.
  * Signature for a different wallet than `msg.sender` → reverts.
  * Signature from a non-signer key → reverts.
* **Blocklist tests:**
  * Blocked address with an otherwise-valid signature → reverts.
  * `setBlockedBatch` correctly blocks/unblocks multiple addresses in one call.
* **Pause tests:**
  * Claims revert while paused; succeed again after `unpause()`.
* **Migration tests:**
  * Fresh V3 user with existing V2 history: `totalDays`, `totalClaimed`, `streak`, and `lastClaim` all correctly copied on first V3 claim.
  * Migrated user's cooldown correctly reflects time since their real V2 `lastClaim`, not `block.timestamp` at migration.
  * A user with no V2 history at all (brand new) starts cleanly at Day 1 with no errors.
* **Reward schedule tests:**
  * Days 1–6, 7, 8–14, 15, 16–29, 30, and the Day 31 → Day 1 rollover all pay the correct amount, mirroring the existing V2 test coverage.
* **Admin function tests:**
  * `setSigner`, `withdrawTokens`, `transferOwnership` all correctly restricted to `onlyOwner`.
* **Insufficient pool test:**
  * Claim reverts cleanly (not a silent underpayment) when the V3 contract doesn't hold enough TYSM for the computed reward.
* **End-to-end dry run:** a small internal test with a real (test) backend issuing real signatures against Sepolia, exercising the full frontend → backend → contract path before considering mainnet.

---

## 14. Summary

V3's core change is simple to state even though the surrounding system isn't: claiming requires a fresh, backend-issued, short-lived signature tied to a specific wallet, backed by a contract-level blocklist and pause switch as backstops. The reward schedule, loyalty history, and day-to-day user experience stay as close to V2 as possible — the goal is closing the farming loophole with the least possible friction for genuine daily users.

This document is planning only. Next steps (not started): contract implementation, backend service implementation, frontend integration, and the Sepolia test plan above — in that order.
