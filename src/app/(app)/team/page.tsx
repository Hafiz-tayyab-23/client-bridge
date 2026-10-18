"use client";
// TEMPORARY Team screen: users, levels/roles, permissions editor (Owner), invitations.
import { useCallback, useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { useMe } from "@/components/temp/app-shell";
import { Button, Field, Notice, Select } from "@/components/temp/ui";

interface User { id: string; name: string; email: string; base_role: string; role_id: string | null; role_name: string | null; availability: string; active: boolean; open_leads: number; telegram_connected: boolean }
interface Role { id: string; name: string; permissions: string[]; members: number }
interface Perm { key: string; label: string }

export default function TeamPage() {
  const me = useMe();
  const perms = new Set(me.user.permissions);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Perm[]>([]);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api<{ users: User[] }>("/api/team/users"), api<{ roles: Role[]; permissions: Perm[] }>("/api/team/roles")]);
      setUsers(u.users); setRoles(r.roles); setCatalog(r.permissions);
    } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg({ kind: "success", text: ok }); await load(); }
    catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  }

  async function sendInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setErrs({}); setMsg(null); setInviteUrl(null);
    try {
      const r = await api<{ inviteUrl: string }>("/api/team/invitations", {
        body: { email: f.get("email"), name: f.get("name"), baseRole: f.get("baseRole"), roleId: f.get("roleId") || null },
      });
      setInviteUrl(r.inviteUrl); form.reset();
      setMsg({ kind: "success", text: "Invitation created. Share the link below with the new user." });
    } catch (err) { setMsg({ kind: "error", text: (err as Error).message }); setErrs(fieldErrors(err)); }
    finally { setBusy(false); }
  }

  function togglePerm(role: Role, key: string) {
    const next = role.permissions.includes(key) ? role.permissions.filter((p) => p !== key) : [...role.permissions, key];
    act(() => api(`/api/team/roles/${role.id}`, { method: "PUT", body: { name: role.name, permissions: next } }), `Updated ${role.name}.`);
  }

  if (loading) return <p role="status">Loading team…</p>;
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Team</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <section aria-labelledby="users-h" className="overflow-x-auto">
        <h2 id="users-h" className="mb-2 text-lg font-semibold">Users</h2>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead><tr className="border-b text-left"><th className="py-1">Name</th><th>Level</th><th>Role</th><th>Status</th><th>Open leads</th><th>Telegram</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-1">{u.name}<br /><span className="text-xs">{u.email}</span></td>
                <td>
                  {u.base_role === "owner" || !perms.has("users.manage") ? u.base_role : (
                    <select aria-label={`Level for ${u.name}`} value={u.base_role} className="rounded border px-1"
                      onChange={(e) => act(() => api(`/api/team/users/${u.id}`, { method: "PATCH", body: { baseRole: e.target.value } }), "Level updated.")}>
                      <option value="admin">admin</option><option value="user">user</option>
                    </select>
                  )}
                </td>
                <td>
                  {u.base_role === "owner" ? "All permissions" : !perms.has("users.manage") ? u.role_name ?? "—" : (
                    <select aria-label={`Role for ${u.name}`} value={u.role_id ?? ""} className="rounded border px-1"
                      onChange={(e) => act(() => api(`/api/team/users/${u.id}`, { method: "PATCH", body: { roleId: e.target.value || null } }), "Role updated.")}>
                      <option value="">No role (no permissions)</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </td>
                <td>
                  {perms.has("leads.assign") && u.id !== me.user.id ? (
                    <select aria-label={`Status for ${u.name}`} value={u.availability} className="rounded border px-1"
                      onChange={(e) => act(() => api(`/api/team/users/${u.id}/availability`, { method: "PUT", body: { availability: e.target.value } }), "Status updated.")}>
                      <option value="available">Available</option><option value="busy">Busy</option><option value="on_leave">On leave</option><option value="offline">Offline</option>
                    </select>
                  ) : u.availability.replace("_", " ")}
                </td>
                <td>{u.open_leads}</td>
                <td>{u.telegram_connected ? "✓ set" : "not set"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <TelegramSelf />

      {perms.has("users.manage") && (
        <section aria-labelledby="inv-h" className="max-w-md">
          <h2 id="inv-h" className="mb-2 text-lg font-semibold">Invite a user</h2>
          <form onSubmit={sendInvite} className="flex flex-col gap-3" noValidate>
            <Field id="inv-name" name="name" label="Name" required error={errs.name} />
            <Field id="inv-email" name="email" type="email" label="Email" required error={errs.email} />
            <Select id="inv-level" name="baseRole" label="Level" defaultValue="user">
              <option value="user">User</option>
              {me.user.baseRole === "owner" && <option value="admin">Admin</option>}
            </Select>
            <Select id="inv-role" name="roleId" label="Role (permission set)" defaultValue={roles.find((r) => r.name === "Sales")?.id ?? ""}>
              <option value="">No role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Button busy={busy} type="submit">Create invitation</Button>
          </form>
          {inviteUrl && (
            <p className="mt-2 break-all text-sm">Invite link (open in a private window to accept): <a className="underline" href={inviteUrl}>{inviteUrl}</a></p>
          )}
        </section>
      )}

      <section aria-labelledby="roles-h" className="overflow-x-auto">
        <h2 id="roles-h" className="mb-1 text-lg font-semibold">Roles and permissions</h2>
        <p className="mb-2 text-sm">{me.user.baseRole === "owner" ? "As Owner you can grant or remove each permission." : "Only the Owner can change role permissions."}</p>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead><tr className="border-b text-left"><th className="py-1">Permission</th>{roles.map((r) => <th key={r.id}>{r.name} ({r.members})</th>)}</tr></thead>
          <tbody>
            {catalog.map((p) => (
              <tr key={p.key} className="border-b">
                <td className="py-1">{p.label}<br /><code className="text-xs">{p.key}</code></td>
                {roles.map((r) => (
                  <td key={r.id}>
                    <input type="checkbox" aria-label={`${r.name}: ${p.label}`} checked={r.permissions.includes(p.key)}
                      disabled={me.user.baseRole !== "owner"} onChange={() => togglePerm(r, p.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TelegramSelf() {
  const me = useMe();
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("chat") ?? "").trim();
    setBusy(true); setMsg(null);
    try {
      await api(`/api/team/users/${me.user.id}`, { method: "PATCH", body: { telegramChatId: v || null } });
      setMsg({ kind: "success", text: v ? "Telegram destination saved." : "Telegram destination removed." });
    } catch (err) { setMsg({ kind: "error", text: (err as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="tg-h" className="max-w-md">
      <h2 id="tg-h" className="mb-2 text-lg font-semibold">My escalation alerts (Telegram)</h2>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field id="chat" name="chat" label="My Telegram chat ID (numeric)" inputMode="numeric" />
        <Button busy={busy} type="submit">Save destination</Button>
      </form>
      {msg && <div className="mt-2"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
    </section>
  );
}
