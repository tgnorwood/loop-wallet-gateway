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
</script>`;

const api = `POST /api/public/v1/wallet/get-or-create   { email }
POST /api/public/v1/wallet/verify-otp      { email, code }
POST /api/public/v1/wallet/resend-otp      { email }
GET  /api/public/v1/wallet/:address/assets
POST /api/public/v1/wallet/sign            { session_token, typed_data }
Header on every call: X-App-Key: lwk_...`;

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
          <h2 className="text-xl font-semibold">Wallets</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Starknet accounts using the SNIP-9 class <span className="font-mono">0x02b486…ba1f</span>. Their address is known up front and they deploy on first use, with gas paid by a paymaster.
          </p>
        </section>
      </main>
    </div>
  );
}
