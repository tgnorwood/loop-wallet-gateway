import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-admin";

export function AppHeader() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const link = "whitespace-nowrap rounded-md px-2 py-1.5 transition-colors hover:text-foreground sm:px-3";
  const active = { className: "bg-secondary text-foreground" };
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
        <Link to="/dashboard" className="flex items-center gap-2 whitespace-nowrap font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[oklch(0.62_0.2_275)] to-[oklch(0.7_0.17_200)] font-mono text-xs text-white">LW</span>
          <span className="hidden sm:inline">Loop Wallet</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link to="/" activeOptions={{ exact: true }} activeProps={active} className={link}>Wallet</Link>
          <Link to="/dashboard" activeProps={active} className={link}>Dashboard</Link>
          {isAdmin && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Link to="/admin" activeProps={active} className={link}>Admin</Link>
              <Link to="/demo" activeProps={active} className={link}>Sandbox</Link>
              <Link to="/docs" activeProps={active} className={link}>Docs</Link>
            </>
          )}
        </nav>
        {user ? (
          <button onClick={() => supabase.auth.signOut()} className="ml-auto whitespace-nowrap text-sm text-muted-foreground hover:text-foreground">Sign out</button>
        ) : (
          <Link to="/" className="ml-auto whitespace-nowrap text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        )}
      </div>
    </header>
  );
}
