# TYSM Faucet V3 — Automated Testing (Draft)

> DRAFT — TEST-ONLY — NOT FOR PRODUCTION — NOT FOR MAINNET DEPLOYMENT

This is a standalone Hardhat + TypeScript project for running automated
tests against the **Fresh Start** design of `TYSMFaucetV3.draft.sol`.
It is not part of the production app or backend, and deploying anything
from this folder to a real network (mainnet or otherwise) is out of
scope — this exists purely to run tests locally and in CI.

**Reminder — Fresh Start:** V3 does not read from, write to, or depend
on V2 in any way. There is no `MockFaucetV2` anywhere in this project,
and none of the tests here need one.

---

## What's in this folder

```
doc/tysm-faucet/v3/testing/
  package.json
  hardhat.config.ts
  tsconfig.json
  .gitignore
  contracts/
    TYSMFaucetV3.draft.sol   ← copy of the draft contract under test
    MockTYSM.sol             ← copy of the mock ERC20 token
  test/
    TYSMFaucetV3.test.ts     ← the full test suite
  .github/workflows/
    test-v3.yml              ← CI workflow that runs the suite on push/PR
  README_TESTING.md          ← this file
```

### About the contract copies

The two `.sol` files under `contracts/` are **copies** of the real draft
files at:

- `doc/tysm-faucet/v3/contracts/TYSMFaucetV3.draft.sol`
- `doc/tysm-faucet/v3/contracts/mocks/MockTYSM.sol`

They were copied here so this test project is fully self-contained and
can compile/run on its own. If you update either source file later,
**copy the updated version into `testing/contracts/` again** (manually,
or with a small script) before re-running tests — this folder does not
automatically stay in sync with the source contracts.

---

## Setup

Requires Node.js and either `npm` or `pnpm`. Examples below use `pnpm`
(matching the CI workflow), but `npm install` / `npm test` work
identically.

```bash
cd doc/tysm-faucet/v3/testing
pnpm install
```

This installs Hardhat, the Hardhat Toolbox (ethers v6, chai matchers,
network helpers, etc.), and TypeScript tooling — all as dev
dependencies. Nothing here touches your production `package.json` or
`node_modules` elsewhere in the repo.

## Running the tests

```bash
pnpm test
```

This compiles the contracts and runs the full suite against Hardhat's
local in-memory network. No real network, no real funds, no real
private keys are ever involved.

To see gas usage per test:

```bash
pnpm test:gas
```

---

## Safety notes

- **No mainnet network is configured** in `hardhat.config.ts` — only the
  local Hardhat network. Don't add one here.
- **No real private keys or mnemonics** are used anywhere in this
  project. The "signer" wallet used to sign claim authorizations in
  tests is generated fresh every run via `ethers.Wallet.createRandom()`
  — it exists only in memory for the duration of the test process.
- This project does not deploy anything to a real network, and isn't
  wired up to do so. If you later want a Sepolia deployment script,
  that's a separate, explicit addition — not something this test suite
  does implicitly.

---

## What's covered

The suite in `test/TYSMFaucetV3.test.ts` covers:

1. **Deployment** — constructor getters, `DOMAIN_SEPARATOR`, zero-address
   reverts for token/signer/owner.
2. **Fresh Start** — brand new wallet starts all-zero, first claim pays
   2,000 TYSM and sets `streak`/`totalDays`/`totalClaimed`/`lastClaim`
   correctly, and confirms there's no V2-related surface on the
   contract's ABI at all.
3. **EIP-712 signature** — valid signature succeeds; expired deadline,
   reused signature, wrong signer, and a signature for one wallet used
   by another wallet all revert with the correct messages.
4. **Cooldown** — immediate second claim reverts; succeeds after 24h;
   streak resets to 1 after more than 48h.
5. **Reward schedule** — full Day 1–30 simulation with exact expected
   amounts, plus the Day 31 reset (streak back to 1, `totalDays` keeps
   counting up).
6. **Blocklist** — block/unblock a single wallet, `setBlockedBatch` for
   multiple wallets, `canClaim` reflecting blocked state.
7. **Pause** — claims blocked while paused, restored after unpause,
   `canClaim` reflecting paused state.
8. **Pool empty** — claim reverts cleanly when the contract doesn't hold
   enough MockTYSM.
9. **Owner-only functions** — every admin function reverts for
   non-owners and succeeds for the owner.
10. **Withdraw** — successful withdrawal, and reverts for zero amount,
    zero address, and over-balance withdrawal.
11. **View functions** — `canClaim`, `getTimeLeft`, `nextReward`,
    `faucetBalance`, `userInfo`, `totalClaimsCount` all checked before
    and after a claim.
12. **Direct ETH / fallback** — plain ETH transfer and unknown calldata
    both revert with the correct messages.

---

## Before any real deployment

This test suite passing is **one** prerequisite among several — see
`review/contract-checklist.md` and `review/security-review-notes.md`
for the full pre-mainnet checklist, including:

- Replacing the hand-written `_recoverSigner` with OpenZeppelin's
  ECDSA/EIP-712 libraries (or an independent review of it).
- A full Base Sepolia test pass, not just local Hardhat tests.
- Backend signer service and share-verification implementation.

Passing this suite locally does not mean the system is ready for
mainnet — see `doc/tysm-faucet/plans/faucet-v3-anti-abuse-plan.md` for
the complete rollout plan.
