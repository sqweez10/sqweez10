# TYSM Faucet V3 Draft — Security Review Notes

> DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY

Self-review of `TYSMFaucetV3.draft.sol`, `mocks/MockTYSM.sol`, and
`mocks/MockFaucetV2.sol`, covering each area requested.

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

Enforced via `info.lastClaim + COOLDOWN`, evaluated **after** the lazy
migration step, so a freshly-migrated wallet is checked against its real
historical `lastClaim` (from V2 if just migrated), not a reset-to-zero
value. **No issue found**, assuming the migration cutover itself happens
cleanly (see the "Depends on" note below).

## ✅ Lazy migration from V2

Runs once per wallet, copies all four V2 fields, sets `migrated[user] =
true`, and only then proceeds to the cooldown/streak/reward logic using
the freshly-copied data. Matches the design in
`faucet-v3-anti-abuse-plan.md` §6. **No issue found.**

## ✅ Reward schedule matching V2

`calculateReward()` returns the same four values as V2
(2,000 / 10,000 / 40,000 / 90,000 at the same streak positions), and the
streak-reset-after-30 logic mirrors V2's `if (user.streak > 30) { streak
= 1; }` exactly. **No issue found.**

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

## ⚠️ Backend private key safety / frontend not exposing sensitive values

Not verifiable from the contracts alone, since no backend or frontend
code was generated in this task (per your instructions). The contract
only ever sees the `signer` **address** (public, harmless) — the private
key never touches this code. This remains a backend/frontend
implementation responsibility to verify separately when those pieces are
built, per §8 of `faucet-v3-anti-abuse-plan.md`.

## ⚠️ Share verification is outside this contract

`TYSMFaucetV3` does not and cannot verify that a user actually shared a
Farcaster cast. The contract only verifies a backend-issued signature.

Therefore, share verification must happen before the backend signs the
claim authorization. The backend must not trust frontend `hasShared` or
`localStorage`; it must independently verify a real, recent qualifying
Farcaster cast via Neynar or another reliable Farcaster data source.

If the backend signs without checking the share requirement, the
contract will still allow the claim.

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
2. **No automated tests exist yet.** `contract-checklist.md` defines
   what to test, but actual Foundry/Hardhat test code still needs to be
   written and run — per your instructions, I didn't generate backend
   or test-runner files, only the contracts and mocks themselves.
3. **Nonce uniqueness is a backend responsibility, not a contract
   guarantee.** The contract only prevents reuse of an *identical*
   (sender, deadline, nonce) digest — it has no concept of sequential or
   per-user nonce tracking. The backend must generate a fresh,
   unpredictable nonce for every authorization it issues.
4. **`setBlockedBatch` has no array size cap.** Owner-only, so not an
   attack vector, but a very large batch could hit the block gas limit.
   Worth batching sensibly off-chain rather than sending huge arrays.
5. **The view functions (`canClaim`, `getTimeLeft`, `nextReward`,
   `userInfo`) all transitively depend on V2 remaining externally
   readable** for any wallet that hasn't migrated yet. This matches the
   plan (V2 state stays on-chain and readable even after deprecation),
   but it's a live dependency worth keeping in mind — if V2 were ever
   fully bricked/self-destructed (not currently planned), these views
   would start reverting for unmigrated wallets.
6. **On-chain rate limiting is intentionally absent** beyond the 24h
   cooldown — rate limiting (per FID/wallet/IP/session) is meant to live
   in the backend per the anti-abuse plan, not enforced here. Confirm
   that's actually implemented before launch; the contract alone won't
   stop a backend that's willing to issue unlimited authorizations.
7. **Both mocks have intentionally unrestricted test-only functions**
   (`MockTYSM.mint`, `MockFaucetV2.setUserInfo`) with no access control.
   This is correct for their purpose, but flagging clearly: neither mock
   should ever be mistaken for, or deployed alongside, the real
   contracts — they exist purely for the test checklist above.

None of the above required rewriting the contracts — they're the kind of
items that belong in an audit / pre-launch checklist rather than
line-level fixes to what's already there.
