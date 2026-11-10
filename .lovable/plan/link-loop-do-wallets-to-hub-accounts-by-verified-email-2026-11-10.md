# Link Loop Do wallets to hub accounts by verified email

## What we need from Loop Do
One list, sent the same way the wallets were: for each wallet, the Loop Do user ID, the wallet address and that user's **verified** email. No keys are needed; the hub already has those. Loop Do sends it with the migration key it already uses, up to 200 at a time, with a dry run first.

Message to give Loop Do:
> POST https://wallet.loop.fans/api/public/migrate/wallets/emails with Authorization: Bearer LOOP_WALLET_MIGRATION_KEY and body { source: "loop-do", dry_run: true, wallets: [{ user_id, address, email, email_verified: true }] }. Only include emails the user has verified. Run again without dry_run to save.

## What the hub does with it
- Saves the email against each imported wallet, but only if the user ID and address match what was already moved in. Mismatches are skipped and reported.
- **Signing in from now on:** when someone signs in with a verified email that matches an imported wallet, they get that wallet. No new wallet is made.
- **People who already made a second wallet here (like you):** at their next sign-in, the Loop Do wallet becomes their main wallet. The empty wallet the hub made gets retired. If the hub-made wallet already holds anything, it isn't retired. It gets flagged on the Dashboard for an admin to decide.
- Every link and every retirement goes into the audit log.

## Linking yours now (before Loop Do sends the list)
Add an admin-only "Link Loop Do wallet" action under Dashboard → Users:
- The admin enters the hub account's email and the Loop Do wallet address.
- The hub checks that the address is an imported Loop Do wallet that no one has claimed yet. It shows the Loop Do user ID so you can confirm it with Loop Do.
- Confirming links it, retires the empty hub-made wallet, and logs who did it.

For tom@loop.fans and 0x042ae5…a40f5, you would run this yourself while signed in as admin. Your 1 YARRA and any collectibles on that address then show up in the portal.

## What stays the same
- Connected apps and active sessions only list apps you've signed into through this hub. They stay empty until Loop Do, Loop Fans or PressChain use "Log in with Loop Wallet". That's expected.
- Collectibles show whatever the linked address holds on-chain.

## Technical details
- New route `src/routes/api/public/migrate/wallets/emails.ts` (same Bearer check as the migrate routes) → `migrate.server.ts linkEmails()`. It sets `wallets.email` / `email_verified_at` where `(external_user_id, address)` match and `user_id` is null.
- In `service.server.ts`, wallet resolution on sign-in looks for an imported wallet whose email matches and whose `user_id` is null before creating a new one. If the user already has a hub-made wallet, it checks the on-chain balances. If they are zero, it sets `retired_at` on that wallet and claims the imported one.
- Migration: add `email`, `email_verified_at` and `retired_at` to wallets as needed, plus a partial unique index so each verified email has one active wallet.
- New admin server function `adminLinkImportedWallet`, gated by `has_role(admin)` and audit-logged.
- Pure matching and retirement rules go in `rules.ts`, with tests: email must be verified, address and user ID must match, wallets with a balance are never retired, a wallet can only be claimed once.
