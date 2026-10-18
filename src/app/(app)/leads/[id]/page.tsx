"use client";
// TEMPORARY lead detail: owner, countdown, assignment chain, activity history.
import { use, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/components/temp/app-shell";
import { Button, Notice } from "@/components/temp/ui";
import { Countdown } from "@/components/temp/countdown";

interface Detail {
  lead: { id: string; title: string; source: string; source_detail: string | null; status: string; owner_id: string | null; owner_name: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null; message: string | null; ack_deadline: string | null; escalation_count: number; chain_exhausted: boolean };
  assignments: { id: number; user_name: string | null; kind: string; level: number; reason: string; assigned_at: string; ended_at: string | null }[];
  activities: { id: number; type: string; summary: string; actor: string; created_at: string }[];
  absencePolicy: string;
  serverTime: string;
}

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const [d, setD] = useState<Detail | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canAssign = me.user.permissions.includes("leads.assign");

  const load = useCallback(async () => {
    try { setD(await api<Detail>(`/api/leads/${id}`)); } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  }, [id]);
  useEffect(() => {
    load();
    if (canAssign) api<{ users: { id: string; name: string }[] }>("/api/team/users").then((r) => setUsers(r.users)).catch(() => {});
    const h = () => load();
    window.addEventListener("app:refresh", h);
    const t = setInterval(load, 5000);
    return () => { window.removeEventListener("app:refresh", h); clearInterval(t); };
  }, [load, canAssign]);

  async function act(path: string, body?: unknown, ok = "Done.") {
    setBusy(true); setMsg(null);
    try { await api(path, { method: "POST", body }); setMsg({ kind: "success", text: ok }); await load(); }
    catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!d) return msg ? <Notice kind="error">{msg.text}</Notice> : <p role="status">Loading lead…</p>;
  const l = d.lead;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{l.title}</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>Source</dt><dd>{l.source.replace("_", " ")}{l.source_detail && !l.source_detail.startsWith("ip:") ? ` — ${l.source_detail}` : ""}</dd>
        <dt>Contact</dt><dd>{l.contact_name} {l.contact_phone} {l.contact_email}</dd>
        <dt>Accountable owner</dt><dd><strong>{l.owner_name ?? "—"}</strong></dd>
        <dt>Status</dt><dd>{l.status}{l.chain_exhausted && " (escalation chain exhausted)"}</dd>
        <dt>Time to acknowledge</dt><dd>{l.status === "assigned" && l.ack_deadline ? <Countdown deadline={l.ack_deadline} serverTime={d.serverTime} /> : "—"}</dd>
        <dt>Escalations</dt><dd>{l.escalation_count}</dd>
        {l.message && <><dt>Message</dt><dd>{l.message}</dd></>}
      </dl>
      <p className="text-sm">
        On leave / Offline policy: {d.absencePolicy === "keep_acknowledged"
          ? "unacknowledged leads move immediately; acknowledged leads stay with their owner."
          : "all open leads move immediately and must be re-acknowledged."}
      </p>
      <div className="flex flex-wrap gap-3">
        {l.status === "assigned" && l.owner_id === me.user.id && <Button busy={busy} onClick={() => act(`/api/leads/${id}/acknowledge`, undefined, "Acknowledged.")}>Acknowledge</Button>}
        {l.status !== "closed" && (l.owner_id === me.user.id || canAssign) && <Button busy={busy} onClick={() => act(`/api/leads/${id}/close`, undefined, "Lead closed.")}>Close lead</Button>}
      </div>
      {canAssign && l.status !== "closed" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); const u = new FormData(e.currentTarget).get("user"); if (u) act(`/api/leads/${id}/reassign`, { userId: u }, "Reassigned."); }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="ru" className="text-sm">Reassign to</label>
            <select id="ru" name="user" className="rounded border px-2 py-1">
              {users.filter((u) => u.id !== l.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <Button busy={busy} type="submit">Reassign</Button>
        </form>
      )}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Ownership history</h2>
        <ol className="list-decimal pl-5 text-sm">
          {d.assignments.map((a) => (
            <li key={a.id}>
              {a.user_name} — {a.kind} (level {a.level}) — {a.reason} — {new Date(a.assigned_at).toLocaleString()}
              {a.ended_at ? ` → ended ${new Date(a.ended_at).toLocaleTimeString()}` : " (current)"}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold">Activity</h2>
        <ul className="text-sm">
          {d.activities.map((a) => (
            <li key={a.id} className="border-b py-1">{new Date(a.created_at).toLocaleString()} · <strong>{a.actor}</strong> · {a.summary}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
