import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { DashboardPage } from "@/components/DashboardPage";
import { useAuth } from "@/hooks/use-auth";
import { loopPreviewMeta } from "@/lib/branding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Loop Wallet | Your wallet for Loop apps" },
      { name: "description", content: "One Loop Wallet for your tokens, NFTs and connected Loop apps. Sign in securely with email or Google and manage your Starknet assets." },
      { property: "og:title", content: "Loop Wallet | Your wallet for Loop apps" },
      { property: "og:description", content: "One Loop Wallet for your tokens, NFTs and connected Loop apps. Sign in securely with email or Google and manage your Starknet assets." },
      ...loopPreviewMeta,
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
