# TYSM Faucet V3 — Implementation README (Draft)

Status: **planning / documentation only.** No frontend or backend code
has been generated yet. Nothing here has been deployed.

This document tracks what V3 needs, at an implementation level, on top
of the contract-level design already covered in
`faucet-v3-anti-abuse-plan.md` and the draft contracts in
`contracts/`. It's meant to be a living index — new sections get added
here as each piece of V3 is planned out, before any code is written.

Related documents:
- `faucet-v3-anti-abuse-plan.md` — overall anti-abuse design, signed
  claim authorization, migration, deprecation of V2.
- `contracts/TYSMFaucetV3.draft.sol` — the draft contract itself.
- `backend/claim-authorization-notes.md` — backend-specific notes for
  the `/api/claim-authorization` endpoint (this doc links out to it
  rather than duplicating it).
- `security/suspected-farming-chickenattack.md` — the abuse pattern
  that originally motivated V3.

---

## Implementation sections

### 1. Signed claim authorization (contract-side)

Covered in full in `faucet-v3-anti-abuse-plan.md` §2 and implemented in
`TYSMFaucetV3.draft.sol`. No changes here.

### 2. Share verification before issuing claim authorization

**New requirement — added to close a gap in the current frontend.**

**Problem:** the existing share-to-unlock flow tracks `hasShared` in
frontend/localStorage state only. Since that's entirely client-side, a
user can bypass it — e.g. clear/fake local state, or simply not actually
cast, and still reach the point where the app would let them claim. The
frontend has no way to prove a share genuinely happened; it can only
prove the button was clicked.

**Rule:** the backend must independently verify that the Farcaster user
actually posted a recent TYSM share cast — via Neynar, not frontend
state — before it will ever issue a claim authorization signature.
Frontend `hasShared`/localStorage state is **not proof** and must not be
trusted for this decision.

**Flow:**

1. User taps **Share** in the mini app.
2. User publishes a Farcaster cast containing a required marker (e.g.
   `#TYSMFaucet`) and the app URL.
3. User returns to the app and taps **Claim**.
4. Frontend calls `/api/claim-authorization` with the user's wallet
   address and FID.
5. Backend checks, in order:
   - wallet/FID association (the wallet genuinely belongs to that FID)
   - denylist
   - rate limit
   - **a recent TYSM share cast exists for that FID** (new check)
6. Only if all checks pass does the backend sign and return a claim
   authorization for the contract's `claimWithSignature`.

Full backend-side detail (API checks, Neynar usage, error handling) is
in `backend/claim-authorization-notes.md` — see that file rather than
duplicating the implementation notes here.

**Frontend implication (not built yet):** if the backend rejects the
request because no qualifying share cast was found, the frontend should
show a friendly message and prompt the user to share first — full
frontend behavior/UI to be designed when frontend code is actually
generated. Placeholder wording to use for now:

> "Please share your TYSM streak before claiming."

### 3. (Future sections)

Additional implementation sections — e.g. rate limiting details, Neynar
User Quality Score integration (already outlined at a design level in
`faucet-v3-anti-abuse-plan.md` §8), frontend claim flow, migration
rollout — will be added here as each is planned out, following the same
pattern: design/notes first, code later.
