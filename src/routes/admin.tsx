import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { AdminOnly } from "@/components/AdminOnly";
import { AdminConsole } from "@/components/DashboardPage";
import { AdminStats } from "@/components/AdminStats";
import { ConnectedApps } from "@/components/AdminApps";
import { IssuesBanner } from "@/components/AdminIssues";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loopPreviewMeta } from "@/lib/branding";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      ...loopPreviewMeta,
      { title: "Admin console — Loop Wallet Hub" },
      { name: "description", content: "Manage partner apps, keys, domains and wallet security." },
      { property: "og:title", content: "Admin console — Loop Wallet Hub" },
      { property: "og:description", content: "Manage partner apps, keys, domains and wallet security." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const tab = "rounded-md px-4 py-1.5 text-sm";
  return (
    <div className="min-h-screen">
      <AppHeader />
      <AdminOnly>
        <div className="mx-auto max-w-6xl px-4 pt-6"><IssuesBanner /></div>
        <Tabs defaultValue="stats" id="admin-tabs">
          <div className="mx-auto max-w-6xl px-4 pt-6">
            <TabsList>
              <TabsTrigger value="stats" className={tab}>Stats</TabsTrigger>
              <TabsTrigger value="logs" className={tab}>Logs</TabsTrigger>
              <TabsTrigger value="apps" className={tab}>Connected apps</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="stats"><AdminStats /></TabsContent>
          <TabsContent value="logs"><AdminConsole /></TabsContent>
          <TabsContent value="apps"><ConnectedApps /></TabsContent>
        </Tabs>
      </AdminOnly>
    </div>
  );
}
