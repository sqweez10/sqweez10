# TYSM Faucet V3 Draft — Security Review Notes

> DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY

Self-review of `TYSMFaucetV3.draft.sol` (Fresh Start design) and
`mocks/MockTYSM.sol`, covering each area requested.

**Design note:** V3 no longer migrates or reads from V2 in any way. It
has no `oldFaucet` address, no `migrated` mapping, and no
`UserMigrated` event. Every wallet's V3 `userInfo` starts at all-zero
values, and a wallet's first successful `claimWithSignature` call is
always its Day 1 in V3, regardless of any V2 history. V2's on-chain
history remains untouched and readable directly on `TYSMFaucetV2`
itself, but the V3 daily faucet contract has no dependency on it.

---

## ✅ Signature replay protection

`usedAuthorizations[digest]` is keyed on the **full EIP-712 digest**,
which already incorporates `msg.sender`, `deadline`, and `nonce`. It's
set to `true` immediately after signature verification and before any
further state changes or the token transfer. A second submission of the
identical (sender, deadline, nonce) triple reverts with
`"Authorization already used"`. **No issue found.**

## ✅ Signature cannot be used by a different wallet

The signed struct hash includes `msg.sender` directly (not a separate
`user` parameter chosen by the caller). If wallet B submits a signature
that was issued for wallet A, the contract recomputes the digest using
`msg.sender = B`, which no longer matches what the signer actually
signed — `ecrecover` returns a different address than `signer`, and the
call reverts with `"Invalid signer"`. This also means a signature seen
in the mempool can't be front-run/stolen by copying it into a
different sender's transaction. **No issue found — this is one of the
more common signature-based-claim bugs, and it's specifically guarded
against here.**

## ✅ Deadline enforcement

Checked explicitly (`require(block.timestamp <= deadline)`) before
signature verification even happens. **No issue found.**

## ✅ Cooldown enforcement

Cooldown uses **only V3's own `lastClaim`** for the calling wallet —
there is no other source it could read from, since V2 is never
consulted. Specifically:

- A brand new wallet has `lastClaim == 0`, so
  `block.timestamp >= lastClaim + COOLDOWN` is trivially true — a new
  user can claim their Day 1 reward immediately, as long as the backend
  has issued them a valid authorization (share verification, denylist,
  rate limiting, etc. all happen backend-side before that signature is
  ever issued — see `faucet-v3-anti-abuse-plan.md` §8 and
  `backend/claim-authorization-notes.md`).
- After that first claim, `lastClaim` is set to `block.timestamp`, and
  every subsequent claim is correctly gated by the full 24h `COOLDOWN`.

**No issue found.**

## ✅ Fresh start behavior

- Every wallet's `userInfo` (`lastClaim`, `streak`, `totalClaimed`,
  `totalDays`) starts at all-zero values — there is no migration path,
  no V2 lookup, and no way for a wallet to enter V3 with any non-zero
  starting state.
- A wallet's first successful `claimWithSignature` call sets
  `streak = 1`, `totalDays = 1`, and pays `totalClaimed = 2,000 TYSM`
  (the Day 1 base reward), exactly as any other "streak reset to 1"
  claim would.
- No V2 state is read or copied anywhere in the contract — confirmed by
  the absence of any external call to a V2-shaped interface in
  `claimWithSignature` or any view function.
- **Security benefit worth calling out explicitly:** this design
  eliminates an entire class of risk that the old migration-based
  design had to manage carefully — there is no possibility of
  accidentally carrying over farming-inflated `totalDays`/`streak`
  values, or of a migration-timing edge case (V2/V3 claimed in the same
  window) creating a double-claim opportunity. Fresh Start sidesteps
  that risk entirely rather than mitigating it. **No issue found.**

## ✅ Reward schedule matching V2

`calculateReward()` returns the same four values as V2:

- 2,000 TYSM on a normal day
- 10,000 TYSM on Day 7
- 40,000 TYSM on Day 15
- 90,000 TYSM on Day 30
- Day 31 resets `streak` back to 1 (mirrors V2's
  `if (user.streak > 30) { streak = 1; }` exactly), and the cycle
  repeats from there
- `totalDays` is never reset — it keeps incrementing forever, once per
  successful claim, independent of the 30-day `streak` cycle

**No issue found.**

## ✅ Blocklist

Checked in `claimWithSignature` (reverts with `"Blocked"`), and also
reflected in the `canClaim(user)` view so a blocked wallet's UI can show
"not eligible" without needing to attempt a doomed transaction.
`setBlocked` / `setBlockedBatch` both validate against the zero address.
**No issue found.**

## ✅ Owner-only functions

`setSigner`, `setBlocked`, `setBlockedBatch`, `pause`, `unpause`,
`withdrawTokens`, and `transferOwnership` are all gated by `onlyOwner`.
Worth calling out one good property: rotating `setSigner` to a new
address **immediately invalidates** any not-yet-used signatures from the
old signer (verification checks against the *current* `signer`), which
is useful if the signing key is ever suspected compromised. **No issue
found.**

## ✅ Token transfer safety

`withdrawTokens` and the claim payout both check the contract's TYSM
balance before transferring, and both check `tysm.transfer(...)`'s
return value via `require`. State (`usedAuthorizations`, `userInfoData`,
`totalClaimsCount`, etc.) is updated **before** the external transfer
call in every path (checks-effects-interactions), and `nonReentrant` is
applied on both `claimWithSignature` and `withdrawTokens` as defense in
depth. **Assumption to confirm:** this relies on TYSM being a standard,
boolean-returning ERC20 — same assumption already used by V2 and the
Bonus Pool draft, so it should hold, but worth reconfirming against the
actual deployed token before mainnet.

## ⚠️ Backend private key safety

Not verifiable from the contract alone, since no backend code was
generated in this task (per your instructions). The contract only ever
sees the `signer` **address** (public, harmless) — the private key
never touches this code. This remains a backend implementation
responsibility to verify separately when that piece is built, per §8 of
`faucet-v3-anti-abuse-plan.md`.

## ⚠️ Share verification is outside this contract

Per the updated backend plan (`backend/claim-authorization-notes.md`),
the requirement that a user actually posted a qualifying share cast
before receiving a claim authorization is enforced entirely
**backend-side**, before the signature is ever issued. The contract has
no way to verify this itself and doesn't need to — it only ever sees the
result (a valid signature or not). This is by design, not a gap in the
contract, but worth stating plainly here since it's easy to assume
"share verification" is a contract-level guarantee when it isn't.

---

## Bugs / changes needed before any deployment

Nothing found that would cause **incorrect claim payouts, replay, or
authorization bypass** in the logic above. That said, here's what I'd
flag before mainnet — none are "the contract is broken," but all are
real:

1. **Replace the hand-rolled `_recoverSigner` with an audited library**
   (e.g. OpenZeppelin's `ECDSA` + `EIP712` base contracts) before any
   real deployment. The malleability guard and `v`/`recovered != 0`
   checks here follow the standard pattern correctly as far as I can
   verify by reading it, but hand-rolled signature-recovery code is
   exactly the kind of thing that should be swapped for a
   battle-tested implementation rather than trusted on inspection alone.
2. **Automated tests are still required.** `contract-checklist.md`
   defines what to test, but actual Foundry/Hardhat test code still
   needs to be written and run — per your instructions, I didn't
   generate backend or test-runner files, only the contracts and mocks
   themselves.
3. **Nonce uniqueness is a backend responsibility, not a contract
   guarantee.** The contract only prevents reuse of an *identical*
   (sender, deadline, nonce) digest — it has no concept of sequential or
   per-user nonce tracking. The backend must generate a fresh,
   unpredictable nonce for every authorization it issues.
4. **`setBlockedBatch` has no array size cap.** Owner-only, so not an
   attack vector, but a very large batch could hit the block gas limit.
   Worth batching sensibly off-chain rather than sending huge arrays.
5. **Backend rate limiting and share verification are required before
   launch.** Both live entirely outside this contract (see the "Share
   verification is outside this contract" note above), and neither has
   been implemented yet — the contract's anti-abuse properties
   (signature-gated claims, blocklist, pause) only work as intended if
   the backend actually enforces eligibility before ever issuing a
   signature. Confirm both are implemented and tested before real users
   get access.
6. **Mocks are test-only and must not be treated as real contracts.**
   `MockTYSM.mint` has no access control by design — correct for its
   purpose, but flagging clearly: it should never be mistaken for, or
   deployed alongside, the real TYSM token. The same applies to
   `MockFaucetV2` wherever it's still used (see the note below).

None of the above required rewriting the contract — they're the kind of
items that belong in an audit / pre-launch checklist rather than
line-level fixes to what's already there.

---

## Note: MockFaucetV2 is no longer required for V3 daily faucet tests

Since V3 no longer reads from V2 at all, `MockFaucetV2` is not needed
for any `TYSMFaucetV3` test in `contract-checklist.md`. It may still be
useful elsewhere — for example, testing the Special Bonus Pool, or a
separate future loyalty/bonus review process that looks at V2 history —
but that's decoupled from the V3 daily faucet contract covered in this
review.
