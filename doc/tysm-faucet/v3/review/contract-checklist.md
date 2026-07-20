# TYSM Faucet V3 — Contract Review & Testing Checklist

> DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY

This checklist is for testing `TYSMFaucetV3.draft.sol` on Base Sepolia
(or a local test network) before anything touches mainnet.

**Design note:** V3 is a **Fresh Start** faucet. It does not read from,
write to, or depend on V2 in any way — every wallet begins at Day 1 on
its first successful V3 claim, regardless of any V2 history. `MockTYSM`
is the only mock needed for these tests.

---

## Basic setup

- [ ] Contracts compile cleanly with Solidity `^0.8.24`, no warnings.
- [ ] Deploy `MockTYSM`, mint a test supply to your test account.
- [ ] Deploy `TYSMFaucetV3` with: the `MockTYSM` address, a test signer
      address, and a test owner address.
- [ ] Transfer some `MockTYSM` into the deployed `TYSMFaucetV3` contract
      so it has something to pay out.
- [ ] Do **not** deploy `MockFaucetV2` for these tests — V3's daily
      faucet has no dependency on it (see note at the bottom of this
      checklist).

## Constructor values

- [ ] `tysm`, `signer`, and `owner` are all set correctly after
      deployment (check each public getter).
- [ ] Deploying with a zero address for any constructor parameter fails
      as expected.
- [ ] `DOMAIN_SEPARATOR` is set and non-zero.

## Fresh start behavior

- [ ] A brand new wallet that has never called `claimWithSignature` has
      all-zero `userInfo` (`lastClaim`, `streak`, `totalClaimed`,
      `totalDays` all `0`) — confirm this directly via the `userInfo(address)`
      view, with no setup required.
- [ ] That wallet's first successful claim starts at **Day 1** — i.e.
      `streak` becomes `1` after the claim.
- [ ] That first claim pays exactly **2,000 TYSM**.
- [ ] After the first claim: `streak == 1`.
- [ ] After the first claim: `totalDays == 1`.
- [ ] After the first claim: `totalClaimed == 2,000 TYSM`.
- [ ] None of the above requires deploying `MockFaucetV2` or configuring
      any V2-related address — confirm the full fresh-start flow works
      with only `MockTYSM` and `TYSMFaucetV3` deployed.

## Valid signature claim

- [ ] Generate a valid EIP-712 signature (off-chain, using the test
      signer's private key — **never a real key**) for a test wallet,
      with a near-future deadline and a fresh random nonce.
- [ ] Call `claimWithSignature(deadline, nonce, signature)` from that
      wallet. It should succeed and pay the expected reward.
- [ ] Confirm the `ClaimedV3` event was emitted with the correct
      `user`, `amount`, `streak`, and `totalDays`.

## Expired signature

- [ ] Generate a signature with a deadline already in the past.
- [ ] Calling `claimWithSignature` with it should revert with
      `"Signature expired"`.

## Reused nonce / signature

- [ ] Successfully claim once with a given (deadline, nonce) pair.
- [ ] Attempt to call `claimWithSignature` again with the **exact same**
      deadline, nonce, and signature. It should revert with
      `"Authorization already used"`.

## Wrong signer

- [ ] Generate a signature using a private key that is **not** the
      configured `signer`.
- [ ] Calling `claimWithSignature` with it should revert with
      `"Invalid signer"`.

## Signature for another wallet

- [ ] Generate a valid signature intended for Wallet A.
- [ ] Attempt to submit that exact signature from Wallet B (i.e. Wallet B
      calls `claimWithSignature` with Wallet A's signature/nonce/deadline).
- [ ] It should revert with `"Invalid signer"` — because the digest is
      bound to `msg.sender`, submitting it from a different wallet
      changes the digest, so it no longer matches what was actually
      signed.

## Blocked wallet

- [ ] Owner calls `setBlocked(user, true)` for a test wallet.
- [ ] That wallet's `claimWithSignature` call reverts with `"Blocked"`,
      even with an otherwise fully valid signature.
- [ ] `canClaim(user)` returns `false` for a blocked wallet.
- [ ] Owner calls `setBlocked(user, false)` and the wallet can claim
      normally again (assuming otherwise eligible).
- [ ] `setBlockedBatch([...], true)` correctly blocks multiple wallets in
      one transaction; `BlockedStatusUpdated` is emitted once per wallet.

## Paused contract

- [ ] Owner calls `pause()`.
- [ ] `claimWithSignature` reverts with `"Faucet is paused"` for every
      wallet, even with valid signatures.
- [ ] `canClaim(...)` returns `false` for everyone while paused.
- [ ] Owner calls `unpause()` and claiming works again.

## Reward schedule

- [ ] Simulate a wallet claiming daily and confirm rewards match exactly:
      2,000 TYSM (days 1–6, 8–14, 16–29), 10,000 (day 7), 40,000
      (day 15), 90,000 (day 30).
- [ ] Confirm that after day 30, the next successful claim resets the
      streak to 1 and pays 2,000 again (cycle repeats correctly).
- [ ] Confirm a wallet that lets more than 48 hours pass between claims
      has its streak reset to 1 (not just paused).
- [ ] Confirm `totalDays` keeps increasing after day 30 even when
      `streak` resets to 1.

## Pool empty

- [ ] Drain (or don't fund) the V3 contract's TYSM balance below the
      next reward amount.
- [ ] `claimWithSignature` should revert with `"Faucet empty"` rather
      than partially paying or silently failing.

## Owner-only functions

- [ ] `setSigner`, `setBlocked`, `setBlockedBatch`, `pause`, `unpause`,
      `withdrawTokens`, and `transferOwnership` all revert with
      `"Not owner"` when called from a non-owner account.
- [ ] Each succeeds and emits its corresponding event when called by the
      actual owner.
- [ ] After `setSigner(newSigner)`, a previously-valid but not-yet-used
      signature from the **old** signer now correctly fails with
      `"Invalid signer"` (rotation immediately invalidates unused old
      authorizations — confirm this is the case).

## Withdraw tokens

- [ ] Owner can withdraw TYSM from the contract via `withdrawTokens`.
- [ ] Withdrawing more than the contract's balance reverts with
      `"Insufficient balance"`.
- [ ] Withdrawing to the zero address reverts with `"Zero address"`.
- [ ] Withdrawing a zero amount reverts with
      `"Amount must be greater than zero"`.

## Direct ETH transfer should fail

- [ ] Sending plain ETH directly to the `TYSMFaucetV3` contract address
      (no calldata, triggers `receive()`) reverts with
      `"Direct ETH not accepted"`.
- [ ] Sending ETH with calldata that doesn't match any function
      (triggers `fallback()`) reverts with `"Unsupported call"`.

## View functions

- [ ] `canClaim(user)` correctly reflects paused state, blocklist state,
      and cooldown, using only that wallet's own V3 history.
- [ ] `getTimeLeft(user)` returns `0` once eligible, and the correct
      remaining seconds otherwise.
- [ ] `nextReward(user)` correctly predicts the amount `claimWithSignature`
      will actually pay next, including streak continuation/reset.
- [ ] `faucetBalance()` matches `MockTYSM.balanceOf(address(TYSMFaucetV3))`.
- [ ] `totalClaimsCount()` increases by exactly 1 per successful claim,
      and is unaffected by failed/reverted attempts.

## General

- [ ] Run the full suite against `MockTYSM` on a local network first,
      then again on Base Sepolia, before considering any mainnet
      deployment.

---

## Note: MockFaucetV2's role going forward

`MockFaucetV2` may still be used elsewhere — for example, testing the
Special Bonus Pool, or a separate future loyalty/bonus review process
that looks at V2 history — but it is **not part of V3 daily faucet
testing**. `TYSMFaucetV3` itself has no reference to it, no constructor
parameter for it, and no test above requires deploying it.

---

## Do not deploy to mainnet before testnet

- [ ] All checklist items above pass on Base Sepolia.
- [ ] A real code review / audit has happened (see the separate security
      review notes for this draft).
- [ ] Replace the draft hand-written `_recoverSigner` implementation
      with OpenZeppelin ECDSA/EIP712 before production deployment.
- [ ] Backend signer key management, rate limiting, and denylist checks
      (per `faucet-v3-anti-abuse-plan.md`) are implemented and tested —
      these are outside this contract but required before real users
      can safely use claimWithSignature.
- [ ] Only after all of the above: consider a Base mainnet deployment,
      with the bonus pool and any remaining V2 deprecation steps handled
      per the existing project plans.
