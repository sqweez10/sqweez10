# Suspected Multi-Wallet Farming — chickenattack.base.eth

## Suspected collector

- Name: chickenattack.base.eth
- Address: 0x0b9B7C1503f3242E992C11cb25d881612a483723

## Pattern

Multiple Account Abstraction / Handle Ops bundles used many smart wallets to claim 2,000 TYSM each from the TYSM Daily Faucet, then forward the tokens to chickenattack.base.eth.

## Evidence transactions

- 0x4b1f5d4a1f13ee06df6b0a3e8988fd8cd9a29484bebda6ac6ebbd70fd5421a1c
  - Faucet sent 50,000 TYSM
  - chickenattack.base.eth received 50,000 TYSM

- 0xa5ab6bc6b2b12f6dffcb827b2cb1dab27cde8f82088c4ca14cdeac0b49d6dffe
  - Account Abstraction bundle
  - Similar pattern

- 0x0c555e2347612fa00655c9fd597a9c40bb23b70768258e318432ec1e6eab480d
  - Faucet sent 40,000 TYSM
  - chickenattack.base.eth received 40,000 TYSM

 ## Notes

This appears to be sybil / multi-wallet farming, not a contract payout bug.
The faucet paid the expected 2,000 TYSM per wallet, but many wallets were coordinated and consolidated into one collector address.

## Action items

- Reduce large refills temporarily
- Monitor future Handle Ops activity
- Add denylist / blocklist support to Special Bonus Pool
- Block the collector and related smart wallets from future special bonuses
