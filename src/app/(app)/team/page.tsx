"use client";
import { useState } from "react";
import { Ban, CalendarCheck, CalendarX, Check, Info, Minus, Search, Shield, ShieldCheck, UserPlus } from "lucide-react";
import { AvailPill } from "@/components/team/avail-pill";
import { api, fieldErrors } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { useCan, useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Loading, Modal, Note, PageHead, Pill, SelectField, Who } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface User {
  id: string; name: string; email: string; base_role: "owner" | "admin" | "user"; role_id: string | null; role_name: string | null;
  availability: string; active: boolean; open_leads: number; max_open_leads: number; eligible: boolean; eligibility_reason: string;
  telegram_connected: boolean; calendar_connected: boolean;
}
interface Role { id: string; name: string; permissions: string[]; members: number }
interface Perm { key: string; label: string }

export default function TeamPage() {
  const me = useMe();
  const can = useCan();
  const toast = useToast();
  const users = useApi<{ users: User[] }>("/api/team/users", { pollMs: 8000 });
  const roles = useApi<{ roles: Role[]; permissions: Perm[] }>("/api/team/roles");
  const [q, setQ] = useState("");
  const [inviting, setInviting] = useState(false);
  const isOwner = me.user.baseRole === "owner";

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    try { await api(`/api/team/users/${id}`, { method: "PATCH", body }); toast(ok); users.reload(); roles.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  async function setAvail(id: string, availability: string) {
    try {
      const r = await api<{ reassigned: number }>(`/api/team/users/${id}/availability`, { method: "PUT", body: { availability } });
      toast(r.reassigned ? `Status updated · ${r.reassigned} unacknowledged lead(s) reassigned` : "Status updated"); refreshAll();
    } catch (e) { toast((e as Error).message, "error"); }
  }
  async function togglePerm(role: Role, key: string) {
    const next = role.permissions.includes(key) ? role.permissions.filter((p) => p !== key) : [...role.permissions, key];
    try { await api(`/api/team/roles/${role.id}`, { method: "PUT", body: { name: role.name, permissions: next } }); toast(`${role.name}: permission ${role.permissions.includes(key) ? "removed" : "granted"}`); roles.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }

  const list = users.data?.users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())) ?? [];
  const count = (s: string) => users.data?.users.filter((u) => u.availability === s).length ?? 0;

  return (
    <>
      <PageHead title="Team" sub="Employees, permissions and availability that drive lead assignment."
        actions={can("users.manage") && <Btn variant="pri" onClick={() => setInviting(true)}><UserPlus size={16} />Invite employee</Btn>} />
      <section className="card">
        <div className="fbar">
          <div className="search"><Search size={16} /><label className="sr" htmlFor="tq">Search team</label><input id="tq" placeholder="Search employees" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {["available", "busy", "on_leave", "offline"].map((s) => <span key={s} className="row" style={{ gap: 4 }}><AvailPill v={s} /><span className="faint">{count(s)}</span></span>)}
        </div>
        {users.error && <div className="cb"><ErrorBox>{users.error.message}</ErrorBox></div>}
        {!users.data ? <Loading /> : (
          <div className="tw"><table className="stk">
            <thead><tr><th scope="col">Employee</th><th scope="col">Level</th><th scope="col">Role</th><th scope="col">Availability</th><th scope="col">Open leads</th><th scope="col">Assignment eligibility</th><th scope="col">Calendar</th><th scope="col">Escalation alerts</th></tr></thead>
            <tbody>
              {list.map((u) => {
                const editable = can("users.manage") && u.base_role !== "owner" && (isOwner || u.base_role !== "admin");
                return (
                  <tr key={u.id}>
                    <td data-l="Employee"><Who name={u.name} sub={u.email} /></td>
                    <td data-l="Level">{editable && isOwner ? (
                      <select aria-label={`Level for ${u.name}`} className="sel-c" value={u.base_role} onChange={(e) => patch(u.id, { baseRole: e.target.value }, "Level updated")}>
                        <option value="admin">Admin</option><option value="user">User</option></select>
                    ) : <Pill tone={u.base_role === "owner" ? "blue" : "gray"}>{u.base_role}</Pill>}</td>
                    <td data-l="Role">{u.base_role === "owner" ? <Pill tone="purple" icon={<Shield size={12} />}>All permissions</Pill> : editable ? (
                      <select aria-label={`Role for ${u.name}`} className="sel-c" value={u.role_id ?? ""} onChange={(e) => patch(u.id, { roleId: e.target.value || null }, "Role updated")}>
                        <option value="">No role (no permissions)</option>{roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                    ) : u.role_name ?? "—"}</td>
                    <td data-l="Availability">{(u.id === me.user.id || can("leads.assign")) ? (
                      <select aria-label={`Availability for ${u.name}`} className="sel-c" value={u.availability} onChange={(e) => setAvail(u.id, e.target.value)}>
                        <option value="available">Available</option><option value="busy">Busy</option><option value="on_leave">On leave</option><option value="offline">Offline</option></select>
                    ) : <AvailPill v={u.availability} />}</td>
                    <td data-l="Open leads"><b className="num">{u.open_leads}</b> <span className="faint">/ {u.max_open_leads}</span></td>
                    <td data-l="Eligibility">{u.eligible ? <Pill tone="green" icon={<Check size={12} />}>Eligible</Pill> : <Pill tone="gray" icon={<Ban size={12} />}>{u.eligibility_reason}</Pill>}</td>
                    <td data-l="Calendar">{u.calendar_connected ? <Pill tone="green" icon={<CalendarCheck size={12} />}>Connected</Pill> : <Pill tone="amber" icon={<CalendarX size={12} />}>Not connected</Pill>}</td>
                    <td data-l="Alerts">{u.telegram_connected ? <Pill tone="green">Telegram set</Pill> : <span className="faint">Not set</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </section>

      <AlertDestination />

      <section className="card mt">
        <header><h2><ShieldCheck size={16} />Roles &amp; permissions</h2>{!isOwner && <span className="faint">Only the Owner can change permissions</span>}</header>
        <div className="cb"><Note>“Manager” is a permission set, not a hard-coded level. The Owner always has every permission; Admins and Users get exactly their role’s permissions. Every check is enforced by the server.</Note></div>
        {!roles.data ? <Loading /> : (
          <div className="tw"><table className="matrix">
            <thead><tr><th scope="col">Permission</th><th scope="col">Owner</th>{roles.data.roles.map((r) => <th key={r.id} scope="col">{r.name} <span className="faint">({r.members})</span></th>)}</tr></thead>
            <tbody>
              {roles.data.permissions.map((p) => (
                <tr key={p.key}>
                  <td><b>{p.label}</b><small><code>{p.key}</code></small></td>
                  <td><span className="up" aria-label="Allowed"><Check size={16} /></span></td>
                  {roles.data!.roles.map((r) => (
                    <td key={r.id}>
                      {isOwner ? <input type="checkbox" aria-label={`${r.name}: ${p.label}`} checked={r.permissions.includes(p.key)} onChange={() => togglePerm(r, p.key)} />
                        : r.permissions.includes(p.key) ? <span className="up" aria-label="Allowed"><Check size={16} /></span> : <span className="faint" aria-label="Not allowed"><Minus size={16} /></span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
      {inviting && <InviteModal roles={roles.data?.roles ?? []} onClose={() => setInviting(false)} />}
    </>
  );
}

function AlertDestination() {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("chat") ?? "").trim();
    setBusy(true); setErr(undefined);
    try { await api(`/api/team/users/${me.user.id}`, { method: "PATCH", body: { telegramChatId: v || null } }); toast(v ? "Escalation alert destination saved" : "Destination removed"); refreshAll(); }
    catch (e2) { setErr(fieldErrors(e2).telegramChatId ?? (e2 as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className="card mt">
      <header><h2><Info size={16} />My escalation alerts (I4 · Telegram)</h2></header>
      <form className="cb row wrap" style={{ alignItems: "flex-end" }} onSubmit={save}>
        <div style={{ flex: 1, minWidth: 220 }}><Field id="chat" name="chat" label="My Telegram chat ID" hint="Send /start to the workspace bot, then enter the numeric chat ID it replies with." inputMode="numeric" error={err} /></div>
        <Btn busy={busy} type="submit" style={{ marginBottom: 12 }}>Save destination</Btn>
      </form>
    </section>
  );
}

function InviteModal({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [link, setLink] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      const r = await api<{ inviteUrl: string }>("/api/team/invitations", { body: { email: f.get("email"), name: f.get("name"), baseRole: f.get("baseRole"), roleId: f.get("roleId") || null } });
      setLink(r.inviteUrl); toast("Invitation created"); refreshAll();
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Invite employee" onClose={onClose} footer={link ? <Btn variant="pri" onClick={onClose}>Done</Btn> : <><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="inv"><UserPlus size={16} />Create invitation</Btn></>}>
      {link ? (
        <>
          <p style={{ marginBottom: 10 }}>Share this one-time link with the employee. It expires in 7 days.</p>
          <div className="row"><input className="inp" readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
            <Btn onClick={() => { navigator.clipboard?.writeText(link).then(() => toast("Link copied"), () => {}); }}>Copy</Btn></div>
          <div style={{ marginTop: 12 }}><Note>Email delivery of invitations is not part of this build; share the link directly.</Note></div>
        </>
      ) : (
        <form id="inv" onSubmit={submit} noValidate>
          {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
          <Field id="inv-name" name="name" label="Name *" required error={errs.name} />
          <Field id="inv-email" name="email" type="email" label="Email *" required error={errs.email} />
          <div className="grid g2">
            <SelectField id="inv-level" name="baseRole" label="Level" defaultValue="user"><option value="user">User</option>{me.user.baseRole === "owner" && <option value="admin">Admin</option>}</SelectField>
            <SelectField key={roles.length} id="inv-role" name="roleId" label="Role (permission set)" defaultValue={roles.find((r) => r.name === "Sales")?.id ?? ""}
              hint="Without a role the employee can still see and act on leads assigned to them.">
              <option value="">No role</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>
          </div>
        </form>
      )}
    </Modal>
  );
}
