# Emails via Resend + gas-free transactions via AVNU (copied from Loop Do)

## What I found in Loop Do

- **Email:** Loop Do sends straight to Resend using a `RESEND_API_KEY` secret. The From address comes from `RESEND_FROM_ADDRESS`, with `hello@loop.do` as the fallback.
- **AVNU:** Loop Do does not call AVNU directly. It goes through your Token Factory paymaster proxy at `https://token-factory-console.pages.dev/api/paymaster/{sepolia|mainnet}`, which needs no API key. Each request is a sponsored SNIP-29 `deploy_and_invoke` (or a plain `invoke` once the account is deployed), using the same SNIP-9 account class we use. Starknet RPC: `api.zan.top/public/starknet-sepolia`.
- Secret values can't be copied between projects. You'll paste the Resend key once, in a secure form.

## What you get

1. **Code emails actually send.** The 6-digit codes from the partner API are emailed from `Loop Wallet <hello@loop.do>`: "Your Loop Wallet code is 123456. Expires in 10 minutes." The sandbox keeps showing the code on screen for testing. Every send is logged in activity (sent or failed).
2. **Gas-free transactions.** A new endpoint, `POST /api/public/v1/wallet/execute`, takes a session token plus a list of calls. A matching "Approve transaction" popup and `lw.execute(calls)` in the SDK do the same from the browser. The first transaction deploys the wallet and runs the calls in one sponsored step, so users never need STRK. After that, the wallet is marked deployed and later calls are plain sponsored transactions. If sponsorship fails, the user sees an error, nothing is spent, and the failure is logged.
3. **Admin:** a "Transactions (7 days)" count, plus each transaction hash in the wallet's history, linked to Voyager.

## Technical details

- Secrets: `RESEND_API_KEY` (you paste it), and `RESEND_FROM_ADDRESS` set to `Loop Wallet <hello@loop.do>` (tell me if you want a different sender). `loop.do` must already be verified in Resend, as it is for Loop Do.
- `src/lib/wallet/email.server.ts`: Resend `POST /emails` with an `Idempotency-Key` set to the verification id, and a plain HTML + text body.
- `src/lib/wallet/paymaster.server.ts`: port of Loop Do's `executeSponsored` (`paymaster_buildTransaction`, then sign the returned typed_data with the decrypted key, then `paymaster_executeTransaction`). Deployment data: `{address, class_hash: SNIP-9, salt: publicKey, calldata: [publicKey], version: 1}`. Before executing, it checks on-chain via `starknet_getClassHashAt` whether the account is already deployed. Proxy URL is configurable with `PAYMASTER_URL`.
- Calls validated with zod (max 10 calls, hex felts). Audit action `executed_transaction` with the tx hash. Rate limit: 10 per minute per wallet.
- Tests: deployment payload uses the SNIP-9 class with salt and calldata equal to the public key, and is only included when the account isn't deployed. Also, a revoked session can't execute.
