# Prove email ownership before reusing an existing wallet

## Rule
Sometimes a person arrives with an email that already has a wallet here: through this hub's sign-in, the popup, the API, or a Loop Do import. Before they get access to that wallet, the hub emails them a 6-digit code and they must enter it.
- **Skip the code** when they signed in with Google. This applies to the hub's own Google sign-in, and to a partner app that the admin has marked "trusted for Google sign-in" and that says the user came from Google.
- **Always ask for the code** for email + password sign-ins and anything else, even when the app says the email is "verified".
- New emails with no wallet yet just get a new wallet, with no code. Nothing exists to protect.

## Where it applies
1. **Hub sign-in (email + password):** this hub's own sign-in page. If the email matches a wallet the person doesn't own yet (for example a moved-in Loop Do wallet), a "Check your email" step appears after sign-in. The wallet is only linked once the code is entered. Until then they see an empty "verify to access your wallet" screen. Google sign-ins link straight away.
2. **Popup (`Log in with Loop Wallet`):** already sends a code when the email has a wallet. This step makes sure Google-trusted apps are the only way to skip it.
3. **Partner API (Loop Do, Loop Fans, PressChain creating wallets):** if the email already has a wallet, the hub no longer links it at once. It replies "verification required" and emails the code. The app shows a code box and sends the code back, and then the wallet is linked to that app's user. "emailVerified" from the app no longer skips this. Only the Google case with a trusted app does.
4. **Loop Do email list:** Loop Do's own users keep their own imported wallets with no code needed. If someone signs in here with email + password and the email matches an imported wallet, they get the code step from point 1.
5. **Admin "Link Loop Do wallet":** stays as an admin-only override and is logged.

## For each new service you attach
- Admin → Apps: register the app with its domains, and choose whether it's "trusted for Google sign-in" (off by default).
- The app uses either the popup (no extra work: codes are handled inside it) or the API with a code screen:

```text
POST /v1/wallets {externalId, email, signInMethod: "password"|"google"}
  -> 201 new wallet            (email was new)
  -> 200 existing wallet       (Google + trusted app, or already linked)
  -> 202 { verificationId }    (code emailed)
POST /v1/wallets/verify {verificationId, code}
  -> 200 wallet linked
```
- The SDK gets `lw.verifyEmail(verificationId, code)` and the docs page shows this flow.

## Limits kept
5 tries per code, codes last 10 minutes, a 60-second wait before resending, and rate limits on each app and each email. Each step is logged: code sent, failed attempt, linked.

## Technical details
- Add `trusted_google` (boolean, default false) to `registered_apps`. Reuse `wallet_verifications` and add the `purpose`, `external_id`, `network` and `user_id` columns it needs.
- `rules.ts`: a pure `needsEmailProof({ walletExists, alreadyLinked, method, appTrustedGoogle, isHubGoogle })`, with tests for every case above.
- `api-v1.server.ts createWallet`: on an email match, create the verification and send the code with `email.server.ts`, then return 202. The new `wallets/verify` route inserts the `wallet_app_links` row (or claims the imported wallet) once the code is right.
- `service.server.ts ensureOwnerWallet`: take the sign-in method from the session's provider. For password sign-ins that match an unowned wallet, return `{ status: "verify_required" }` and don't link. New `portalVerifyEmail` / `portalSendCode` server functions do the linking after the code is entered, using `claimImportedWallet`.
- Portal page: a code entry card with resend countdown.
- `getOrCreate` (popup/API): the OTP skip applies only to `trusted_google` apps whose sign-in method is google.
- Admin Apps: a "Trusted for Google sign-in" switch.
- Docs + SDK update; AGENTS.md rule.
