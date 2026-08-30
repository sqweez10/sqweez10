# TYSM Faucet V3 — Backend Implementation Summary

Status: **NOT IMPLEMENTED.** This document summarizes what the backend
needs to do, per `claim-authorization-api-spec.md`. No backend code
exists yet.

Base Sepolia contract + E2E: ✅ COMPLETE (final, not reopened).
Mainnet: 🔴 **NO-GO.**

---

## Purpose

`POST /api/claim-authorization` is the gatekeeper that decides whether
a wallet may claim from TYSM Faucet V3. The on-chain contract trusts
any valid signature from the configured `signer` — all real eligibility
logic lives here, before a signature is ever issued.

## Request / Response

**Request:** `fid`, `wallet`, `castHash`, `client`, `chainId`

**Success response (in order):** `deadline`, `nonce`, `signature`

## Required server-side checks (in order, stop at first failure)

1. Validate wallet address format and FID.
2. Verify wallet↔FID association server-side.
3. Check denylist (wallet + FID).
4. Apply rate limits (FID, wallet, IP/session, castHash).
5. Verify `castHash` via Neynar — cast exists, author FID matches
   requester, cast is recent, contains required TYSM marker.
6. Confirm `castHash` not already used.
7. Only then: generate nonce, set deadline, sign EIP-712, return.

Frontend `hasShared` / `localStorage` is never trusted as proof.

## Neynar cast verification

Independently verifies the share cast — see spec §7. Author FID must
exactly match the requester; timestamp must fall within a short window;
marker (`#TYSMFaucet` + app URL or `@tops87sqweezz.base.eth`) required.

## Used-cast storage

Every consumed `castHash` is stored server-side (`used_casts`) so it
can't back more than one claim. See spec §12.

## EIP-712 signing

- Domain: `TYSMFaucetV3`, version `1`
- Base Mainnet `chainId: 8453` / Base Sepolia `chainId: 84532`
- Domain selected by request `chainId`
- Type: `ClaimAuthorization(address user,uint256 deadline,bytes32 nonce)`
  — field name is `user`, not `wallet`

## Signer security

- Private key: backend env/secret manager only — never committed,
  logged, or sent to frontend
- Separate signer keys for Sepolia (test) and Mainnet (production)
- Supports rotation via contract `setSigner`
- Log public signer address only

## Network config separation

Base Sepolia and Base Mainnet configs (chainId, verifyingContract,
signer key) must be kept fully separate. **Mainnet config stays
disabled/unused unless explicitly approved** — this is the NO-GO gate.

## Mainnet NO-GO gate

Mainnet remains blocked until: backend implemented and deployed,
frontend integrated, production env vars set, Neynar verification
tested live, used-cast + rate-limit storage running, and owner sign-off.
This document does not change that status.

## Next backend files to create

- `/api/claim-authorization` route handler
- Neynar client wrapper (cast lookup)
- EIP-712 signer module
- Storage layer: `issued_authorizations`, `used_casts`, `denylist`
- Rate-limit middleware
- Config module (chainId → domain/signer selection)
