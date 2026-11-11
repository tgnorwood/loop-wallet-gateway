# Operations runbook

## Secrets (Lovable → Cloud → Secrets)

| Name | What it is | Notes |
|---|---|---|
| `WALLET_ENCRYPTION_KEY` | Encrypts every wallet's private key | Back it up (see rotation below). Losing it loses all funds. |
| `WALLET_ENCRYPTION_KEY_NEXT` | Optional new key during rotation | Delete after promoting. |
| `RELAY_API_KEY` | Lets the gateway call the Token Factory relay (operator actions) | |
| `PAYMASTER_API_KEY` | Sent as `x-paymaster-api-key` to the paymaster proxy | Must equal the proxy's `PAYMASTER_PROXY_KEY`. |
| `PAYMASTER_URL`, `STARKNET_RPC_URL` | Optional overrides | Use a paid RPC for production traffic. |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | Emails the 6-digit codes | |
| `ALERT_EMAIL` | Comma-separated addresses told when a transaction needs a decision | Optional. |
| `OPERATOR_ADDRESS_SEPOLIA` | Operator account; the API refuses to remove it as a minter | |
| `OPERATOR_LANES` | Parallel operator lanes (default 6, max 32) | Raise gradually after load testing. |
| `MAX_QUEUED_PER_APP` | Most waiting transactions per app (default 300) | |
| `MAX_TX_PER_WALLET_PER_DAY` | Daily cap per wallet (default 500) | Limits sponsored-gas spend. |
| `LEGACY_WALLET_API` | `on` re-enables the retired email endpoints | Leave unset. |
| `LOVABLE_CRON_SECRET` | Set by Lovable for the per-minute worker | |
| removed | `LOOP_WALLET_MIGRATION_KEY`, `WALLET_MASTER_KEY`, `LOOPDO_WALLET_DERIVATION_SECRET` | Migration is done; delete them. |

## Rotating / backing up the wallet encryption key

Secrets in Lovable cannot be read back, so the key must be held somewhere you control.
1. Generate a new 64-character random key. Put it in your password manager (and a second person's).
2. Add it as `WALLET_ENCRYPTION_KEY_NEXT`. Open **Dashboard → Security**.
3. **Check (no changes)** then **Re-encrypt next 200** until "All wallets on the new key".
4. Set `WALLET_ENCRYPTION_KEY` to the new key's value and delete `WALLET_ENCRYPTION_KEY_NEXT`.
Each rewrite is verified by decrypting it again, and wallets can be re-run safely.

## A transaction shows "unknown"

It is holding up its lane on purpose (the gateway never resends on its own). Dashboard → Activity log → find it on Voyager:
- on chain → **Found on chain** and paste the hash (it then completes normally);
- not on chain → **Didn't happen** (marks failed, app is notified);
- never reached the relay and no hash → **Send again** (only if you are sure).

## Paymaster proxy lock (Cloudflare Pages `token-factory-console`)

The proxy requires the header `x-paymaster-api-key` equal to its `PAYMASTER_PROXY_KEY` secret: always on mainnet, and on Sepolia once `PAYMASTER_PROXY_LOCK_SEPOLIA=1`. Every caller (this gateway, Loop Do, anything using the proxy) must send the key first.
