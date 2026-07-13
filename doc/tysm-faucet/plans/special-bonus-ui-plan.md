# Special Loyalty Bonus Pool — Frontend Integration Plan (Draft)

Status: **planning document only**. Nothing here has been applied to
`Home.tsx` or any other existing file. This describes what a future PR
would need to do, once `TYSMSpecialBonusPool.sol` (see
`contracts/TYSMSpecialBonusPool.sol`) has been tested and deployed.

---

## 1. New environment variable

```
VITE_BONUS_CONTRACT_ADDRESS=0x...   # deployed TYSMSpecialBonusPool address on Base
```

Same pattern as however the existing faucet address is currently exposed
to the frontend — keep it consistent with that convention rather than
introducing a new config style.

---

## 2. New ABI constant

A new `BONUS_ABI` (separate from the existing faucet ABI) covering only
the functions the frontend actually needs:

**Read functions**
- `canClaimBonus(address user, uint256 milestoneDay) view returns (bool)`
- `getBonusAmount(uint256 milestoneDay) view returns (uint256)`
- `hasClaimed(address user, uint256 milestoneDay) view returns (bool)`
- `getAvailableMilestones(address user) view returns (uint256[])`
- `bonusPoolBalance() view returns (uint256)`

**Write function**
- `claimBonus(uint256 milestoneDay) payable`
  - Called with `value: parseEther("0.0000038")` using viem, or the
    equivalent raw wei value `3800000000000n`. This is the fixed support
    fee sent with the transaction — separate from normal Base network
    gas, which is paid on top as usual.

**Required import**

```ts
import { parseEther } from "viem";
```

This keeps the bonus contract's ABI fully isolated from the existing
faucet ABI — no changes needed to how the faucet is called today.

---

## 3. Suggested UI placement

- **Rewards tab** (not the primary `home` tab) — this keeps the bonus
  pool visually and functionally separate from the daily claim flow,
  consistent with the contract-level separation.
- A new, standalone **"Special Loyalty Bonus Pool" card**, placed below
  the existing Cycle 1/2/3 reward structure cards. Suggested card
  contents:
  - Title + one-line description (see wording below)
  - A list of milestone rows (Day 45, Day 60, and later Day 75/90/105/120
    once enabled), each showing amount + current state
  - A claim button per unlocked-but-unclaimed milestone

---

## 4. UI states per milestone row

| State | When it applies | Suggested treatment |
|---|---|---|
| **Locked** | `totalDays < milestoneDay` | Greyed out row, shows amount + days remaining (`totalDays` vs `milestoneDay`) |
| **Available** | `canClaimBonus()` returns `true` | Highlighted row with an active "Claim" button |
| **Claimed** | `hasClaimed()` returns `true` | Row shown with a checkmark / "Claimed" badge, button disabled |
| **Pool empty** | `bonusPoolBalance()` < milestone amount, even though otherwise eligible | Claim button disabled, show "Bonus pool refilling soon" instead of a broken transaction attempt |
| **Fee required** | Before submitting `claimBonus` | Confirmation step/modal showing the exact ETH fee (0.0000038 ETH) before the wallet prompt, so it's never a surprise |

`getAvailableMilestones(user)` is the fastest way to determine which rows
are currently "Available" without looping through every milestone
individually on the frontend.

---

## 5. Wording to reuse in the UI

Keep this consistent with the Farcaster announcement and README copy
already drafted:

- "Bonus claims are separate from the daily faucet."
- "Each milestone can be claimed once."
- "Unlocked bonuses can be claimed later — you won't lose them."
- "Support fee is separate from Base network gas."

---

## 6. Testing checklist (before merging any UI work)

- [ ] User with `totalDays < 45` cannot claim Day 45 (button stays
      disabled / `canClaimBonus` returns false)
- [ ] User with `totalDays >= 45` can claim Day 45 exactly once
- [ ] User with `totalDays >= 60` who never claimed Day 45 can still
      claim **both** Day 45 and Day 60
- [ ] A second claim attempt on an already-claimed milestone fails
      (contract reverts, UI shows "Claimed" state instead of retrying)
- [ ] Claim attempt fails gracefully when `bonusPoolBalance()` is lower
      than the milestone amount (UI shows "Pool empty", not a raw
      revert message)
- [ ] Claim attempt fails when the wallet sends less than the required
      support fee (UI should prevent this before submission, but confirm
      the contract also rejects it)
- [ ] Existing daily faucet claim flow (`Home.tsx`) is unaffected —
      streak, `totalDays`, cooldown, and claim history all behave
      exactly as before with the bonus pool deployed alongside it

---

## 7. Deployment steps (sequenced)

1. **Deploy and test on Base Sepolia first** — exercise every milestone
   and failure case above against the testnet faucet/contract pair.
   - **Note:** the real `TYSMFaucetV2` only exists on Base mainnet, so a
     bonus contract deployed on Sepolia cannot read its state directly
     across networks. For Sepolia testing, deploy a **test/mock faucet
     contract** that exposes the same `userInfo(address)` interface
     (returning `lastClaim`, `streak`, `totalClaimed`, `totalDays`), and
     point the Sepolia `TYSMSpecialBonusPool` at that mock instead. This
     lets you fully exercise eligibility logic on testnet before ever
     touching the mainnet faucet address.
2. **Verify the contract** (e.g. via Sourcify, matching the existing
   verification approach used for other contracts in this project).
3. **Fund the bonus pool** — transfer enough TYSM to
   `TYSMSpecialBonusPool` to cover the initial C2 milestones
   (Day 45 + Day 60) for the expected number of eligible users.
4. **Set the Vercel env var** — add `VITE_BONUS_CONTRACT_ADDRESS` for
   the production deployment.
5. **Build the UI in a separate branch** — keep this isolated from
   `main`/`Home.tsx` until it's fully tested, per the separation
   principle used throughout this feature.
6. **Test the Vercel preview deployment** end-to-end (including a real
   small-value claim on Sepolia or a forked mainnet) before merging.
