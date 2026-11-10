# Receive Loop Do's 2,246 wallets

The hub already has the receiving address (`/api/public/migrate/wallets/migrate`). It matches Loop Do's format: Bearer migration key, wallets encrypted with the shared master key, and the address used as AAD. This plan finishes and proves that path before the real run.

## Steps

1. **Self-test the receiver.** Encrypt a throwaway wallet the same way Loop Do does and send it. Confirm four things:
   - it's created;
   - sending it again shows it as "exists";
   - a changed address is refused as a "mismatch";
   - a wrong master key fails with "could not decrypt".

   Then delete the throwaway wallet.
2. **Loop Do app.** Make sure an active app named "Loop Do" exists. The imported wallets are attached to it. I'll create it if it's missing.
3. **Handle large batches.** Insert wallets in groups so that 200 wallets per call finish well within time limits. The reply sends back counts plus one result per wallet, with no key material.
4. **Store the old account type correctly.** Wallets on the old account type keep their own class hash and address. They are marked "not gas-free". The engine will refuse gas-free actions for them with a clear error, instead of failing at the paymaster.
5. **Dashboard view.** Add a "Loop Do migration" card showing wallets imported, how many use the old account type, and the last import time. The activity log already records each import.
6. **Tests.** Add unit tests for the decrypt-and-check step, using a known key and address. Also test that the old account type is detected.

## Running it (you, from Loop Do)

1. Use the test mode first (`dry_run: true`, limit 200), following `next_offset` until it's empty.
2. Then do the real run with the same settings.
3. Check the dashboard card shows 2,246 minus any skipped wallets.

## Open point

Old-account-type wallets can't use gas-free sends. Moving their balances to a new account later would need STRK for gas, or a one-off sweep. That can be planned once we know how many there are, which the test run will show.

## Technical details

- Files: `src/lib/wallet/migrate.server.ts` (receiveLoopDoWallets, batching), `src/routes/api/public/migrate/wallets/migrate.ts`, the engine's legacy-class guard in `engine.server.ts`, a dashboard card in `src/routes/dashboard.tsx` plus a field in `chainDashboard`, and tests in `src/test/chain-rules.test.ts` (with the pure helpers moved to `chain-rules.ts`).
- Endpoint URL for Loop Do: `LOOP_WALLET_API_URL` = `<hub URL>/api/public/migrate`. Use the published URL once this app is published.
