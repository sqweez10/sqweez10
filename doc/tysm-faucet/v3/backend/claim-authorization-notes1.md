# TYSM Faucet V3 — Contract Review & Testing Checklist

> DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY

This checklist is for testing `TYSMFaucetV3.draft.sol` against the mocks
in `mocks/` on Base Sepolia (or a local test network) before anything
touches mainnet.

---

## Basic setup

* [ ] Contracts compile cleanly with Solidity `^0.8.24`, no warnings.
* [ ] Deploy `MockTYSM`, mint a test supply to your test account.
* [ ] Deploy `MockFaucetV2`, use `setUserInfo(...)` to set up a few fake
  "existing V2 users" with different histories (some brand new, some
  mid-cycle, some who claimed recently, some who claimed long ago).
* [ ] Deploy `TYSMFaucetV3` with: the `MockTYSM` address, the
  `MockFaucetV2` address, a test signer address, and a test owner
  address.
* [ ] Transfer some `MockTYSM` into the deployed `TYSMFaucetV3` contract
  so it has something to pay out.

## Constructor values

* [ ] `tysm`, `oldFaucet`, `signer`, and `owner` are all set correctly
  after deployment (check each public getter).
* [ ] Deploying with a zero address for any constructor parameter fails
  as expected.
* [ ] `DOMAIN_SEPARATOR` is set and non-zero.

## Valid signature claim

* [ ] Generate a valid EIP-712 signature (off-chain, using the test
  signer's private key — **never a real key**) for a test wallet,
  with a near-future deadline and a fresh random nonce.
* [ ] Call `claimWithSignature(deadline, nonce, signature)` from that
  wallet. It should succeed and pay the expected reward.
* [ ] Confirm `ClaimedV3` and (if this was the wallet's first V3 claim)
  `UserMigrated` events were emitted with correct values.

## Expired signature

* [ ] Generate a signature with a deadline already in the past.
* [ ] Calling `claimWithSignature` with it should revert with
  `"Signature expired"`.

## Reused nonce / signature

* [ ] Successfully claim once with a given (deadline, nonce) pair.
* [ ] Attempt to call `claimWithSignature` again with the **exact same**
  deadline, nonce, and signature. It should revert with
  `"Authorization already used"`.

## Wrong signer

* [ ] Generate a signature using a private key that is **not** the
  configured `signer`.
* [ ] Calling `claimWithSignature` with it should revert with
  `"Invalid signer"`.

## Signature for another wallet

* [ ] Generate a valid signature intended for Wallet A.
* [ ] Attempt to submit that exact signature from Wallet B (i.e. Wallet B
  calls `claimWithSignature` with Wallet A's signature/nonce/deadline).
* [ ] It should revert with `"Invalid signer"` — because the digest is
  bound to `msg.sender`, submitting it from a different wallet
  changes the digest, so it no longer matches what was actually
  signed.

## Blocked wallet

* [ ] Owner calls `setBlocked(user, true)` for a test wallet.
* [ ] That wallet's `claimWithSignature` call reverts with `"Blocked"`,
  even with an otherwise fully valid signature.
* [ ] `canClaim(user)` returns `false` for a blocked wallet.
* [ ] Owner calls `setBlocked(user, false)` and the wallet can claim
  normally again (assuming otherwise eligible).
* [ ] `setBlockedBatch([...], true)` correctly blocks multiple wallets in
  one transaction; `BlockedStatusUpdated` is emitted once per wallet.

## Paused contract

* [ ] Owner calls `pause()`.
* [ ] `claimWithSignature` reverts with `"Faucet is paused"` for every
  wallet, even with valid signatures.
* [ ] `canClaim(...)` returns `false` for everyone while paused.
* [ ] Owner calls `unpause()` and claiming works again.

## Lazy migration from V2

* [ ] A wallet with existing `MockFaucetV2` history (non-zero
  lastClaim/streak/totalClaimed/totalDays) claims via V3 for the
  first time. Confirm:
  - `migrated(user)` becomes `true`.
  - V3's `userInfo(user)` afterward shows the migrated + updated
  values (not reset to zero).
  - `UserMigrated` event shows the correct copied-in values.
* [ ] A wallet with **no** V2 history (never called `setUserInfo` for it)
  migrates cleanly with all-zero starting values and claims
  normally as a "Day 1" user.
* [ ] Before migration, `userInfo(user)`, `canClaim(user)`, and
  `getTimeLeft(user)` all correctly read through to the mock V2 data
  (confirm this by checking values change if you update
  `MockFaucetV2.setUserInfo` before the wallet's first V3 claim).

## Cooldown using V2 lastClaim

* [ ] Set up a `MockFaucetV2` user whose `lastClaim` is, say, 2 hours
  ago (relative to test-network time).
* [ ] Immediately after migrating (their first V3 claim attempt), the
  claim should **fail** with `"Come back in 24 hours"` — because the
  real elapsed time since their last claim (anywhere) hasn't reached
  24h yet.
* [ ] Advance test-network time past the remaining cooldown and confirm
  the claim then succeeds.
* [ ] Separately, set up a V2 user whose `lastClaim` was more than 24h
  ago — confirm they can migrate and claim immediately.

## Reward schedule

* [ ] Simulate a wallet claiming daily and confirm rewards match exactly:
  2,000 TYSM (days 1–6, 8–14, 16–29), 10,000 (day 7), 40,000
  (day 15), 90,000 (day 30).
* [ ] Confirm that after day 30, the next successful claim resets the
  streak to 1 and pays 2,000 again (cycle repeats correctly).
* [ ] Confirm a wallet that lets more than 48 hours pass between claims
  has its streak reset to 1 (not just paused).

## Pool empty

* [ ] Drain (or don't fund) the V3 contract's TYSM balance below the
  next reward amount.
* [ ] `claimWithSignature` should revert with `"Faucet empty"` rather
  than partially paying or silently failing.

## Owner-only functions

* [ ] `setSigner`, `setBlocked`, `setBlockedBatch`, `pause`, `unpause`,
  `withdrawTokens`, and `transferOwnership` all revert with
  `"Not owner"` when called from a non-owner account.
* [ ] Each succeeds and emits its corresponding event when called by the
  actual owner.
* [ ] After `setSigner(newSigner)`, a previously-valid but not-yet-used
  signature from the **old** signer now correctly fails with
  `"Invalid signer"` (rotation immediately invalidates unused old
  authorizations — confirm this is the case).

## Withdraw tokens

* [ ] Owner can withdraw TYSM from the contract via `withdrawTokens`.
* [ ] Withdrawing more than the contract's balance reverts with
  `"Insufficient balance"`.
* [ ] Withdrawing to the zero address reverts with `"Zero address"`.
* [ ] Withdrawing a zero amount reverts with
  `"Amount must be greater than zero"`.

## Direct ETH transfer should fail

* [ ] Sending plain ETH directly to the `TYSMFaucetV3` contract address
  (no calldata) reverts with `"Direct ETH not accepted"`.
* [ ] Calling the contract with unknown calldata reverts with `"Unsupported call"`.

## View functions

* [ ] `nextReward(user)` returns the same reward that the next successful claim would actually pay.
* [ ] Check `nextReward(user)` for next streak days 1, 7, 15, 30, and after streak reset.
* [ ] `getTimeLeft(user)` returns 0 when the user is eligible.
* [ ] `getTimeLeft(user)` returns the correct remaining seconds when the user is still in cooldown.
* [ ] `faucetBalance()` matches the actual `MockTYSM` balance held by the V3 contract.

## General

* [ ] `totalClaimsCount()` increases by exactly 1 per successful claim,
  and is unaffected by failed/reverted attempts.
* [ ] Run the full suite against `MockTYSM` + `MockFaucetV2` on a local
  network first, then again on Base Sepolia, before considering any
  mainnet deployment.

---

## Do not deploy to mainnet before testnet

* [ ] All checklist items above pass on Base Sepolia.
* [ ] A real code review / audit has happened (see the separate security
  review notes for this draft).
* [ ] Replace the draft hand-written `_recoverSigner` implementation with OpenZeppelin ECDSA/EIP712 before production deployment.
* [ ] Backend signer key management, rate limiting, and denylist checks
  (per `faucet-v3-anti-abuse-plan.md`) are implemented and tested —
  these are outside this contract but required before real users
  can safely use claimWithSignature.
* [ ] Only after all of the above: consider a Base mainnet deployment,
  with the bonus pool and any remaining V2 deprecation steps handled
  per the existing project plans.

## Out of scope for this contract checklist

* [ ] Share verification is not enforced by the contract. It must be enforced by the backend before issuing a signature.
* [ ] Frontend `hasShared` / `localStorage` must not be treated as proof that a user shared.
* [ ] Backend must verify a real, recent Farcaster share cast before signing any claim authorization.
