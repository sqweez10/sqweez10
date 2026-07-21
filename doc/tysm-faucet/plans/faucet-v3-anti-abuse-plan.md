# TYSM Daily Faucet V3 — Anti-Abuse Design Plan (Draft)

Status: **planning document only.** No contracts, no backend code, no
frontend code have been written yet. Nothing here has been deployed,
pushed, or applied to any existing file. This document exists to align on
approach before any implementation begins.

---

## 1. Problem statement

`TYSMFaucetV2` (`0x43B68e86F6D6B3ED8d94c2A51015602c7338f124`) lets **any**
wallet call `claim()` with no identity check beyond the 24h cooldown per
address. Because Base supports cheap smart-contract wallets / Account
Abstraction, this is trivially farmable: spin up many wallets, claim
2,000 TYSM from each, forward everything to a collection address.

Observed evidence: multiple UserOperation (`HandleOps`) bundles sweeping
claimed TYSM to `chickenattack.base.eth`, consistent with an automated
multi-wallet farming operation rather than organic community usage.

**Important constraint:** `TYSMFaucetV2` has no native `pause()`
function. It cannot be halted with a single owner call. Any plan to stop
V2 activity at cutover has to work within the functions V2 actually has
(`setCooldown`, `withdrawAll`, `setMilestoneRewards`, `setBaseReward`,
`transferOwnership`) — see §11 "V2 Deprecation Options" below.

**Goal for V3:** make unauthorized/automated multi-wallet farming
impractical, without punishing existing genuine daily users any more than
necessary.

---

## 2. Design approach: signed claim authorization

Move from "anyone can call `claim()`" to "only wallets holding a valid,
short-lived, backend-issued signature can call `claimWithSignature()`."

High-level flow:

```
User opens app
   → Frontend calls backend API: "give me a claim authorization"
   → Backend checks: FID/wallet legitimacy, blocklist, rate limits,
     recent share cast (see §7 and §8)
   → Backend signs an authorization (wallet, deadline, nonce) with a
     dedicated signer key
   → Frontend calls claimWithSignature(signature, deadline, nonce)
   → Contract verifies signature, deadline, nonce, blocklist, cooldown
   → Contract pays out and marks nonce used
```

This shifts the actual anti-farming logic (FID checks, wallet clustering,
rate limiting, share verification) to the backend, where it's flexible
and can evolve without a redeploy — the contract's job is just to
trust-but-verify a signature from a key the backend controls.

### 2.1 Signature contents

The signed message should bind to:

- `user` address (the wallet claiming)
- `nonce` (unique per authorization, prevents replay)
- `deadline` (unix timestamp after which the signature is invalid)
- `chainId` and `contract address` (prevents cross-chain / cross-contract
  replay if the same signer key is ever reused)

Recommended: EIP-712 typed data rather than a raw hash, so wallets/tools
can display a readable signing/verification structure and so the
contract-side verification is standard and auditable.

### 2.2 Signer key

- `address public signer` — set by `owner` via `setSigner(address)`.
- The signer is a **separate hot key held only by the backend**, not the
  contract owner/multisig. If it's ever compromised, `setSigner()` lets
  the owner rotate it immediately without touching the token treasury or
  pausing the whole system unnecessarily (though pausing is also an
  option — see §5).

### 2.3 Deadline

Each authorization includes a `deadline` (e.g. issued time + 5–10
minutes). `claimWithSignature` reverts if `block.timestamp > deadline`.
This limits how long a leaked/observed signature could be replayed if
nonce tracking somehow failed, and forces users to actually go through
the backend shortly before claiming rather than stockpiling
authorizations.

### 2.4 Nonce / replay protection

- `mapping(bytes32 => bool) public usedAuthorizations` keyed by the full
  EIP-712 digest (or an explicit `nonce` field per user, either works —
  recommend the full digest since it's simplest to reason about: once a
  specific signed message is used, it can never be used again).
- Mark used **before** the token transfer (checks-effects-interactions).

---

## 3. Fresh Start V3

**V3 is a clean restart for everyone.** This replaces the earlier plan
of lazily migrating V2 history into V3 — that approach is no longer
used. In simple terms:

- Every wallet starts at **Day 1** the first time it makes a successful
  claim on V3. It doesn't matter how much (or how little) history that
  wallet has on V2.
- **V3 does not use V2 history for daily faucet claims.** The contract
  never reads from V2, never writes to V2, and has no address pointing
  at V2 anywhere in it.
- **This avoids carrying farming-inflated V2 history into the new
  system.** A wallet that farmed V2 heavily gets no advantage on V3 and
  no penalty either — it just starts like every other wallet, at Day 1.
  This sidesteps an entire category of risk the old migration-based
  design would have had to manage carefully (e.g. a migration-timing
  edge case around cutover creating a double-claim opportunity — that
  risk simply doesn't exist here).
- **V2 history is not deleted.** It stays exactly where it is, on the V2
  contract, permanently readable.
- **V2 history may be used separately, later**, for a loyalty or bonus
  review process — but that's a different, decoupled piece of work, not
  part of the V3 daily faucet described in this document.
- The **Special Bonus Pool** (`TYSMSpecialBonusPool`) is a separate
  contract from the V3 daily faucet and isn't affected by any of this —
  it has its own eligibility logic independent of what's described here.

---

## 4. Reward schedule

V3 keeps the exact same repeating 30-day schedule as V2 — this design is
about **who** can claim, not **how much**. The only difference from V2
is that **every wallet starts this schedule from Day 1** on its first V3
claim (see §3):

| Day Period | Daily Reward |
|---|---|
| Days 1–6 | 2,000 TYSM / day |
| Day 7 | 10,000 TYSM |
| Days 8–14 | 2,000 TYSM / day |
| Day 15 | 40,000 TYSM |
| Days 16–29 | 2,000 TYSM / day |
| Day 30 | 90,000 TYSM |
| Day 31+ | Cycle repeats from Day 1 |

`calculateReward(streak)` logic can be ported over from V2 essentially
unchanged.

---

## 5. Blocklist

- `mapping(address => bool) public blocked`.
- `claimWithSignature` reverts immediately if `blocked[msg.sender]` is
  true, regardless of signature validity — this is a contract-level
  backstop in case a bad wallet somehow obtains a valid signature (e.g.
  backend logic bug, or a wallet identified as farming *after* the
  signature was already issued but not yet used).
- Owner functions: `setBlocked(address, bool)` and a batch version
  `setBlockedBatch(address[], bool)` so known farming clusters (like
  wallets feeding `chickenattack.base.eth`) can be blocked in one
  transaction as they're identified.

---

## 6. Pause / unpause

- `bool public paused`, `pause()` / `unpause()` (owner only).
- `claimWithSignature` reverts when paused.
- Use case: emergency stop if the signer key is suspected compromised, if
  a bug is found post-launch, or during the V2→V3 launch window (see §11
  and §12).

---

## 7. Cooldown behavior

Cooldown uses **only V3's own `lastClaim`** for the calling wallet —
there's no other source it could use, since V2 is never consulted:

- A brand new wallet has `lastClaim == 0`, so the cooldown check is
  trivially satisfied — a new user can claim their Day 1 reward
  immediately, as long as the backend has issued them a valid
  authorization (see §8 and §9 for what the backend checks first).
- After that first claim, `lastClaim` is set to the claim's
  `block.timestamp`, and every subsequent claim is gated by the normal
  24-hour cooldown from there.
- There is no V2 `lastClaim` involved at any point — nothing here reads
  from or depends on V2's state.

---

## 8. Admin functions

| Function | Purpose |
|---|---|
| `setSigner(address newSigner)` | Rotate the backend signing key |
| `setBlocked(address user, bool isBlocked)` | Block/unblock a single wallet |
| `setBlockedBatch(address[] users, bool isBlocked)` | Block/unblock many wallets in one tx |
| `pause()` / `unpause()` | Emergency stop / resume claiming |
| `withdrawTokens(address to, uint256 amount)` | Owner-controlled treasury management (e.g. rebalancing, emergency recovery) |
| `transferOwnership(address newOwner)` | Standard ownership handoff |

All state-changing admin functions should emit events
(`SignerUpdated`, `BlockedStatusUpdated`, `Paused`, `Unpaused`,
`TokensWithdrawn`, `OwnershipTransferred`) for on-chain auditability —
mirroring the pattern already used in `TYSMSpecialBonusPool`.

---

## 9. Backend responsibilities

The backend (serverless function issuing signatures) is where the actual
anti-abuse intelligence lives. Responsibilities:

1. **Verify Farcaster FID / wallet association** — confirm the requesting
   wallet is genuinely linked to the Farcaster account claiming to own
   it (via the mini-app SDK context), not an arbitrary wallet spun up
   outside Farcaster entirely.
2. **Check the denylist** — cross-check against a known-bad list
   (and/or heuristics: wallets created via the same bundler/paymaster in
   rapid succession, wallets whose only outbound activity is a sweep to
   a known collector address like `chickenattack.base.eth`).
3. **Rate limit requests** — cap how many authorization requests a given
   FID / IP / wallet can request per time window, independent of the
   on-chain cooldown, so the backend itself can't be hammered to fish for
   information or exhaust resources.
4. **Verify a real, recent Farcaster share cast exists before signing**
   — the backend must independently confirm (via Neynar) that the user
   actually posted a qualifying share cast recently. Full detail on this
   check lives in `backend/claim-authorization-notes.md`; the key point
   for this plan is that it's a required check before any signature is
   issued.
5. **Never trust frontend `hasShared` or `localStorage`** as proof of
   anything. Those are client-side UI conveniences only — trivially
   bypassable — and must never be treated as the actual source of truth
   for whether a share happened.
6. **Generate a fresh, unpredictable nonce** for every authorization
   issued — never reuse or predictably derive a nonce.
7. **Issue a signature only to eligible users** — i.e. only after all of
   the above checks pass, and only for the user's *own* wallet address.
8. **Keep the signer private key backend-only** — it lives only in the
   serverless environment's secret store, never shipped to the client,
   never logged, and never reaches the frontend in any form. Treat it
   with the same care as a treasury key, even though it can't directly
   move tokens (it can only authorize claims within the contract's own
   rules).

### ⚠️ The contract cannot enforce any of this on its own

**If the backend signs an authorization without doing these checks
properly, the contract will allow the claim.** The contract's only job
is to verify that a signature came from the currently-configured
`signer` — it has no way to know, or check, whether the backend actually
did its job first. All of V3's anti-abuse value depends on the backend
enforcing eligibility correctly, every single time, before it ever signs
anything.

### Neynar User Quality Score

- The backend may use **Neynar User Quality Score** as one anti-abuse
  signal among several, when deciding whether to issue a claim
  authorization.
- This score should **not be the only eligibility rule**. It should be
  combined with:
  - verified Farcaster FID
  - wallet/FID association
  - blocklist / denylist
  - known farming collector addresses
  - repeated HandleOps or smart-wallet farming patterns
  - rate limits per FID / wallet / IP / session
  - account age and other quality signals where available
- The backend should **not publicly disclose a fixed score threshold**,
  because attackers may optimize around a known cutoff.
- If a user is rejected due to risk checks, the frontend should show a
  simple, non-judgmental message rather than exposing the specific
  reason:
  > "Claim eligibility could not be verified right now. Please try again
  > later or contact support."
- Neynar score should be treated as **a risk signal, not a final
  judgment on the user** — it feeds into the overall decision alongside
  the other checks above, rather than being a standalone pass/fail gate.

---

## 10. Frontend changes

At a high level (no code written yet, per instructions):

1. Before showing an active "Claim" button, the frontend requests an
   authorization from the backend API, passing the connected wallet
   address and Farcaster context.
2. Backend responds with either:
   - `{ signature, deadline, nonce }` → proceed to claim, or
   - an error (`not eligible`, `rate limited`, `blocked`, `share not
     found`, etc.) → show the appropriate friendly rejection message
     instead of a claim button (e.g. "Please share your TYSM streak
     before claiming.").
3. The frontend should **never treat its own `hasShared` state as
   proof** that a share happened — it's only used for local UI/UX (e.g.
   graying out the Claim button before the user has tapped Share), never
   as the actual eligibility source of truth. That determination always
   comes from the backend's real check against Farcaster.
4. Frontend calls `claimWithSignature(signature, deadline, nonce)`
   (exact signature shape TBD in implementation) instead of the old
   `claim()`.
5. Error handling needs to cover both **backend-side** rejections (shown
   before ever prompting a wallet transaction) and **contract-side**
   reverts (expired deadline, already used, blocked, paused, insufficient
   pool) — the latter should still be handled gracefully in case of a
   race condition (e.g. authorization expires between issuance and the
   user actually confirming the transaction).

---

## 11. Fresh Start risks & user communication

**Risks:**

- Some real, genuine V2 users may feel like they **lost their
  streak/history** when they see V3 start them back at Day 1 — this
  needs clear, upfront communication rather than letting people discover
  it on their own.
- Backend outage = no one can claim, even if the contract is healthy
  (this is a new single point of failure that V2 didn't have, and is the
  explicit tradeoff for anti-abuse capability — worth stating plainly to
  the community rather than glossing over it).
- False positives in backend eligibility checks could block genuine
  long-time users — needs an appeal/manual-override path (e.g. owner can
  `setBlocked(user, false)` after manual review).

**Suggested communication approach (consistent with the tone used in the
earlier Farcaster/README drafts for this project):**

- Announce the anti-farming reason plainly and honestly (multi-wallet
  farming detected, tokens being drained to a specific address) —
  community members who've noticed the faucet's pool draining faster
  than expected will likely appreciate the transparency.
- **Explain that V2 was effectively drained by the farming activity and
  will not be refilled** — it isn't being taken away from honest users
  arbitrarily; the pool itself is the casualty of the abuse described in
  §1.
- **Explain that V2's on-chain history remains readable and isn't
  deleted**, and may be reviewed separately in the future for loyalty or
  bonus consideration — even though it isn't used by the V3 daily faucet
  itself.
- **Explain why Fresh Start was chosen**: starting everyone at Day 1
  avoids carrying any bot/farming-inflated history from V2 into the new
  system, which is a simpler and more trustworthy foundation than trying
  to sort "real" history from "farmed" history on a case-by-case basis.
- Give a specific cutover date/time, not "coming soon."
- Be upfront that a signature/eligibility check (including a share
  requirement) is now required to claim, and that legitimate users won't
  notice much difference day-to-day beyond a brief "checking eligibility"
  step before the claim button activates.

---

## 12. V2 Deprecation Options

`TYSMFaucetV2` was not built with a `pause()` function, so "pausing V2"
isn't literally available. The realistic options, using only functions
V2 actually has, are:

- **Stop refilling V2.** Simplest lever: once its TYSM balance runs out,
  `claim()` calls start reverting on the `"Faucet empty!"` check
  naturally. No owner action required beyond just not sending it more
  tokens — but this only takes effect once the existing balance is fully
  drained, which could take a while depending on current pool size.
- **Withdraw remaining TYSM from V2, if appropriate**, via
  `withdrawAll()` (owner-only). This makes V2 empty immediately rather
  than waiting for organic drain, making it non-functional for claims
  right away. Consider whether any legitimate users mid-cycle should be
  given notice first.
- **Increase V2's cooldown** via `setCooldown(uint256)` (owner-only) to
  an impractically large value (e.g. years). This doesn't stop `claim()`
  from being *callable*, but makes it practically useless — anyone who
  has just claimed won't be able to claim again in any realistic
  timeframe. This is the closest V2 gets to a "pause," without an actual
  pause function.
- **Announce V2 as deprecated/read-only** before the V3 cutover, so
  users know to move to V3 and aren't caught off guard when claims stop
  working or amounts go to zero.

Combining "stop refilling" + "increase cooldown drastically" + "announce
deprecation" gives the closest practical equivalent to pausing V2,
without needing to modify or redeploy the V2 contract itself.

**Important:** V2's on-chain state (`userInfo` for every address) is
**not affected** by any of the above and remains permanently readable —
useful if a future loyalty/bonus review (§3) wants to look at it, even
though the V3 daily faucet itself never reads it.

> **Note:** since V3 has no dependency on V2 being deprecated (unlike
> the old migration-based design, where a clean cutover mattered for
> cooldown correctness — see the removed §6.3 in the prior version of
> this document), V2 deprecation timing is now purely about **stopping
> further draining of V2's pool and communicating clearly to users**, not
> a technical prerequisite for V3 to function correctly.

---

## 13. Open sequencing question (not resolved by this document)

This plan doesn't itself decide exactly when/how to deprecate V2 (see
§12 for the mechanics). Two sequencing options worth discussing before
implementation:

- **Hard cutover by stopping V2 refills and launching V3 as the only
  actively funded faucet** — ideally paired with the cooldown-increase
  and deprecation announcement from §12 so V2 becomes impractical to
  claim from immediately, not just eventually. Launch V3 immediately
  after.
- **Parallel period:** leave V2 funded and claimable while V3 rolls out
  gradually. Simpler rollout, but reopens the exact farming loophole V3
  exists to close. Not recommended unless there's a strong reason to
  avoid a hard cutover.

Recommendation: the hard cutover approach, announced in advance, is the
simpler and safer path — but this is ultimately your call as the project
owner.

---

## 14. Test plan (Base Sepolia)

Before any mainnet deployment:

1. **Deploy `MockTYSM` only** for V3 daily faucet tests. `MockFaucetV2`
   is **not** used here — V3 has no dependency on it. (`MockFaucetV2`
   may still be useful separately for Special Bonus Pool or future
   loyalty/bonus review testing, but that's outside this test plan.)
2. **Deploy V3** pointed at the test TYSM token, a test signer, and a
   test owner.
3. **Fresh Start behavior tests:**
   - A brand new wallet's `userInfo` starts at all-zero values before
     any claim.
   - That wallet's first successful claim is Day 1 (`streak == 1`).
   - That first claim pays exactly 2,000 TYSM.
   - After the first claim, `totalDays == 1`.
4. **Signature validity tests:**
   - Valid signature within deadline → claim succeeds.
   - Expired deadline → reverts.
   - Reused signature/nonce → reverts on second attempt.
   - Signature for a different wallet than `msg.sender` → reverts.
   - Signature from a non-`signer` key → reverts.
5. **Blocklist tests:**
   - Blocked address with an otherwise-valid signature → reverts.
   - `setBlockedBatch` correctly blocks/unblocks multiple addresses in
     one call.
6. **Pause tests:**
   - Claims revert while paused; succeed again after `unpause()`.
7. **Reward schedule tests:**
   - Days 1–6, 7, 8–14, 15, 16–29, 30, and the Day 31 → Day 1 rollover
     all pay the correct amount, mirroring the existing V2 test
     coverage.
   - `totalDays` keeps increasing after Day 30 even as `streak` resets.
8. **Admin function tests:**
   - `setSigner`, `withdrawTokens`, `transferOwnership` all correctly
     restricted to `onlyOwner`.
9. **Insufficient pool test:**
   - Claim reverts cleanly (not a silent underpayment) when the V3
     contract doesn't hold enough TYSM for the computed reward.
10. **Backend end-to-end dry run:** a small internal test with a real
    (test) backend issuing real signatures against Sepolia — including
    exercising the share-verification check — exercising the full
    frontend → backend → contract path before considering mainnet.

---

## 15. Summary

V3's core change is simple to state even though the surrounding system
isn't: **claiming requires a fresh, backend-issued, short-lived signature
tied to a specific wallet, and V3 starts fresh for all users.** Every
wallet begins at Day 1 on its first successful claim — V2 history
remains on-chain but is not used by the V3 daily faucet. This is backed
by a contract-level blocklist and pause switch as backstops, while the
Fresh Start approach itself removes an entire category of migration risk
by design rather than mitigating it after the fact.

This document is planning only. Next steps (not started): contract
implementation, backend service implementation, frontend integration,
and the Sepolia test plan above — in that order.
