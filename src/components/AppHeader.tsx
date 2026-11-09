import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function AppHeader() {
  const { user } = useAuth();
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary font-mono text-xs text-primary-foreground">LW</span>
          Loop Wallet
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "text-foreground" }}>Portal</Link>
          <Link to="/demo" activeProps={{ className: "text-foreground" }}>Sandbox</Link>
          <Link to="/admin" activeProps={{ className: "text-foreground" }}>Admin</Link>
          <Link to="/dashboard" activeProps={{ className: "text-foreground" }}>Dashboard</Link>
          <Link to="/docs" activeProps={{ className: "text-foreground" }}>Docs</Link>
        </nav>
        {user && (
          <button onClick={() => supabase.auth.signOut()} className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
