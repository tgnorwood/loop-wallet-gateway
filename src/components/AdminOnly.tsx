import type { ReactNode } from "react";
import { SignInCard } from "@/components/SignInCard";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-admin";

/** Wraps a page that only the admin should see. Everyone else gets a plain "not available" screen. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading } = useIsAdmin();
  if (authLoading || loading) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (!user) return <div className="grid place-items-center py-16"><SignInCard title="Admin sign in" /></div>;
  if (!isAdmin) return <main className="mx-auto max-w-md px-4 py-24 text-center"><h1 className="text-xl font-semibold">Not available</h1><p className="mt-2 text-sm text-muted-foreground">This page is only for the Loop Wallet admin.</p></main>;
  return <>{children}</>;
}
