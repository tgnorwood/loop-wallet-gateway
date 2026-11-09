# Central wallet system: tokens, NFTs, app API, migration

Turn the hub into the one place Loop Do, Loop Fans and PressChain call for every wallet, token and NFT action, following the Token Factory brief (sections 0-12). Every request is queued, logged, and shown in a Token Factory-style dashboard.

## What each app needs (from reading their code)

| App | Today | What it will call here |
|---|---|---|
| Loop Do | Own Starknet wallets: keys derived from a secret + per-user salt (`chain_wallets`, `chain_wallet_salts`). Tokens via relay: create token, mint more, distribute, return, swap, balances (`chain-token-admin`, `tokenFactory.ts`). | Wallets, create token, mint, distribute, transfer, return, swap, balances, transactions |
| Loop Fans | Old Loop Wallet at `cloud.loop.fans` (login popup + cookie). Artist drops/merch, fan wallet pages. | Popup login (already built), wallets, create collection per artist, mint NFT for drops, NFT transfer, metadata edits, royalties, list fan NFTs |
| PressChain | No wallet. Claim page is a mock ("NFT minted" toast); factories log pressings with `nft_minted` flag. | Collection per factory/edition, mint on claim code, NFT metadata (matrix, stamper, plant as attributes), freeze after pressing is final |

## What gets built

1. **App API v1** (brief section 8), Bearer app key, `Idempotency-Key` required on writes, amounts as decimal strings, `202` + transaction object, `?wait=true`:
   - Wallets: create by `externalId` (kinds user / collection_owner / treasury), get, balances (live from chain), NFTs.
   - Tokens: create, list, mint more, distribute.
   - Movement: transfers, returns, swaps (only tokens marked swappable, same app).
   - Collections: create, list, royalties, freeze (`confirm:true`), minters (operator can never be removed).
   - NFTs: mint (attributes, media), read, edit, freeze, transfer.
   - Transactions: get, list, cancel while queued.
   - Error codes exactly as the brief (NOT_OWNER, METADATA_FROZEN, INSUFFICIENT_LIQUIDITY, etc.).
   - Apps only see their own wallets/tokens/collections (404 otherwise).
2. **Transaction engine**: every write becomes a `queued` row; a worker runs one at a time per signer (operator, or each wallet), different signers in parallel; confirms on chain, retries transient errors 3 times, never retries reverts.
3. **Webhooks**: signed (HMAC) `transaction.confirmed` / `transaction.failed` to each app's URL, retried for 24h.
4. **Safety**: per-app rate limit (60/min), per-app daily caps on mint and distribute, full audit log of every API call and every key use.
5. **Dashboard** (admin, styled like the Token Factory console): tokens, collections, NFTs, holders, transfers, mints, edits, freezes, and a live transaction log filterable by app, with Voyager links. Live numbers come from our own records + chain reads; the console analytics API is used for history.
6. **Admin app onboarding**: create Loop Do / Loop Fans / PressChain apps, issue and rotate API key and webhook secret, set caps.
7. **Migration tools**:
   - **Loop Do**: import each user's wallet keeping the **same address** (so balances stay put) by re-deriving the key once from Loop Do's derivation secret + salt, then encrypting it here. Needs that secret added here and a one-time export of salts from Loop Do. Tokens and holdings import as records owned by the Loop Do app.
   - **Loop Fans**: users get new Starknet wallets matched by email (they already do via popup login). Old `cloud.loop.fans` assets cannot move chains automatically; drops are re-minted into the new collections from a CSV export.
   - **PressChain**: nothing to migrate; it starts on this system.
   - Import screen in admin: upload CSV, dry run, then apply, all logged.
8. **Acceptance test** (brief section 11) as an automated script against Sepolia.
9. **Integration guide** on the Docs page with copy-paste snippets for each of the three apps.

## Your concerns, and what we do

- **Throughput (4-5 operator actions/min)**: the queue absorbs bursts so apps never get nonce errors; dashboard shows queue depth and wait estimate. Wallet-signed actions (transfers, edits) run in parallel and are not limited. Ask Tom for the batch relay endpoint for big drops; the API will expose `POST /v1/tokens/{id}/distribute-batch` that uses it when available and falls back to the queue.
- **Open paymaster proxy**: this hub will only call it server-side and can send an auth header (`PAYMASTER_API_KEY`) as soon as the proxy supports it. Locking the proxy itself must be done on the Token Factory side before mainnet.
- **Mainnet**: everything takes a `network` parameter; mainnet stays switched off in admin until the checklist (contracts deployed, credits funded, proxy locked, key in KMS) is ticked.
- **Custody**: keys stay AES-256-GCM encrypted, decrypted only at signing, every signature audited, no export/import endpoint. Add a key version for rotation and a written backup step. Legal review is yours before real money.
- **Test clutter**: harmless on Sepolia. The dashboard will only show tokens/collections registered to our apps, with a "hide test items" toggle, so the clutter disappears from our view. It cannot be deleted from the chain.

## What I need from you

- `RELAY_API_KEY` from Tom (Loop Do stores it as TOKEN_FACTORY_RELAY_KEY).
- For Loop Do migration: the `WALLET_DERIVATION_SECRET` value and an export of `chain_wallet_salts` + `chain_wallets` + `chain_tokens` from Loop Do.
- For Loop Fans: a CSV of fans (email) and their drop NFTs.

## Technical details

- Pin `starknet@10.0.2` (currently ^10.8.0); copy `wallet-core.mjs` into `src/lib/wallet/core/` and use its builders/readers/send/relay; bundle the four ABIs. Text fields encoded as bytes; amounts as BigInt strings.
- Sponsored sends use `executePaymasterTransaction` with sponsored fee mode (replace current manual paymaster flow, keep SNIP-9 class rule).
- New tables: `tokens`, `collections`, `nfts`, `transactions` (unique app_id+idempotency_key, signer_key), `webhook_deliveries`; extend `wallets` with app_id, network, external_id, kind, label, key_version (unique app_id+network+external_id); extend `registered_apps` with webhook_url/secret, caps. RLS on, admin-only reads.
- Worker: `/api/public/v1/worker/tick` called each minute by pg_cron with a shared secret; picks per-signer rows with `FOR UPDATE SKIP LOCKED` via a DB function; `?wait=true` also runs inline.
- Routes under `src/routes/api/public/v1/` through `handle()`; Bearer key accepted alongside existing X-App-Key.
- Tests: idempotency conflict, cross-app 404, operator-minter removal refused, decimal conversion, signer queue ordering, error mapping.
