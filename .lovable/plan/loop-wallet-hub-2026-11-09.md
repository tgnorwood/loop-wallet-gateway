# Loop Wallet Hub

Build the hub described in your brief as a new app. The uploaded `cloud_wallet` code (old Cosmos-based SDK + Express/Mongo backend) is used only as a reference for login flows; nothing runs on the old servers. Existing users from that system are not imported unless you send an export later.

## What you get

1. **User Portal (`/`)** — sign in with email (6-digit code) or Google. Shows wallet address, verified status, balances, collectibles, recent activity, and active sessions with a "sign out everywhere" button.
2. **Developer Sandbox (`/demo`)** — a mock "Loop Fans / Loop Do" popup that calls the real API: new email gets a wallet instantly; existing email triggers the code prompt; entering the code shows the takeover (old sessions revoked).
3. **Admin Console (`/admin`)** — admin-only. Create/revoke app keys and allowed domains, metrics (total wallets, % verified, recent takeovers, signing requests), search by email or 0x address with full audit history and a "Revoke Sessions" button.
4. **Partner API** — `/api/public/v1/wallet/get-or-create`, `verify-otp`, `resend-otp`, `:address/assets`, `sign`, all protected by `X-App-Key` with CORS limited to each app's domains.

## "Log in with Loop Wallet" popup (for Loop Fans and other platforms)

Partner sites get two ways to connect:

- **Popup:** a partner adds a small script and a "Log in with Loop Wallet" button. Clicking it opens a hub-hosted popup (`/connect?app=...`). There the user signs in with email + password or Google (or creates a wallet instantly). They then see an approval screen ("Loop Fans wants to see your wallet address and request signatures"). After they approve, the popup sends the wallet address and a short-lived session token back to the partner site, which then knows who the user is.
- **Signing popup:** when the partner needs a signature or transaction, the script opens `/connect/sign`. The user sees what they're signing and approves it. The signature goes back to the partner site.
- **API access:** partners with an app key can still call the Partner API from their servers (get-or-create by email, verify code, assets, sign) for custom flows without the popup.
- Admins can turn popup and/or API access on or off per app, along with each app's allowed domains. The popup only replies to those domains.
- The portal shows "Connected apps", and users can disconnect any of them.

## Flows (as specified)

- New email: create wallet (unverified), return address + session token immediately.
- Existing email, not OAuth: email a 6-digit code (10 min, 5 attempts, resend max once per 60s); return `requires_verification`.
- Correct code or Google/Apple: revoke all prior sessions, mark verified, log `reclaimed_by_owner` (IP, time, method), issue new token.
- Private keys never leave the server; signing happens server-side after token check.

## Technical details

- Lovable Cloud: tables `wallets`, `wallet_sessions`, `wallet_verifications`, `registered_apps`, `audit_logs`, `user_roles` (admin). RLS on all; partner tables only reachable by server code. Grants per table.
- Keys: starknet.js generates Stark keys (EVM/viem parts of the brief are replaced by Starknet); encrypted with AES-256-GCM via Web Crypto using a generated `WALLET_ENCRYPTION_KEY` secret. Session tokens and app keys stored as SHA-256 hashes; raw value shown once.
- OAuth "verified: true" from a partner is only trusted from apps flagged as trusted for OAuth in admin; the portal itself uses Lovable's Google sign-in.
- OTP email via Lovable's built-in email (needs an email sender domain set up).
- Assets endpoint reads native balance + recent transfers from a public EVM RPC (default: Polygon; configurable), plus points/badges stored in an `app_assets` table apps can write to later.
- Signing: `personal_sign` messages and EIP-1559 transactions via viem; logged as `signed_transaction`.
- Popup: `/connect` and `/connect/sign` routes. They communicate through `window.postMessage`, checked against the app's registered origins. A short-lived authorization code is swapped for a token, either by the partner's server or by the browser using a PKCE-style verifier. Table `app_connections` stores user approvals per app. The script is served at `/sdk/loop-wallet.js`.
- Rate limits stored in the database (workers are stateless).
- Tests for: OTP expiry/attempt limits, resend cooldown, takeover revoking sessions, revoked token rejected by `sign`.

## Starknet and sign-in changes

- Wallets are Starknet accounts using the SNIP-9 account class `0x02b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f`. This class supports `execute_from_outside_v2`, so paymasters can sponsor transactions. The old OpenZeppelin v0.8.1 class (`0x061dac...`) will never be used, because paymasters rejected it with "invalid paymaster version".
- Address derivation: `calldata = [publicKey]`, `salt = publicKey`, matching your existing scheme. Users get an address instantly. The account deploys gas-free on its first action through a sponsored `deploy_and_invoke` from the AVNU paymaster, so users never need STRK. The paymaster API key is stored as a secret.
- A test checks that every new wallet uses the SNIP-9 class hash and that its address matches the expected derivation.
- Balances/transfers come from a Starknet RPC (Sepolia testnet first, mainnet when you're ready). Signing uses Starknet typed data (SNIP-12) and invoke transactions instead of EVM.
- Portal sign-in: email + password and Google only (no Apple for now). Password reset page included.
- Partner API keeps the 6-digit email code for the "existing email" gate, since partner apps don't hold passwords.

## Security summary

Strong points: private keys encrypted with AES-256-GCM and only decrypted inside the server when signing; never sent to browsers or partner apps. Tokens and app keys stored hashed, so a leaked database doesn't give working sessions. Code attempts, resend cooldowns, and session revocation stop brute-force and imposter takeovers. Every create/verify/sign is audit-logged.

Honest limits: this is a custodial wallet, so whoever controls the server and the encryption secret can, in principle, sign for any user. A stolen session token can sign until it expires or is revoked (short expiry and per-app scoping reduce that). The new-user "zero friction" step means someone can create a wallet with another person's email; they never get the key, and the real owner reclaims it, but anything sent to that wallet in between is controlled by the hub. For large balances you'd later want a hardware-backed key service (KMS/HSM) or user-held recovery, plus an external security audit before mainnet.

## Defaults I'm assuming (tell me to change)

- Network: Starknet Sepolia testnet first.
- First admin: your account once you sign in.
