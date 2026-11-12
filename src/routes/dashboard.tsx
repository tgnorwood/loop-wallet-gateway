import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard is now the home page. Old links keep working.
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => { throw redirect({ to: "/", replace: true }); },
});
