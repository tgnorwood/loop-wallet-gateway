# Loop Wallet Hub

Build the hub described in your brief as a new app. The uploaded `cloud_wallet` code (old Cosmos-based SDK + Express/Mongo backend) is used only as a reference for login flows; nothing runs on the old servers. Existing users from that system are not imported unless you send an export later.

## What you get

1. **User Portal (`/`)** — sign in with email (6-digit code) or Google. Shows wallet address, verified status, balances, collectibles, recent activity, and active sessions with a "sign out everywhere" button.
2. **Developer Sandbox (`/demo`)** — a mock "Loop Fans / Loop Do" popup that calls the real API: new email gets a wallet instantly; existing email triggers the code prompt; entering the code shows the takeover (old sessions revoked).
3. **Admin Console (`/admin`)** — admin-only. Create/revoke app keys and allowed domains, metrics (total wallets, % verified, recent takeovers, signing requests), search by email or 0x address with full audit history and a "Revoke Sessions" button.
4. **Partner API** — `/api/public/v1/wallet/get-or-create`, `verify-otp`, `resend-otp`, `:address/assets`, `sign`, all protected by `X-App-Key` with CORS limited to each app's domains.

## Flows (as specified)

- New email: create wallet (unverified), return address + session token immediately.
- Existing email, not OAuth: email a 6-digit code (10 min, 5 attempts, resend max once per 60s); return `requires_verification`.
- Correct code or Google/Apple: revoke all prior sessions, mark verified, log `reclaimed_by_owner` (IP, time, method), issue new token.
- Private keys never leave the server; signing happens server-side after token check.

## Technical details

- Lovable Cloud: tables `wallets`, `wallet_sessions`, `wallet_verifications`, `registered_apps`, `audit_logs`, `user_roles` (admin). RLS on all; partner tables only reachable by server code. Grants per table.
- Keys: `viem` generates EVM keys; encrypted with AES-256-GCM via Web Crypto using a generated `WALLET_ENCRYPTION_KEY` secret. Session tokens and app keys stored as SHA-256 hashes; raw value shown once.
- OAuth "verified: true" from a partner is only trusted from apps flagged as trusted for OAuth in admin; the portal itself uses Lovable's Google sign-in.
- OTP email via Lovable's built-in email (needs an email sender domain set up).
- Assets endpoint reads native balance + recent transfers from a public EVM RPC (default: Polygon; configurable), plus points/badges stored in an `app_assets` table apps can write to later.
- Signing: `personal_sign` messages and EIP-1559 transactions via viem; logged as `signed_transaction`.
- Rate limits stored in the database (workers are stateless).
- Tests for: OTP expiry/attempt limits, resend cooldown, takeover revoking sessions, revoked token rejected by `sign`.

## Defaults I'm assuming (tell me to change)

- Chain: Polygon mainnet for balances.
- First admin: your account once you sign in.
- Apple sign-in included alongside Google.
