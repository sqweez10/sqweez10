# TYSM Faucet V3 — Claim Authorization API Spec

**Status:** Draft spec. Backend not implemented yet. Mainnet deployment
blocked until backend, frontend, and Base Sepolia testing are complete.

This is a specification document only. It does not include
implementation code, secrets, private keys, or mainnet deployment
instructions.

---

## 1. Purpose

`/api/claim-authorization` is the backend gatekeeper for TYSM Faucet V3.

The on-chain contract (`TYSMFaucetV3`, using OpenZeppelin ECDSA/EIP-712)
only verifies a narrow set of things at claim time: that the signature
came from the configured `signer`, that the deadline hasn't passed, that
the authorization hasn't been used before (replay protection), that the
signature is bound to the calling wallet, that the wallet's cooldown has
elapsed, that the faucet isn't paused, and that the wallet isn't
blocklisted.

**The contract has no way to know whether a claim is legitimate beyond
that.** All of the real anti-abuse decision-making — whether this
Farcaster user actually shared, whether this wallet is farming, whether
this request is part of a bot pattern — happens here, in this endpoint,
before a signature is ever issued. If this endpoint signs carelessly,
the contract will honor that signature regardless.

Reminder: V3 is a **Fresh Start** daily faucet. It does not read or
migrate V2 history — no `oldFaucet`, no `migrated`, no copied V2 state.
Every wallet begins at Day 1 the first time it successfully claims via
V3. V2 history remains on-chain and may be reviewed separately, later,
for loyalty or bonus programs — that is explicitly out of scope for this
endpoint.

---

## 2. Endpoint

```
POST /api/claim-authorization
```

---

## 3. Request body

```json
{
  "fid": 476026,
  "wallet": "0x...",
  "castHash": "0x...",
  "client": "farcaster-mini-app",
  "chainId": 8453
}
```

| Field | Type | Description |
|---|---|---|
| `fid` | number | The requester's Farcaster ID, taken from the mini-app SDK context — not free-form user input. |
| `wallet` | string (address) | The wallet address that will call `claimWithSignature`. Must be independently verified as belonging to `fid` (see §7) — never trusted just because the client says so. |
| `castHash` | string | The hash of the Farcaster cast the user is claiming as their "share" proof. Required — this is what gets checked against Neynar in §8. |
| `client` | string | Identifies which client surface made the request (e.g. `"farcaster-mini-app"`). Useful for logging/rate-limiting; not itself a trust signal. |
| `chainId` | number | Which network the caller intends to claim on (`8453` for Base mainnet, `84532` for Base Sepolia in testing). Used to select the correct signer/domain configuration and to reject mismatched requests. |

**The backend does not trust this payload blindly.** Every field that
matters for eligibility (`wallet`↔`fid` association, the cast's real
content and author, cooldown state, denylist status) is independently
re-verified server-side against Farcaster data and the backend's own
records — never taken at face value from the request.

---

## 4. Success response

```json
{
  "deadline": 1234567890,
  "nonce": "0x...",
  "signature": "0x..."
}
```

- `deadline` — unix timestamp after which this authorization can no
  longer be used on-chain. Should be short-lived (see §9).
- `nonce` — a `bytes32` value, unique per authorization, used by the
  contract for replay protection.
- `signature` — an EIP-712 signature, produced by the backend's signer
  key, over the `ClaimAuthorization(user, deadline, nonce)` typed data
  (see §10).

**Field order matters for this spec's examples and for frontend
integration consistency:** always `deadline`, then `nonce`, then
`signature` — matching the parameter order of
`claimWithSignature(uint256 deadline, bytes32 nonce, bytes calldata signature)`.
Do not use the order `signature`/`deadline`/`nonce`.

---

## 5. Error responses

All error responses use safe, generic messages. **None of them expose
risk thresholds, scoring details, or the specific internal anti-abuse
logic that triggered the rejection.**

```text
// Missing fields
{ "error": "invalid_request", "message": "Required fields are missing." }

// Unsupported chain
{ "error": "unsupported_chain", "message": "This chain is not supported." }

// Wallet/FID association failed
{ "error": "wallet_fid_mismatch", "message": "This wallet could not be verified for this account." }

// Share cast not found
{ "error": "share_not_found", "message": "Please share your TYSM streak before claiming." }

// Share cast author mismatch
{ "error": "share_not_found", "message": "Please share your TYSM streak before claiming." }

// Share cast missing required marker
{ "error": "share_not_found", "message": "Please share your TYSM streak before claiming." }

// Cast hash already used
{ "error": "share_already_used", "message": "This share has already been used for a claim." }

// Cooldown not ready
{ "error": "cooldown_active", "message": "You're not eligible to claim yet. Please check back later." }

// Blocked / denylisted
{ "error": "not_eligible", "message": "Claim eligibility could not be verified right now. Please try again later or contact support." }

// Rate limited
{ "error": "rate_limited", "message": "Too many requests. Please slow down and try again shortly." }

// Signing unavailable
{ "error": "signing_unavailable", "message": "The claim service is temporarily unavailable. Please try again shortly." }

// Generic eligibility failed (catch-all)
{ "error": "not_eligible", "message": "Claim eligibility could not be verified right now. Please try again later or contact support." }
```

Note that several distinct internal failure reasons (author mismatch,
missing marker, cast not found) intentionally return the **same**
external message (`share_not_found` / "Please share your TYSM streak
before claiming.") — this avoids leaking which specific check failed,
which could otherwise help someone reverse-engineer the verification
logic. Similarly, `blocked`/`denylisted` and other risk-based rejections
share the generic `not_eligible` message rather than confirming denylist
status explicitly.

---

## 6. Eligibility checks

Before signing anything, the backend must check, at minimum:

- The wallet address is well-formed and valid.
- The FID is valid.
- The wallet genuinely belongs to / is verified/associated with the FID
  (not just asserted by the client).
- `castHash` exists and is a real, retrievable cast.
- The cast's author FID matches the requester's `fid`.
- The cast is recent enough (see §9 for timing).
- The cast contains a required marker — e.g. `#TYSMFaucet`, the app URL,
  or `@tops87sqweezz.base.eth`.
- `castHash` has not been used for a previous claim.
- The wallet and/or FID is not on the denylist.
- The request is within rate limits.
- Optional account-quality signals may be considered.
- **Neynar User Quality Score may be used as one signal among several —
  never the only rule**, and its threshold (if any) is never disclosed
  publicly.

Only once **all** applicable checks pass does the backend proceed to
signing (§10).

---

## 7. Farcaster verification

**Frontend `hasShared` state and `localStorage` are UI conveniences
only — never proof of anything.** They're trivially bypassable (cleared,
faked, or simply never accurate) and must never be treated as a source
of truth for eligibility.

The backend independently verifies the real cast using **Neynar** (or
another trusted Farcaster data source), by looking up `castHash` and
confirming:

- The cast actually exists.
- **The cast author's FID must match the requester's FID.** A cast
  authored by someone else, even if it mentions the app, does not
  satisfy this check.
- The cast is recent (see §9).
- The cast contains the required marker text.

If any of these fail, the response is the generic `share_not_found`
error from §5 — the frontend should not be told exactly which part
failed.

---

## 8. Nonce and replay policy

- The backend generates a **cryptographically random** `bytes32` nonce
  for every authorization it issues. Nonces must never be predictable,
  sequential, or derived from user-controllable input.
- The on-chain contract independently tracks used authorization digests
  and rejects replay — but the backend should not rely on that alone.
- The backend should also **log issued and used nonces** server-side,
  for auditing and to help diagnose any discrepancy between what was
  issued and what was actually claimed on-chain.
- **Used cast hashes must be stored server-side** (see §13) so the same
  share cast can't be used to obtain multiple authorizations.
- `deadline` should be **short-lived** — long enough for a normal user
  to complete the transaction (e.g. on the order of minutes), short
  enough that a leaked/observed authorization has a narrow window of
  usefulness.

---

## 9. EIP-712 signing spec

**Domain** (Base mainnet):

```json
{
  "name": "TYSMFaucetV3",
  "version": "1",
  "chainId": 8453,
  "verifyingContract": "0x..."
}
```

For **Base Sepolia** testing, use `chainId: 84532` and the deployed
Sepolia faucet's address as `verifyingContract`. The backend must select
the correct domain based on the request's `chainId` (see §3) rather than
assuming one network.

**Types:**

```json
{
  "ClaimAuthorization": [
    { "name": "user", "type": "address" },
    { "name": "deadline", "type": "uint256" },
    { "name": "nonce", "type": "bytes32" }
  ]
}
```

**Value:**

```json
{
  "user": "0x...",
  "deadline": 1234567890,
  "nonce": "0x..."
}
```

**Important:** the field is named `user`, not `wallet`, because the
deployed contract's typehash is fixed as:

```
ClaimAuthorization(address user,uint256 deadline,bytes32 nonce)
```

Using any other field name would produce a different type hash and an
invalid signature. This naming is a contract-level constant and must be
matched exactly in the backend's signing code.

---

## 10. Backend signer security

- The signer private key **lives only on the backend** — in an
  environment variable or a secret manager, never committed to source
  control, never logged, never returned in any API response.
- **Never expose the signer private key to the frontend**, in any form,
  under any circumstance.
- Maintain **separate signer keys for test (Base Sepolia) and
  production (Base mainnet)** — never reuse a test key for production
  signing or vice versa.
- The contract's `setSigner` function supports **signer rotation** by
  the owner. The backend should be built assuming rotation will happen
  (e.g. on suspected compromise) and should make it operationally easy
  to update which key it signs with.
- **Log the signer's public address**, not the private key, for
  auditability of which key issued which authorization.
- **If the signer is ever suspected compromised**, the response is to
  pause the faucet (`pause()`) and rotate the signer (`setSigner`)
  immediately — in that order, or as close to simultaneous as
  operationally possible.

---

## 11. Rate limiting and abuse controls

Rate limits and abuse heuristics should be applied at multiple levels,
independent of the on-chain 24h cooldown:

- Per FID
- Per wallet
- Per IP / session, where available
- Per `castHash` (a given cast should only ever back one claim)
- A **cooldown mirror check** before signing, where practical — i.e. the
  backend proactively checking whether the wallet is likely still in
  cooldown, rather than relying solely on the contract to reject a
  premature claim after a signature has already been issued
- Denylist enforcement (see §13)
- **Suspicious shared-collector patterns** (e.g. multiple wallets
  forwarding claimed tokens to the same common collection address) can
  be used as a review signal for adding entries to the denylist

As with eligibility checks generally, **exact thresholds are never
revealed** in API responses or public documentation.

---

## 12. Storage model

Proposed collections/tables (naming illustrative, not final):

**`issued_authorizations`**
- `id`
- `fid`
- `wallet`
- `castHash`
- `nonce`
- `deadline`
- `signature hash or digest` (a hash/fingerprint for logging — not the
  raw signature stored as a secret, though the signature itself isn't
  sensitive the way a private key is)
- `chainId`
- `contractAddress`
- `createdAt`
- `status` (e.g. issued / used / expired)

**`used_casts`**
- `castHash`
- `fid`
- `wallet`
- `usedAt`

**`denylist`**
- `type` (e.g. wallet / fid / collector-pattern)
- `value`
- `reason` (internal only — never exposed via the API)
- `createdAt`

**Private keys are never stored in the database.** The signer key lives
only in the environment/secret manager described in §10.

---

## 13. Frontend integration contract

1. Frontend gets Farcaster context (FID, connected wallet) from the
   mini-app SDK.
2. User shares (or the frontend otherwise obtains a `castHash` for an
   existing qualifying share).
3. Frontend calls `POST /api/claim-authorization` with the request body
   from §3.
4. If the response is successful (§4), the frontend calls
   `claimWithSignature(deadline, nonce, signature)` on the contract,
   passing the three values through in that exact order.
5. Frontend shows either a success state or a safe, friendly error
   message (per §5) — never a raw backend error code or internal detail.

---

## 14. Base Sepolia checklist

- [ ] Deploy a test TYSM token / `MockTYSM`.
- [ ] Deploy the V3 faucet contract to Base Sepolia.
- [ ] Set the backend's Sepolia signer as the contract's `signer`.
- [ ] Fund the faucet with test TYSM.
- [ ] Configure the backend with `chainId: 84532` and the deployed
      Sepolia `verifyingContract` address.
- [ ] Post and verify a real test Farcaster cast satisfying the share
      requirements.
- [ ] Call `/api/claim-authorization` end-to-end against that cast.
- [ ] Call `claimWithSignature` on-chain with the returned authorization.
- [ ] Test that reusing the same `castHash` is rejected.
- [ ] Test that reusing the same nonce/signature is rejected.
- [ ] Test that a cast authored by the wrong FID is rejected.
- [ ] Test blocklist enforcement end-to-end.
- [ ] Test pause behavior end-to-end.
- [ ] Test an expired deadline end-to-end.

---

## 15. Production readiness checklist

- [ ] GitHub Actions compile/test suite green.
- [ ] OpenZeppelin ECDSA/EIP-712 confirmed in use by the deployed
      contract (not the hand-written draft recovery logic).
- [ ] Backend deployed.
- [ ] Signer key secured (secret manager, not source control).
- [ ] Environment variables configured for the target network.
- [ ] Denylist populated and ready.
- [ ] Rate limits enabled.
- [ ] Farcaster/Neynar share verification enabled and tested.
- [ ] Used-cast storage enabled.
- [ ] Full Base Sepolia end-to-end pass complete (§14).
- [ ] Frontend integrated against this API.
- [ ] Contract verified on block explorer.
- [ ] Mainnet deployment plan reviewed by the project owner.
- [ ] V2 confirmed not being refilled.

---

## 16. Non-goals

- This backend does **not** migrate V2 history — V3 is Fresh Start, and
  this endpoint has no awareness of V2 state at all.
- This endpoint does **not** decide Special Bonus Pool rewards — that's
  a separate, decoupled system.
- Frontend `localStorage`/`hasShared` is **not** proof of anything and
  is never trusted by this endpoint.
- Neynar User Quality Score is **not** the only eligibility rule — it's
  one signal among several (§6, §11).
- This spec alone does **not** authorize a mainnet deployment — see the
  production readiness checklist (§15) for what's actually required
  first.
