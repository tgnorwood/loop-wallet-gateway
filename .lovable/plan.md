# Import Loop Do tokens, holders and history

## Approach
Two sources, combined:
1. **Loop Do push (names/ownership):** Loop Do sends its token list (address, name, symbol, creator email/user_id, created_at) to a new hub endpoint, like the wallet migration. This gives the human labels the chain doesn't have.
2. **Chain backfill (the truth):** for each imported token the hub reads Starknet directly — every Transfer event since the token was deployed — and builds the holder list, balances and transaction history. No export of transactions from Loop Do is needed, and numbers always match the chain.

After import, new activity keeps flowing in: the per-minute worker picks up new Transfer events for imported tokens, so Loop Do activity shows even before Loop Do switches to calling this hub.

## What you'll see on the Dashboard
- Tokens tab: every Loop Do token with creator, supply, holder count, "from Loop Do" tag.
- Token page: holder list (address, linked email if the wallet is in the hub, balance) and full transaction list with Voyager links.
- Activity log merges hub transactions and imported on-chain history.

## Steps
1. New endpoint `POST /api/public/migrate/tokens` (same Bearer migration key), batched, dry-run supported, skips existing tokens.
2. New tables: `token_holders` (token, address, balance, wallet_id if known) and `chain_events` (token, tx hash, block, from, to, amount, time), deduped by tx hash + event index.
3. Backfill job: pages Transfer events per token from its deploy block using the RPC, stores a cursor so it resumes; runs in the worker tick in small chunks.
4. Dashboard: token detail view with holders + history; "Re-sync from chain" button.
5. Prompt text for Loop Do to send the token list (mirrors the wallet push).
6. Tests for balance calculation from events and dedupe.

## Questions answered by the plan
- Also NFTs from Loop Fans later? Same backfill works for collections (Transfer events of ERC-721) — can be added after.

## Technical notes
- Event reading via `starknet_getEvents` with chunk_size ~1000, key = selector("Transfer"); amounts u256 stored as decimal strings.
- Public RPC rate limits mean large backfills take minutes; progress shown per token.
