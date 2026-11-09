import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Loop Wallet Hub" },
      { name: "description", content: "Choose a new password for your Loop Wallet account." },
      { property: "og:title", content: "Reset password — Loop Wallet Hub" },
      { property: "og:description", content: "Choose a new password for your Loop Wallet account." },
    ],
  }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const nav = useNavigate();
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const { error } = await supabase.auth.updateUser({ password: pw });
          if (error) { toast.error(error.message); return; }
          toast.success("Password updated");
          nav({ to: "/" });
        }}
      >
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <Input type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" />
        <Button className="w-full" type="submit">Update password</Button>
      </form>
    </main>
  );
}
