import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { sql } from "@/server/db";
import { me } from "@/server/services/accounts";
import { AppShell } from "@/components/temp/app-shell";

// Server-side guard: every page in this group requires a valid session.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const [ws] = await sql`select id, name, timezone from workspaces where id = ${actor.workspaceId}`;
  const [u] = await sql`select availability from users where id = ${actor.id}`;
  return (
    <AppShell me={{ user: me(actor), workspace: { id: ws.id, name: ws.name, timezone: ws.timezone } }} availability={u.availability}>
      {children}
    </AppShell>
  );
}
