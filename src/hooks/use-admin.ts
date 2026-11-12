import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/wallet/portal.functions";
import { useAuth } from "@/hooks/use-auth";

/** True only for a signed-in admin. The server decides; this just hides links and pages from everyone else. */
export function useIsAdmin() {
  const { user, loading } = useAuth();
  const role = useServerFn(getMyRole);
  const q = useQuery({ queryKey: ["my-role", user?.id], queryFn: () => role(), enabled: !!user, staleTime: 60_000, retry: false });
  return { isAdmin: !!user && !!q.data?.isAdmin, loading: loading || (!!user && q.isLoading) };
}
