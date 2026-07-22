# TYSM Faucet V3 — Fresh Start Anti-Abuse Plan

Status: **draft contract reviewed, GitHub Actions test suite passing, backend authorization not started, frontend integration not started, Base Sepolia testing not completed, mainnet deployment blocked.**

This document describes the anti-abuse plan for **TYSM Faucet V3 — Fresh Start**, a Farcaster / Base daily faucet mini app.

---

## 1. Problem statement

`TYSMFaucetV2` (`0x43B68e86F6D6B3ED8d94c2A51015602c7338f124`) allowed **any** wallet to call `claim()` with no identity check beyond the 24-hour cooldown per address. On Base, where smart-contract wallets and Account Abstraction are cheap to use, that made the faucet easy to farm: coordinated operators could spin up many wallets, claim 2,000 TYSM from each, and forward the proceeds to a collection address.

Observed activity showed multiple UserOperation (`HandleOps`) bundles forwarding claimed TYSM to a common collection address, which is consistent with automated multi-wallet farming rather than organic community usage.

`TYSMFaucetV2` also had no native `pause()` function. It could not be halted with a single owner call. Any plan to stop V2 activity at cutover had to work within the functions V2 actually had (`setCooldown`, `withdrawAll`, `setMilestoneRewards`, `setBaseReward`, `transferOwnership`).

This was an abuse problem, not a payout bug, and it should not be described as a hack.

---

## 2. V3 design: Fresh Start daily faucet

V3 is a **Fresh Start daily faucet**.

- Everyone starts again at Day 1.
- V3 does not migrate V2 history into the daily faucet.
- V3 does not read V2.
- V3 does not use `oldFaucet`.
- V3 does not use `migrated`.
- V3 does not copy `lastClaim`, `streak`, `totalClaimed`, or `totalDays` from V2.
- V2 history remains on-chain and may be reviewed separately later for loyalty or bonus programs.
- The Special Bonus Pool is separate from the V3 daily faucet.

Fresh Start is deliberate: it avoids carrying farming-inflated V2 history into the new system and gives the faucet a clean, trustable baseline.

---

## 3. Contract design

The V3 constructor is:

```solidity
constructor(address _tysm, address _signer, address _owner)
```

The claim function is:

```solidity
claimWithSignature(deadline, nonce, signature)
```

Do not use this order:

```solidity
claimWithSignature(signature, deadline, nonce)
```

The contract should verify a backend-issued signature, enforce replay protection, enforce cooldown, honor the blocklist, and respect pause / unpause state.

### Reward schedule

```text
Days 1–6: 2,000 TYSM
Day 7: 10,000 TYSM
Day 15: 40,000 TYSM
Day 30: 90,000 TYSM
Day 31+: resets to Day 1
```

The daily reward schedule is intentionally simple and predictable. The anti-abuse changes are about **who** can claim, not about changing the reward curve.

---

## 4. Backend authorization response

The backend endpoint should be:

```text
/api/claim-authorization
```

The backend should return authorization data in this order:

```json
{
  "deadline": 1234567890,
  "nonce": "0x...",
  "signature": "0x..."
}
```

Do not use this order:

```json
{
  "signature": "0x...",
  "deadline": 1234567890,
  "nonce": "0x..."
}
```

The frontend should pass the response directly into `claimWithSignature(deadline, nonce, signature)`.

---

## 5. Backend anti-abuse requirements

The backend is where the real anti-abuse logic lives. It must:

- Keep the signer private key only on the backend.
- Never let the frontend sign faucet authorizations.
- Treat frontend `hasShared` / `localStorage` as UI state only, not proof.
- Verify a real Farcaster cast before signing.
- Ensure the cast author FID matches the requester.
- Require the cast to include a marker such as `#TYSMFaucet`, the app URL, or `@tops87sqweezz.base.eth`.
- Store used cast hashes to prevent reuse.
- Use random nonces.
- Store used nonces, or rely on contract nonce replay protection plus backend logs.
- Rate limit requests.
- Use a denylist / blocklist.
- Verify wallet/FID association.
- Avoid publicly exposing risk thresholds.
- Allow Neynar User Quality Score as one signal, but never as the only rule.

The backend may use multiple signals together: verified Farcaster identity, wallet/FID association, recent real cast, denylist hits, known farming patterns, rate limits, and account quality signals.

### Backend trust boundary

The contract cannot verify whether the backend actually checked everything correctly. It can only verify that a signature came from the configured signer. That means the backend must be correct every time before it signs anything.

### Neynar User Quality Score

Neynar User Quality Score can help as one input, but it must not become a single pass/fail gate. It should be combined with the other anti-abuse signals above.

If a user is rejected, the UI should use a simple message like:

> Claim eligibility could not be verified right now. Please try again later or contact support.

---

## 6. Safe wording

When describing the V2 issue, use terms like:

```text
coordinated multi-wallet farming
smart-wallet farming
unfair farming
abuse
```

Avoid terms like:

```text
stolen
thief
scammer
hack
```

The right framing matters: this was abusive usage of an open faucet design, not a contract payout exploit.

---

## 7. Contract behaviors to test and enforce

The V3 contract should support and enforce:

- Deployment checks
- Fresh Start behavior
- EIP-712 signature verification
- Replay protection
- Wrong signer rejection
- Wallet binding
- Cooldown enforcement
- Streak reset
- Reward schedule
- Blocklist
- Pause / unpause
- Pool empty behavior
- Owner-only controls
- Withdraw behavior
- View function tests
- Direct ETH / fallback revert tests

### Additional contract rules

The contract should:

- Reject direct ETH transfers.
- Revert on unknown calldata via fallback / receive handling.
- Keep `userInfo`, `canClaim`, `getTimeLeft`, `nextReward`, `faucetBalance`, and `totalClaimsCount` consistent with the latest design.

---

## 8. Production readiness warning

Before production/mainnet, replace the hand-written `_recoverSigner` draft logic with OpenZeppelin `ECDSA` / `EIP712` or complete a dedicated signature verification audit.

Hand-written signature verification should not be trusted just because it looks correct on inspection.

---

## 9. Current status

Current project status:

```text
draft contract reviewed, GitHub Actions test suite passing, backend authorization not started, frontend integration not started, Base Sepolia testing not completed, mainnet deployment blocked.
```

This means the contract direction is understood, the GitHub Actions compile and test suite is green, but the production-backed authorization layer still needs to be built and validated.

---

## 10. Next steps

1. Finalize production-grade signature verification with OpenZeppelin ECDSA/EIP712 or equivalent audit.
2. Implement `/api/claim-authorization` backend.
3. Verify wallet/FID association before signing.
4. Verify real recent Farcaster share casts using Neynar or another trusted Farcaster data source.
5. Add denylist and risk controls.
6. Keep Neynar User Quality Score as one signal only, not the only rule.
7. Integrate frontend using `claimWithSignature(deadline, nonce, signature)`.
8. Complete Base Sepolia testing.
9. Only then consider mainnet deployment.

---

## 11. Frontend flow

The frontend should request authorization from the backend before enabling an active Claim button.

A typical flow is:

1. User opens the app.
2. Frontend sends the connected wallet address and Farcaster context to `/api/claim-authorization`.
3. Backend checks eligibility and either returns `{ deadline, nonce, signature }` or returns an error.
4. Frontend passes the response to `claimWithSignature(deadline, nonce, signature)`.
5. Contract verifies the signature, deadline, nonce, blocklist, and cooldown.
6. Claim succeeds or reverts safely.

Frontend `hasShared` can help the interface feel responsive, but it is not proof of a real share and must not be used as the final eligibility check.

---

## 12. Risk communication

Fresh Start may surprise some genuine V2 users who expect their prior streak to carry over. That needs to be communicated clearly.

The project should be upfront that:

- V2 history remains on-chain.
- V2 history is not used by the V3 daily faucet.
- V3 starts fresh for everyone.
- The backend eligibility check is now part of the claim flow.
- A brief “checking eligibility” step is expected before the claim button activates.

That is a tradeoff for making the faucet much harder to farm.

---

## 13. V2 deprecation notes

`TYSMFaucetV2` did not have a `pause()` function, so pausing it directly was never an option.

The practical ways to deprecate V2 were:

- Stop refilling V2.
- Do not refill V2 after deprecation.
- Withdraw remaining TYSM from V2, if appropriate.
- Increase V2’s cooldown to make it effectively unusable.
- Announce V2 as deprecated / read-only before cutover.

V2 state remains readable on-chain, even after deprecation. That history may still be relevant for future separate loyalty or bonus review.

---

## 14. Summary

TYSM Faucet V3 — Fresh Start replaces the old open claim model with a backend-issued, short-lived signature flow tied to a specific wallet and protected by replay checks, blocklist controls, and cooldown enforcement.

The key design choice is simple: **everyone starts at Day 1, and V2 history does not carry into the daily faucet.** That removes the migration problem, reduces abuse risk, and keeps the faucet focused on fair daily participation rather than inherited historical state.
