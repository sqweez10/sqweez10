# Suspected Multi-Wallet Farming — chickenattack.base.eth

Status: **documentation only.** This is an internal record of observed
on-chain activity and analysis — no code, contracts, or configuration
were changed as part of writing this file.

---

## Collector

- **ENS/Basename:** `chickenattack.base.eth`
- **Address:** `0x0b9B7C1503f3242E992C11cb25d881612a483723`

---

## Pattern observed

- Activity is initiated through **Account Abstraction / ERC-4337
  `HandleOps` bundles**, rather than ordinary EOA transactions.
- **Many distinct smart wallets** each call `claim()` on `TYSMFaucetV2`
  for the standard **2,000 TYSM** base-rate amount.
- Shortly after claiming, each wallet **forwards its claimed TYSM** to
  `chickenattack.base.eth`.
- The overall shape of this activity — many wallets, same claim amount,
  same downstream destination, bundled via Account Abstraction — is
  consistent with **coordinated multi-wallet farming**, not organic,
  independent community usage.

---

## Evidence transactions

- `0x4b1f5d4a1f13ee06df6b0a3e8988fd8cd9a29484bebda6ac6ebbd70fd5421a1c`
- `0xa5ab6bc6b2b12f6dffcb827b2cb1dab27cde8f82088c4ca14cdeac0b49d6dffe`
- `0x0c555e2347612fa00655c9fd597a9c40bb23b70768258e318432ec1e6eab480d`

*(Recorded here as the reference set discussed. Worth cross-checking each
against BaseScan directly before citing externally, to confirm they
resolve to the exact `HandleOps` → `claim()` → transfer pattern described
above.)*

---

## Conclusion

- This appears to be **sybil / multi-wallet farming**: one operator
  controlling many wallets to repeatedly claim the base daily reward.
- This is **not a contract payout bug** — `TYSMFaucetV2` paid the correct,
  expected amount to each individual wallet per the existing reward
  schedule. The issue is the *number of wallets* claiming in a
  coordinated way, not any single claim being miscalculated.
- In other words: the faucet is behaving exactly as designed at the
  per-wallet level; the abuse is happening one layer up, at the
  identity/wallet-creation level, which `TYSMFaucetV2` has no way to
  detect on its own.

---

## Recommended actions

- **Stop large V2 refills** — reduce how much fresh TYSM is available to
  be drained by this pattern while a longer-term fix is designed.
- **Deprecate V2** — using the practical options already documented in
  `faucet-v3-anti-abuse-plan.md` §11 (stop refills, consider
  `withdrawAll()`, increase `setCooldown()` drastically, announce
  deprecation) since V2 has no native `pause()` function.
- **Add blocklist to Special Bonus Pool** — so identified farming
  wallets (including any tied to this collector address) can be
  excluded from `TYSMSpecialBonusPool` claims as well, not just the
  daily faucet. (Blocklist support has already been drafted — see
  `TYSMSpecialBonusPool.draft.sol`.)
- **Add denylist checks before V3 backend issues signed claim
  authorizations** — per the V3 anti-abuse design, the backend should
  check requesting wallets (and ideally their Farcaster FID / wallet
  association) against a denylist that includes wallets observed
  forwarding funds to known collector addresses like this one, before
  ever issuing a claim signature.

---

## Related documents

- `doc/tysm-faucet/plans/faucet-v3-anti-abuse-plan.md`
- `doc/tysm-faucet/contracts/TYSMSpecialBonusPool.draft.sol`
