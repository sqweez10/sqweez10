# TYSM Daily Faucet V3 — Anti-Abuse Design Plan (Draft)

Status: **planning document only.** No contracts, no backend code, no frontend code have been written yet. Nothing here has been deployed, pushed, or applied to any existing file. This document exists to align on approach before any implementation begins.

---

## 1. Problem statement

`TYSMFaucetV2` (`0x43B68e86F6D6B3ED8d94c2A51015602c7338f124`) lets **any** wallet call `claim()` with no identity check beyond the 24h cooldown per address.

Because Base supports cheap smart-contract wallets / Account Abstraction, this is trivially farmable: spin up many wallets, claim 2,000 TYSM from each, forward everything to a collection address.

Observed evidence: multiple UserOperation (`HandleOps`) bundles sweeping claimed TYSM to `chickenattack.base.eth`, consistent with an automated multi-wallet farming operation rather than organic community usage.

**Goal for V3:** make unauthorized/automated multi-wallet farming impractical, without punishing existing genuine daily users any more than necessary.

---

## 2. Design approach: signed claim authorization

Move from “anyone can call `claim()`” to “only wallets holding a valid, short-lived, backend-issued signature can call `claimWithSignature()`.”

High-level flow:

```text
User opens app
  → Frontend calls backend API: "give me a claim authorization"
  → Backend checks: FID/wallet legitimacy, blocklist, rate limits
  → Backend signs an authorization with a dedicated signer key
  → Frontend calls claimWithSignature(signature, deadline, nonce)
  → Contract verifies signature, deadline, nonce, blocklist, cooldown
  → Contract pays out and marks nonce used
```

This shifts the actual anti-farming logic — FID checks, wallet clustering, rate limiting — to the backend, where it is flexible and can evolve without a redeploy. The contract’s job is to trust-but-verify a signature from a key the backend controls.

### 2.1 Signature contents

The signed message should bind to:

- `user` address — the wallet claiming
- `nonce` — unique per authorization, prevents replay
- `deadline` — unix timestamp after which the signature is invalid
- `chainId`
- `contract address`

This prevents cross-chain or cross-contract replay if the same signer key is ever reused.

Recommended: use EIP-712 typed data rather than a raw hash, so wallets and tools can display a readable signing / verification structure and contract-side verification is standard and auditable.

### 2.2 Signer key

- `address public signer` — set by `owner` via `setSigner(address)`.
- The signer is a **separate hot key held only by the backend**, not the contract owner or multisig.
- If the signer is ever compromised, `setSigner()` lets the owner rotate it immediately without touching the token treasury.
- Pausing the contract is also available as an emergency backstop.

### 2.3 Deadline

Each authorization includes a `deadline`, for example issued time + 5–10 minutes.

`claimWithSignature` reverts if:

```solidity
block.timestamp > deadline
```

This limits how long a leaked or observed signature could be replayed if nonce tracking somehow failed. It also forces users to go through the backend shortly before claiming rather than stockpiling authorizations.

### 2.4 Nonce / replay protection

Use one of these approaches:

- `mapping(bytes32 => bool) public usedAuthorizations`
- or an explicit per-user nonce system

Recommended for simplicity:

```solidity
mapping(bytes32 => bool) public usedAuthorizations;
```

The key can be the full EIP-712 digest. Once a specific signed message is used, it can never be used again.

The authorization should be marked used **before** the token transfer.

---

## 3. Reward schedule (unchanged from V2)

V3 keeps the same repeating 30-day schedule as V2. This design is about **who** can claim, not **how much**.

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

V3 should include a contract-level blocklist:

```solidity
mapping(address => bool) public blocked;
```

`claimWithSignature` should revert immediately if:

```solidity
blocked[msg.sender] == true
```

This protects the contract even if a bad wallet somehow obtains a valid signature, for example from a backend logic bug or from a wallet that is identified as farming after a signature was already issued but before it was used.

Owner functions:

```solidity
setBlocked(address user, bool isBlocked)
setBlockedBatch(address[] calldata users, bool isBlocked)
```

This allows known farming clusters, such as wallets feeding `chickenattack.base.eth`, to be blocked in one transaction as they are identified.

---

## 5. Pause / unpause

V3 should include:

```solidity
bool public paused;
```

Owner functions:

```solidity
pause()
unpause()
```

`claimWithSignature` should revert while paused.

Use cases:

- signer key suspected compromised
- bug found after launch
- emergency stop during migration
- suspicious farming pattern detected
- backend/signature system malfunction
```

Part 2/3 ต่อด้านล่างครับ:

```md
---

## 6. Migrating existing users from V2

### 6.1 Reading V2 state

V3 holds an immutable reference to the existing V2 contract and, on a user’s **first V3 interaction**, reads their V2 history read-only.

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

V3 never writes to V2.

V2 keeps operating exactly as it does today unless and until you separately decide to deprecate V2 or stop V2 refills / disable practical claiming.

> Clarification: `TYSMFaucetV2` does not have a native `pause()` function. V3 should not assume V2 is technically paused unless explicit actions are taken to disable it in practice.

### 6.2 Preserving totalDays and totalClaimed

On first claim through V3, before paying out, the contract should:

1. Check whether this address has already been migrated in V3.

```solidity
mapping(address => bool) public migrated;
```

2. If not migrated, read from V2:

```solidity
(lastClaim, streak, totalClaimed, totalDays)
```

3. Copy `totalDays` and `totalClaimed` into the user’s V3 record as starting values.
4. Set:

```solidity
migrated[user] = true;
```

5. Continue with the normal V3 claim flow.

This is a **lazy migration**. There is no need for a bulk on-chain migration transaction touching every historical address.

Users get their history carried over automatically the first time they claim via V3. A user who never returns simply never migrates, and V2 state remains untouched.

### 6.3 Cooldown behavior during migration

This is the trickiest part.

A naive migration could either:

- let a V2 user double-dip immediately, or
- unfairly force someone who claimed in V2 recently to wait a full new 24h period in V3

Recommended rule:

```text
On first migration, initialize the user’s V3 lastClaim from their V2 lastClaim.
```

Do **not** initialize `lastClaim` from `block.timestamp`.

Example:

- User claimed in V2 22 hours ago
- User migrates to V3
- V3 should still show around 2 hours of cooldown remaining

Once fully migrated, all cooldown logic going forward uses V3’s own `lastClaim`, updated on every V3 claim.

This assumes the cutover plan deprecates V2 claiming at or shortly before V3 launch. If V2 is left claimable in parallel with V3, this guarantee breaks because a user could claim in both contracts within the same day.

This is a launch dependency, not something V3’s contract logic alone can fully solve.

### 6.4 Streak continuity

`streak` should also be copied from V2 on migration.

This prevents a user mid-cycle, for example Day 12, from losing progress toward Day 15 or Day 30 simply because the contract changed.

---

## 7. V2 Deprecation Options

Because `TYSMFaucetV2` lacks a native pausing implementation, the following strategies can be used to deprecate V2 in practice.

### Option 1 — Stop refilling V2

Stop adding TYSM to the V2 contract.

Existing funds can deplete naturally, after which V2 claims will fail due to insufficient balance.

### Option 2 — Withdraw remaining tokens

If appropriate, withdraw remaining TYSM liquidity directly from the V2 contract using the owner function.

This should be communicated clearly if used.

### Option 3 — Increase V2 cooldown

Use:

```solidity
setCooldown(uint256)
```

Set a very long cooldown period to reduce or effectively stop new claims.

### Option 4 — Public pre-announcement

Announce V2 as deprecated or read-only before the V3 cutover window.

Users should know:

- when V2 stops being actively funded
- when V3 starts
- how their history is preserved
- whether they need to do anything

### Option 5 — Keep V2 state readable

V2 state remains permanently on-chain.

V3 can still read this historical state for lazy migration, even if V2 is no longer actively funded.

---

## 8. Admin functions

| Function | Purpose |
| :--- | :--- |
| `setSigner(address newSigner)` | Rotate the backend signing key |
| `setBlocked(address user, bool isBlocked)` | Block or unblock a single wallet |
| `setBlockedBatch(address[] calldata users, bool isBlocked)` | Block or unblock many wallets in one transaction |
| `pause()` / `unpause()` | Emergency stop / resume claiming |
| `withdrawTokens(address to, uint256 amount)` | Owner-controlled treasury management, rebalancing, or emergency recovery |
| `transferOwnership(address newOwner)` | Standard ownership handoff |

All state-changing admin functions should emit events:

- `SignerUpdated`
- `BlockedStatusUpdated`
- `Paused`
- `Unpaused`
- `TokensWithdrawn`
- `OwnershipTransferred`

This provides on-chain auditability.

---

## 9. Backend responsibilities

The backend / serverless function issues claim signatures.

This is where anti-abuse intelligence lives.

Responsibilities:

### 9.1 Verify Farcaster FID / wallet association

Confirm the requesting wallet is genuinely linked to the Farcaster account claiming to own it.

The backend should not issue signatures to arbitrary wallets spun up outside the intended Farcaster user flow.

### 9.2 Deny known farming wallets

Cross-check against an internal denylist.

Possible signals:

- wallets created through the same bundler / paymaster pattern
- wallets whose only activity is claiming TYSM
- wallets that sweep TYSM to a known collector
- wallets associated with `chickenattack.base.eth`

### 9.3 Issue signatures only to eligible users

The backend should only sign for:

- the connected wallet
- the verified user context
- wallets not blocked
- users passing current anti-abuse rules

### 9.4 Rate limit requests

Rate limit by:

- FID
- wallet
- IP
- session
- time window

This prevents the backend itself from being hammered.

### 9.5 Protect the signer private key

The signer private key must:

- live only in serverless secrets
- never be shipped to the client
- never be logged
- be rotatable via `setSigner()`

Treat it carefully even though it cannot directly move treasury funds.
```

Part 3/3 ต่อด้านล่างครับ:

```md
---

## 10. Frontend changes

At a high level:

1. Before showing an active Claim button, the frontend requests authorization from the backend.
2. The request includes:
   - connected wallet address
   - Farcaster context
   - any required session or identity data
3. Backend responds with either:
   - `{ signature, deadline, nonce }`
   - or an error such as `not eligible`, `rate limited`, `blocked`, or `service unavailable`
4. Frontend calls:

```solidity
claimWithSignature(signature, deadline, nonce)
```

5. Frontend handles both:
   - backend-side rejection before wallet prompt
   - contract-side revert after transaction attempt

Error cases to handle:

- expired authorization
- already used nonce / authorization
- blocked wallet
- paused contract
- insufficient pool
- backend unavailable
- user not eligible

The old direct `claim()` flow should not be used for V3.

---

## 11. Migration risks & user communication

### Risks

- Users who do not return before V2 stop-refill / deprecation may feel they lost a claim window.
- If V2 is not deprecated cleanly, users may double-claim by using both V2 and V3.
- Backend outage means users cannot claim, even if the contract is healthy.
- False positives may block genuine users.
- Users may be confused by the new eligibility/signature step.

### Communication approach

Be direct and transparent.

Explain:

- multi-wallet farming was detected
- V2 allowed anyone with many wallets to claim
- V3 is being designed to protect genuine users
- streak, `totalDays`, and `totalClaimed` will carry over automatically
- users do not need to manually migrate
- a brief eligibility check will happen before claim
- direct contract claiming will no longer be the intended flow

Suggested message:

```text
TYSM Faucet V3 is being designed to protect the pool from multi-wallet farming.

Existing loyal users will keep their history. Your streak, totalDays, and totalClaimed will carry over automatically the first time you claim on V3.

The main change is that claims will require a short eligibility check before the wallet transaction.
```

---

## 12. Open sequencing question

This plan does not itself decide when or whether to stop V2 refills / disable practical claiming.

Two options:

### Option A — Hard cutover

Stop V2 refills and launch V3 as the only actively funded faucet.

Pros:

- cleanest cooldown semantics
- closes the farming loophole faster
- easier to explain
- simpler migration logic

Cons:

- requires coordinated announcement
- users need clear timing

### Option B — Parallel period

Leave V2 open while V3 rolls out gradually.

Pros:

- softer rollout
- less abrupt for users

Cons:

- keeps the farming loophole open
- complicates migration cooldown
- allows possible V2 + V3 double-claiming
- not recommended unless there is a strong reason

### Recommendation

Hard cutover by stopping V2 refills and launching V3 as the only actively funded faucet is the simpler and safer path.

Final decision remains with the project owner.

---

## 13. Test plan (Base Sepolia)

Before any mainnet deployment:

### 13.1 Mock setup

Deploy a mock V2 faucet on Sepolia exposing the same `userInfo()` shape as mainnet `TYSMFaucetV2`.

Mock users should include:

- no V2 history
- recently claimed user
- user near Day 7
- user near Day 15
- user near Day 30
- high `totalDays` user

Deploy V3 pointed at the mock V2 and a test TYSM token.

### 13.2 Signature validity tests

- Valid signature within deadline → claim succeeds
- Expired deadline → reverts
- Reused signature / nonce → reverts on second attempt
- Signature for a different wallet than `msg.sender` → reverts
- Signature from a non-signer key → reverts
- Signature for another chain or contract → reverts

### 13.3 Blocklist tests

- Blocked address with otherwise-valid signature → reverts
- `setBlockedBatch` correctly blocks multiple addresses
- Unblocking restores eligibility if all other checks pass

### 13.4 Pause tests

- Claims revert while paused
- Claims succeed again after `unpause()`

### 13.5 Migration tests

- Existing V2 user migrates with `totalDays`, `totalClaimed`, `streak`, and `lastClaim`
- Cooldown respects V2 `lastClaim`
- Brand new user starts cleanly at Day 1
- Migrated user cannot reinitialize from V2 again after first migration

### 13.6 Reward schedule tests

- Days 1–6 pay 2,000
- Day 7 pays 10,000
- Days 8–14 pay 2,000
- Day 15 pays 40,000
- Days 16–29 pay 2,000
- Day 30 pays 90,000
- Day 31 rolls over to Day 1

### 13.7 Admin function tests

- `setSigner` only owner
- `setBlocked` only owner
- `setBlockedBatch` only owner
- `pause` / `unpause` only owner
- `withdrawTokens` only owner
- `transferOwnership` only owner

### 13.8 Insufficient pool test

Claim should revert cleanly when V3 does not hold enough TYSM for the computed reward.

No silent underpayment.

### 13.9 End-to-end dry run

Test full path:

```text
frontend → backend → signed authorization → V3 claim
```

Use Base Sepolia before mainnet.

---

## 14. Summary

V3’s core change is simple:

```text
Claiming requires a fresh, backend-issued, short-lived signature tied to a specific wallet.
```

This is backed by:

- contract-level blocklist
- pause switch
- replay protection
- backend rate limits
- Farcaster/FID verification
- lazy migration from V2

The reward schedule, loyalty history, and daily user experience should stay as close to V2 as possible.

The goal is to close the farming loophole with the least possible friction for genuine daily users.

This document is planning only.

Next steps, not started yet:

1. Contract implementation
2. Backend service implementation
3. Frontend integration
4. Sepolia test plan
5. Mainnet launch decision
```
