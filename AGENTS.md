<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Shared branding metadata belongs in a browser-safe helper spread into leaf page heads, never the root or shared layouts, so preview images remain page-scoped.
- Relay calls request wait:false and log redacted replies by transaction ID; uncertain submissions retain their signer lock and never auto-resend, while known hashes are receipt-polled.
- API exchange eligibility is evaluated by the pure swapPairAllowed rule after app-scoped token reads, so app policy never bypasses ownership checks.
- Wallet logic lives in `src/lib/wallet/`; DB-touching code is `service.server.ts`, loaded only via dynamic import inside handlers, so the service-role client never reaches the browser.
- Pure rules (OTP limits, session validity, origin matching) live in `rules.ts` so they can be unit-tested without a database.
- Starknet accounts must use the SNIP-9 class hash in `starknet.ts` with derivation calldata=[publicKey], salt=publicKey; the legacy OZ v0.8.1 class is rejected by paymasters.
- Partner HTTP API lives under `src/routes/api/public/v1/` and goes through `handle()` in `http.ts` (X-App-Key + registered-origin check); session tokens, app keys and codes are stored only as SHA-256 hashes.
- Popup sign-in uses an auth code + PKCE exchanged at `/api/public/v1/oauth/token`; replies use postMessage only to the requested origin, which must be registered.
- OTP email goes through Resend directly (`email.server.ts`, RESEND_API_KEY / RESEND_FROM_ADDRESS); gas-free execution goes through the Token Factory AVNU paymaster proxy (`paymaster.server.ts`, overridable via PAYMASTER_URL), ported from Loop Do.
- Cloud authentication emails use the scaffolded managed handler and shared inline email theme; wallet proof codes remain on Resend so changing auth branding does not change wallet verification delivery.
- Central tokens/NFT API is one splat route `src/routes/api/public/v1/$.ts` → `api-v1.server.ts` (Bearer app key, Idempotency-Key on writes); chain calls use `core/core.ts` (port of Token Factory wallet-core, starknet pinned 10.0.2, strings as bytes, amounts as BigInt strings).
- Every write is a `transactions` row run by `engine.server.ts`: one in-flight tx per signer (unique partial index + `claim_transactions()`), driven by the per-minute `/api/public/jobs/wallet-worker` schedule; operator actions go through the relay (RELAY_API_KEY), wallet actions are signed here and sponsored.
- Pure API rules (amounts, idempotency, error mapping, caps, minter removal) live in `chain-rules.ts` for unit tests.
- Base-unit display conversion expands scientific-notation strings using integer arithmetic in `fromBaseUnits`, never floating-point parsing, so large amounts render without crashes or additional precision loss.
- The one-time Loop Do migration is finished and its push endpoints (`/api/public/migrate/*`), derivation-secret code and the wallet CSV import were removed; Loop Do wallets were imported with `imported_from = loop-do|loop-do-legacy` and are never touched by the unverified-controller cleanup.
- Imported Loop Do wallets are linked to accounts from the admin Users tab or when the owner signs in and proves their email; sign-in claims them first and retires a hub-made wallet only if canRetireWallet says it is empty, so no funds are stranded.
- POST /v1/wallets with a verified email reuses any existing wallet for that email via wallet_app_links (app, network, externalId → wallet); walletOf honours these links, so one person has one wallet across apps.
- Reusing an existing wallet for an email requires an emailed code (needsEmailProof in rules.ts) except Google sign-ins on the hub or via apps flagged trusted_oauth; portal throws VerifyRequired, partner API returns 202 + POST /v1/wallets/verify.
- An email counts as "verified" on a wallet only after an emailed code or Google sign-in (or when a `trusted_oauth` app says so: `emailVerifiedEffective`). When someone proves an email that was never proven, `evictUnverifiedControllers` removes the earlier controllers (sessions, app links, home app binding, portal user); imported wallets are exempt. Never accept a caller-supplied "verified" flag outside that rule.
- Code checks must stay atomic: `spendAttemptAndCheck` spends an attempt with a compare-and-set before comparing, and `rateLimit` uses the `rate_limit_hit` database function when present (compare-and-set fallback). Normalise emails (`normalizeEmail`) before using them in any limiter key.
- Never build PostgREST filters by string interpolation (`.or(\`email.eq.${x}\`)`); use `.eq()` calls.
- Operator work runs in `OPERATOR_LANES` parallel lanes (`operator:<network>:<n>`, least-loaded chosen at enqueue). Finalising a transaction takes an atomic `submitted → finalizing` lock so parallel workers never apply effects or webhooks twice. Per-app queue cap `MAX_QUEUED_PER_APP`, per-wallet daily cap `MAX_TX_PER_WALLET_PER_DAY`, 429s carry Retry-After.
- Wallet private keys are sealed as `v2:<keyId>:…` with the keyring in `crypto.ts` (`WALLET_ENCRYPTION_KEY`, optional `WALLET_ENCRYPTION_KEY_NEXT` for rotation from the dashboard's Security tab). Never decrypt with a raw secret elsewhere; use `openKey`/`sealKey`.
- The email-only partner endpoints (`/wallet/get-or-create`, `verify-otp`, `resend-otp`) answer 410 unless `LEGACY_WALLET_API=on`; new integrations use `/v1/wallets`.
