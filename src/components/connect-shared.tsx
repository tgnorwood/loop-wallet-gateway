import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAppPublic } from "@/lib/wallet/portal.functions";

export function usePartnerApp(appId?: string) {
  const fetchApp = useServerFn(getAppPublic);
  const [app, setApp] = useState<{ id: string; name: string; popup_enabled: boolean } | null | undefined>(undefined);
  useEffect(() => {
    if (!appId) return setApp(null);
    fetchApp({ data: { appId } }).then(setApp).catch(() => setApp(null));
  }, [appId]);
  return app;
}

export function reply(origin: string, msg: Record<string, unknown>) {
  window.opener?.postMessage({ source: "loop-wallet", ...msg }, origin);
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center px-4 py-8">{children}</main>;
}
