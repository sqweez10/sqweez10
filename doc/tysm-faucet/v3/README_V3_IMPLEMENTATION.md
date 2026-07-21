# TYSM Faucet V3 — Implementation README (Draft)

Status: **planning / documentation only.** No frontend or backend code
has been generated yet. Nothing here has been deployed.

This document tracks what V3 needs, at an implementation level, on top
of the contract-level design already covered in
`faucet-v3-anti-abuse-plan.md` and the draft contracts in
`contracts/`. It's meant to be a living index — new sections get added
here as each piece of V3 is planned out, before any code is written.

Related documents:
- `faucet-v3-anti-abuse-plan.md` — overall anti-abuse design and signed
  claim authorization background.
- `contracts/TYSMFaucetV3.draft.sol` — the draft contract itself.
- `review/contract-checklist.md` — full testing checklist.
- `review/security-review-notes.md` — full security review.
- `backend/claim-authorization-notes.md` — backend-specific notes for
  the `/api/claim-authorization` endpoint (this doc links out to it
  rather than duplicating it).
- `security/suspected-farming-chickenattack.md` — the abuse pattern
  that originally motivated V3.

---

## V3 Fresh Start Design

**V3 is a clean restart for everyone.** This is the most important thing
to understand about V3, so it gets its own section up front.

In simple terms:

- Every wallet begins at **Day 1** the first time it makes a successful
  claim on V3 — it doesn't matter how much history that wallet has on
  V2.
- V3 does **not** look at V2 history to decide anything about a daily
  claim. No copying, no reading, no reference to V2 at all in the daily
  faucet contract.
- V2's history is **not deleted**. It stays exactly where it is,
  permanently readable on the V2 contract itself.
- That V2 history **may be used separately, later**, for a loyalty or
  bonus review process — but that's a different, decoupled piece of
  work, not part of the V3 daily faucet.
- **Why:** this avoids carrying any bot/farming history from V2 into V3.
  A wallet that farmed V2 gets no head start and no penalty on V3 — it
  just starts like every other wallet, at Day 1.

This replaces the earlier plan, where V3 would lazily migrate V2's
`userInfo` (copying `lastClaim`, `streak`, `totalClaimed`, and
`totalDays` into V3, and using V2's `lastClaim` for the first cooldown
check). That approach is no longer used. V3 has no migration logic, no
dependency on a V2 address, and no concept of a "migrated" wallet.

---

## Contract overview (current, Fresh Start design)

**Constructor** takes three values:
- TYSM token address
- signer address (the backend's authorization-signing key — public
  address only, never a private key)
- owner address

The constructor **no longer takes a V2 faucet address** — there's
nothing for it to point to, since V3 doesn't use V2 for anything.

**Contract state** includes:
- `tysm` — the TYSM token
- `owner`
- `signer`
- `paused`
- `userInfoData` — each wallet's own V3-only claim history
- `blocked` — the blocklist
- `usedAuthorizations` — tracks used signatures, for replay protection
- `totalClaimsCount`

**The contract no longer includes:**
- an `oldFaucet` address
- a `migrated` mapping
- a `UserMigrated` event
- any logic that reads through to V2 in a view function

---

## What V3 still requires (unchanged from the original plan)

These are all still part of V3 and haven't changed:

- `claimWithSignature` as the only way to claim
- EIP-712 signed authorization for every claim
- Signer rotation (`setSigner`) — the owner can replace the backend's
  signing key, which immediately invalidates any old unused signatures
- Deadline on every authorization (signatures expire)
- Nonce-based replay protection (a signature can only ever be used once)
- Blocklist (`setBlocked` / `setBlockedBatch`)
- Pause / unpause
- Owner-controlled token withdrawal
- Ownership transfer
- The **same reward schedule as V2**: 2,000 TYSM on a normal day, 10,000
  on Day 7, 40,000 on Day 15, 90,000 on Day 30, then the cycle repeats
- **Everyone starts at Day 1** (this is new — see the Fresh Start section
  above — but it applies to every wallet the same way, with no
  exceptions)
- A valid backend-issued signature is required for **every single
  claim** — there is no way to claim without one

---

## Test / setup notes

- V3 daily faucet tests use **`MockTYSM` only**.
- **`MockFaucetV2` is not needed** for any V3 daily faucet test, since
  the contract never calls it.
- `MockFaucetV2` may still be useful separately — for testing the
  Special Bonus Pool, or a future loyalty/bonus review process that
  looks at V2 history — but that's outside the scope of V3 daily faucet
  testing.

Full checklist: `review/contract-checklist.md`.

---

## Backend responsibilities (unchanged, still required)

The contract trusts whatever signature it receives, as long as it's
correctly formed and signed by the current `signer`. That means the
backend carries the real responsibility for deciding *who* is actually
allowed to claim. Before issuing any claim authorization, the backend
must:

- Verify wallet/FID association (the wallet genuinely belongs to the
  requesting Farcaster user)
- Check the denylist
- Rate limit requests
- Verify a real, recent Farcaster share cast exists for that user (see
  `backend/claim-authorization-notes.md` for the full flow)
- **Never trust frontend `hasShared` / localStorage** as proof of
  anything — those are UI conveniences only
- Generate a fresh, unpredictable nonce for every authorization
- Keep the signer's private key on the backend only — it must **never**
  reach the frontend, get logged, or be exposed in any client-visible
  way

## ⚠️ Important: the contract cannot enforce any of this on its own

**If the backend signs an authorization without doing these checks
properly, the contract will allow the claim.** The contract only
verifies that a signature came from the configured `signer` — it has no
way to know, or check, whether the backend actually did its job first.
All of the anti-abuse value of V3 depends on the backend enforcing
eligibility correctly, every time, before it ever signs anything.

---

## Deployment warning

**Do not deploy to mainnet until all of the following are true:**

- Contract tests pass (see `review/contract-checklist.md`)
- A full Base Sepolia test pass has been completed
- The backend's signer service and share verification are implemented
  and working (see `backend/claim-authorization-notes.md`)
- The hand-written `_recoverSigner` implementation in the contract has
  been replaced with OpenZeppelin's ECDSA/EIP-712 libraries, or has
  otherwise been independently audited

None of these are optional — skipping any of them reopens exactly the
kind of risk V3 was built to close.
