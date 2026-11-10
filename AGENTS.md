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
- API exchange eligibility is evaluated by the pure swapPairAllowed rule after app-scoped token reads, so app policy never bypasses ownership checks.
- Wallet logic lives in `src/lib/wallet/`; DB-touching code is `service.server.ts`, loaded only via dynamic import inside handlers, so the service-role client never reaches the browser.
- Pure rules (OTP limits, session validity, origin matching) live in `rules.ts` so they can be unit-tested without a database.
- Starknet accounts must use the SNIP-9 class hash in `starknet.ts` with derivation calldata=[publicKey], salt=publicKey; the legacy OZ v0.8.1 class is rejected by paymasters.
- Partner HTTP API lives under `src/routes/api/public/v1/` and goes through `handle()` in `http.ts` (X-App-Key + registered-origin check); session tokens, app keys and codes are stored only as SHA-256 hashes.
- Popup sign-in uses an auth code + PKCE exchanged at `/api/public/v1/oauth/token`; replies use postMessage only to the requested origin, which must be registered.
- OTP email goes through Resend directly (`email.server.ts`, RESEND_API_KEY / RESEND_FROM_ADDRESS); gas-free execution goes through the Token Factory AVNU paymaster proxy (`paymaster.server.ts`, overridable via PAYMASTER_URL), ported from Loop Do.
- Central tokens/NFT API is one splat route `src/routes/api/public/v1/$.ts` → `api-v1.server.ts` (Bearer app key, Idempotency-Key on writes); chain calls use `core/core.ts` (port of Token Factory wallet-core, starknet pinned 10.0.2, strings as bytes, amounts as BigInt strings).
- Every write is a `transactions` row run by `engine.server.ts`: one in-flight tx per signer (unique partial index + `claim_transactions()`), driven by the per-minute `/api/public/jobs/wallet-worker` schedule; operator actions go through the relay (RELAY_API_KEY), wallet actions are signed here and sponsored.
- Pure API rules (amounts, idempotency, error mapping, caps, minter removal) live in `chain-rules.ts` for unit tests.
- Loop Do wallets arrive by push at `/api/public/migrate/wallets/migrate` (Bearer LOOP_WALLET_MIGRATION_KEY, keys AES-GCM-wrapped with the shared transport key WALLET_MASTER_KEY, re-encrypted with our own storage key); legacy-class imports keep their class hash and the engine refuses them with LEGACY_ACCOUNT.
- Token holders/history are rebuilt from Starknet Transfer events (`token-sync.server.ts`, run in the wallet worker) into `chain_events` → `recompute_token_holders()`; the first sync binary-searches the deploy block because public RPC getEvents scans only ~80k blocks per page. Loop Do pushes its token list to `/api/public/migrate/tokens` (same migration key).
