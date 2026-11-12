import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardPage } from "@/components/DashboardPage";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Loop Wallet: live activity on Starknet" },
      { name: "description", content: "Live numbers for Loop's wallets, tokens and NFTs running on Starknet, with gas paid for users." },
      { property: "og:title", content: "Loop Wallet: live activity on Starknet" },
      { property: "og:description", content: "Live numbers for Loop's wallets, tokens and NFTs running on Starknet, with gas paid for users." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

/** Sign-in with Google comes back to "/". If the person started somewhere else (the wallet, a popup), send them back there. */
function Home() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    try {
      const back = sessionStorage.getItem("lw:return");
      if (back) {
        sessionStorage.removeItem("lw:return");
        if (back.startsWith("/") && !back.startsWith("//") && back !== "/") window.location.assign(back);
      }
    } catch { /* storage unavailable: stay here */ }
  }, [user]);
  return <DashboardPage />;
}
