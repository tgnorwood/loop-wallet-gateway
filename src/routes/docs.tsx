import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Partner docs — Loop Wallet Hub" },
      { name: "description", content: "Add 'Log in with Loop Wallet' or call the partner API." },
      { property: "og:title", content: "Partner docs — Loop Wallet Hub" },
      { property: "og:description", content: "Add 'Log in with Loop Wallet' or call the partner API." },
    ],
  }),
  component: Docs,
});

const popup = `<script src="HUB_URL/sdk/loop-wallet.js"></script>
<script>
  const lw = LoopWallet.init({ appId: "YOUR_APP_ID" });
  loginButton.onclick = async () => {
    const { address, session_token, verified } = await lw.login();
  };
  signButton.onclick = async () => {
    const { signature, message_hash } = await lw.signTypedData(typedData); // SNIP-12
  };
  sendButton.onclick = async () => {
    const { transaction_hash } = await lw.execute([{ contractAddress, entrypoint, calldata }]); // gas-free
  };
</script>`;

const api = `POST /api/public/v1/wallet/get-or-create   { email }
POST /api/public/v1/wallet/verify-otp      { email, code }
POST /api/public/v1/wallet/resend-otp      { email }
GET  /api/public/v1/wallet/:address/assets
POST /api/public/v1/wallet/sign            { session_token, typed_data }
POST /api/public/v1/wallet/execute         { session_token, calls: [{ contractAddress, entrypoint, calldata }] }
Header on every call: X-App-Key: lwk_...`;

const v1 = `Base: /api/public/v1   Headers: Authorization: Bearer lwk_...   Idempotency-Key: <uuid> (all writes)
Amounts are decimal strings ("12.5"). Errors: { error: { code, message, details } }

POST /wallets                 { externalId, kind?: user|collection_owner|treasury, label?, email?, signInMethod?: google|password|other }
                              201 new · 200 existing/linked · 202 { verificationId } = email already has a wallet; a code was emailed
POST /wallets/verify          { verificationId, code }  -> 200 wallet linked to your externalId (Google skips the code only for apps trusted for Google sign-in)
GET  /wallets?externalId=…  · /wallets/:id · /wallets/:id/balances · /wallets/:id/nfts
POST /tokens                  { name, symbol, initialSupply, swappable? }
POST /tokens/:id/mint         { amount }
POST /tokens/:id/distribute   { toWalletId | toAddress, amount }
POST /transfers               { fromWalletId, toWalletId | toAddress, tokenId, amount }
POST /returns                 { walletId, tokenId, amount }
POST /swaps                   { walletId, fromTokenId, toTokenId, amount }
POST /collections             { name, symbol, ownerWalletId, royaltyReceiver?, royaltyBps? }
PATCH /collections/:id/royalties  { receiver, bps }
POST /collections/:id/freeze      { confirm: true }   (permanent)
POST /collections/:id/minters     { address }   DELETE /collections/:id/minters/:address
POST /collections/:id/nfts        { toWalletId | toAddress, tokenUri, attributes?, media? }
GET|PATCH /collections/:id/nfts/:tokenId   { tokenUri?, attributes?, media? }
POST /collections/:id/nfts/:tokenId/freeze { confirm: true }
POST /nft-transfers           { collectionId, tokenId, fromWalletId, toWalletId | toAddress }
GET  /transactions/:id · /transactions?status=&type=&walletId= · POST /transactions/:id/cancel`;

function Docs() {
  const [hub, setHub] = useState("https://YOUR-HUB");
  useEffect(() => setHub(window.location.origin), []);
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <section>
          <h1 className="text-3xl font-bold">Connect your app</h1>
          <p className="mt-2 text-muted-foreground">An admin creates your app and lists your websites. Then pick the popup, the API, or both.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold">1. "Log in with Loop Wallet" popup</h2>
          <pre className="mt-3 overflow-auto rounded-lg border bg-card p-4 font-mono text-xs">{popup.replace("HUB_URL", hub)}</pre>
        </section>
        <section>
          <h2 className="text-xl font-semibold">2. Partner API (server to server)</h2>
          <pre className="mt-3 overflow-auto rounded-lg border bg-card p-4 font-mono text-xs">{api}</pre>
          <p className="mt-2 text-sm text-muted-foreground">Keep your app key on your server. Browser calls are only accepted from your registered websites.</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold">3. Tokens & NFTs API (Loop Do, Loop Fans, PressChain)</h2>
          <pre className="mt-3 overflow-auto rounded-lg border bg-card p-4 font-mono text-xs">{v1}</pre>
          <p className="mt-2 text-sm text-muted-foreground">
            Writes return 202 with a transaction (queued → submitted → confirmed/failed). Add ?wait=true to wait up to 45 s.
            Set a webhook address on the Dashboard to get signed transaction.confirmed / transaction.failed events (X-Signature: sha256=HMAC).
          </p>
        </section>
        <section>
          <h2 className="text-xl font-semibold">Wallets</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Starknet accounts using the SNIP-9 class <span className="font-mono">0x02b486…ba1f</span>. Their address is known up front and they deploy on first use, with gas paid by a paymaster.
          </p>
        </section>
      </main>
    </div>
  );
}
