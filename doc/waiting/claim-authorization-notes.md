# Backend Notes: `/api/claim-authorization`

Status: **planning / documentation only.** No backend code has been
written yet — this documents what the endpoint needs to do before any
implementation starts.

This endpoint is what issues the EIP-712 claim authorization that the
frontend then passes to `TYSMFaucetV3.claimWithSignature(...)`. See
`faucet-v3-anti-abuse-plan.md` §2 and §8 for the surrounding design;
this file is the implementation-level detail for the endpoint itself.

---

## Request

`POST /api/claim-authorization`

Inputs (shape TBD when actually implemented, described conceptually
here):
- `wallet` — the connected wallet address requesting a claim
- `fid` — the Farcaster ID of the requesting user, from mini-app context

## Checks, in order

The backend must run these checks **in order**, stopping at the first
failure, before ever calling the signer:

1. **Wallet/FID association** — confirm `wallet` is genuinely linked to
   `fid` via the mini-app SDK context, not an arbitrary wallet address
   supplied by the client.
2. **Denylist** — reject if `wallet` or `fid` is on the known-bad list
   (farming wallets, wallets tied to collector addresses like
   `chickenattack.base.eth`, etc. — see
   `security/suspected-farming-chickenattack.md`).
3. **Rate limit** — reject if this `fid`/`wallet`/IP/session has
   requested authorizations too frequently, independent of the on-chain
   24h cooldown.
4. **Share verification (new)** — reject unless a **recent, qualifying
   TYSM share cast** exists for this `fid`. This is the new check this
   update adds. See below for detail.

Only if all four pass does the backend sign and return a claim
authorization (`deadline`, `nonce`, `signature`) per the contract's
`claimWithSignature` interface.

*(Neynar User Quality Score, per `faucet-v3-anti-abuse-plan.md` §8, is a
separate signal that factors into the overall decision — this doc
doesn't restate that section, just notes it belongs somewhere in this
same checks pipeline, exact ordering TBD alongside implementation.)*

---

## Share verification — problem being solved

The current frontend share-to-unlock flow only tracks `hasShared` in
local/frontend state. That's **not proof of anything** — it's trivially
bypassable (clear local storage, fake the state, or simply never
actually cast) since the backend never independently checks it. A user
could reach the "eligible to claim" state in the UI without ever having
posted a share cast.

**Rule going forward:** the backend independently verifies a real,
recent Farcaster cast exists — via the Neynar API, not frontend state —
before issuing a claim authorization. Frontend `hasShared` /
`localStorage` values must never be trusted as proof for this decision;
they're only used for local UI/UX (e.g. graying out the Claim button
before the user has shared), never as the actual eligibility source of
truth.

## Flow

1. User taps **Share** in the mini app.
2. User publishes a Farcaster cast containing a required marker (e.g.
   `#TYSMFaucet`) and the app URL.
3. User returns to the app and taps **Claim**.
4. Frontend calls `/api/claim-authorization` with `wallet` and `fid`.
5. Backend runs the four checks above, including share verification.
6. Only then does the backend sign and return the claim authorization.

---

## TODO — implementation notes

- [ ] **Use the Neynar API** to fetch recent casts by `fid`, or casts
      mentioning/containing the TYSM marker — exact endpoint/query
      approach (e.g. user casts feed vs. a search/mentions query) to be
      decided when this is actually implemented.
- [ ] **Require the cast timestamp to fall within a short window** —
      e.g. 10–30 minutes before the authorization request — so a share
      from days ago can't be reused indefinitely to keep unlocking
      future claims. Exact window is a tuning decision, not fixed yet.
- [ ] **Require a text marker** in the cast — e.g. `#TYSMFaucet` or the
      app URL — so an unrelated cast from the same user doesn't
      accidentally satisfy the check.
- [ ] **Do not rely on `localStorage` or `hasShared`** as proof, at any
      point in this check. Those remain frontend-only UX conveniences,
      never a source of truth for the backend decision.
- [ ] **Decide caching/reuse behavior** — e.g. should one qualifying
      share cast be reusable for exactly one claim, or could a user
      share once and then be checked against that same cast on a later
      day too? (Leaning toward "one share, tied to one claim window" to
      keep the anti-bypass property meaningful, but this needs an
      explicit decision before implementation.)
- [ ] **Friendly rejection message** — when share verification fails,
      return an error the frontend can show directly:
      > "Please share your TYSM streak before claiming."
      (Exact response shape/error code TBD alongside the rest of the
      endpoint's error handling.)
- [ ] Require `cast.author.fid` to exactly match the requesting `fid`.
- [ ] Store used share cast hashes so one cast cannot unlock unlimited claims.
- [ ] Consider adding a backend-issued share nonce/marker to the cast text.
- [ ] Require the cast to include `#TYSMFaucet` plus the app URL or [@tops87sqweezz](https://farcaster.xyz/tops87sqweezz).base.eth.
---


## Explicitly not covered yet

- Full endpoint code / request-response schema.
- Frontend changes to call this endpoint and handle the new rejection
  case (per your instructions, frontend code isn't being generated at
  this stage — this doc only defines the contract between frontend and
  backend at a conceptual level).
- Neynar API credentials/config, rate-limit store choice, or denylist
  storage mechanism — all implementation details to be decided when
  backend code actually gets built.
