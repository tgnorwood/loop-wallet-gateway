# Connecting a service to the Loop Wallet Gateway

For Loop Do, Loop Fans, PressChain and any future app. Base URL: `https://wallet.loop.fans/api/public/v1`

## 1. Authentication

- Every call carries `Authorization: Bearer lwk_…` (your app key). **Only your server calls the gateway.** Never put the key in browser code, a mobile app, or a public repo.
- Every write (`POST`, `PATCH`, `DELETE`) needs an `Idempotency-Key` header (a UUID you generate once per action). Retrying with the same key returns the original result and never does it twice. Using one key for a different request returns `409 IDEMPOTENCY_CONFLICT`.

## 2. Give each user a wallet at sign-up

```
POST /wallets
{ "externalId": "<your user id>", "email": "user@example.com", "emailVerified": false, "signInMethod": "password" }
```

| Response | Meaning | What your app does |
|---|---|---|
| `201` | New wallet created | Store `id`/`address`. Nothing else to do, no email step. |
| `200` | Wallet already linked to this `externalId` (or linked after Google via a trusted app) | Use it. |
| `202` `{ "status": "verification_required", "verificationId" }` | This email already has a wallet from another app (or the portal) and the user signed in with a password | Show a "Enter the 6-digit code we emailed you" box. Then `POST /wallets/verify { "verificationId", "code" }` → `200` wallet linked. To resend, call `POST /wallets` again (one per minute). |

Rules for the two flags:

- **`signInMethod`**: `"google"` for Google sign-in, `"password"` for email + password, otherwise `"other"`. If omitted it is treated as `"other"` and needs a code. Never claim `"google"` for a password sign-in.
- **`emailVerified`**: send `true` only when your own sign-in genuinely proved the user owns the email (Google, or a confirm-your-email link) **and** an admin has marked your app trusted for this. Otherwise send `false` or omit it. If your sign-up auto-confirms emails without a click, send `false`.

Friction: brand-new emails never see a code. A code appears only when an email that already has a wallet signs up from a second place with a password. Someone who signs up with an email they do not own can never take over a real owner's wallet: when the real owner proves the email (code or Google), the earlier unverified sign-up loses access.

## 3. Sending lots of requests

Writes are queued and processed by the gateway, not instantly:

- A write returns `202` with a transaction `{ id, status }`. Follow it by **webhook** (preferred, `transaction.confirmed` / `transaction.failed`, signed with `X-Signature: sha256=<hmac>`, same `X-Event-Id` on a retried delivery so dedupe on it) or by polling `GET /transactions/:id` every few seconds. Avoid `?wait=true` for bulk work; it holds a connection for up to 45 s.
- Statuses: `queued` → `submitted` → `confirmed` | `failed`. `unknown` means the outcome could not be confirmed; **do not resend**. Tell the user it is processing, keep polling, and an admin will resolve it.
- Capacity: operator actions (create token, mint, distribute, create collection, mint NFT) run in parallel lanes, roughly 20 to 30 per minute in total across all apps. Wallet-signed actions (transfers, swaps, NFT moves) run one at a time per wallet. Spread bulk jobs out, do not fire thousands at once.
- **`429`**: always carries a `Retry-After` header (seconds). Wait that long, then retry **with the same Idempotency-Key**, adding random jitter. Codes: `RATE_LIMITED` (too many calls per minute), `QUEUE_FULL` (your app already has too many waiting), `WALLET_DAILY_LIMIT` (one wallet hit its daily cap).
- Retry `5xx` and network errors with exponential backoff (1 s, 2 s, 4 s, … max 60 s) and the same Idempotency-Key. Never retry a `4xx` other than `429` without changing the request.
- Reading balances is cached for a few seconds and rate limited; do not poll it every second.

## 4. Retired endpoints (answer `410 endpoint_retired`)

| Old | Use instead |
|---|---|
| `POST /wallet/get-or-create` | `POST /wallets` |
| `POST /wallet/verify-otp` | `POST /wallets/verify` |
| `POST /wallet/resend-otp` | `POST /wallets` again |
| `oauth_verified` flag | `signInMethod: "google"` on an app the admin marked trusted |

The popup sign-in ("Log in with Loop Wallet", `oauth/token`, `wallet/sign`, `wallet/execute`, `wallet/:address/assets`) is unchanged.

## 5. Errors

Shape: `{ "error": { "code", "message", "details" } }`. Common codes: `UNAUTHORIZED`, `VALIDATION`, `NOT_FOUND`, `RATE_LIMITED`, `QUEUE_FULL`, `WALLET_DAILY_LIMIT`, `CAP_EXCEEDED`, `IDEMPOTENCY_CONFLICT`, `INSUFFICIENT_BALANCE`, `LEGACY_ACCOUNT` (an old wallet type that cannot be gas-free yet), `METADATA_FROZEN`, `NOT_OWNER`.
