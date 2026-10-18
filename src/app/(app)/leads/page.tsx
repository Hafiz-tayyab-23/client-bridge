"use client";
// TEMPORARY Leads screen: list with live countdowns, acknowledge, manual entry.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { useMe } from "@/components/temp/app-shell";
import { Button, Field, Notice } from "@/components/temp/ui";
import { Countdown } from "@/components/temp/countdown";

export interface LeadRow {
  id: string; title: string; source: string; status: string; owner_id: string | null; owner_name: string | null;
  contact_name: string | null; ack_deadline: string | null; escalation_count: number; chain_exhausted: boolean; created_at: string;
}

export default function LeadsPage() {
  const me = useMe();
  const [data, setData] = useState<{ leads: LeadRow[]; total: number; page: number; pageSize: number; serverTime: string } | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("open");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/leads?page=${page}&pageSize=25${status ? `&status=${status}` : ""}`));
    } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
  }, [page, status]);
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("app:refresh", h);
    const t = setInterval(load, 5000);
    return () => { window.removeEventListener("app:refresh", h); clearInterval(t); };
  }, [load]);

  async function ack(id: string) {
    setBusy(id); setMsg(null);
    try { await api(`/api/leads/${id}/acknowledge`, { method: "POST" }); setMsg({ kind: "success", text: "Lead acknowledged." }); await load(); }
    catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(null); }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy("new"); setErrs({}); setMsg(null);
    try {
      await api("/api/leads", { body: { name: f.get("name"), email: f.get("email"), phone: f.get("phone"), message: f.get("message") } });
      form.reset(); setMsg({ kind: "success", text: "Lead created and assigned." }); await load();
    } catch (err) { setMsg({ kind: "error", text: (err as Error).message }); setErrs(fieldErrors(err)); }
    finally { setBusy(null); }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Leads</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm" htmlFor="st">Status</label>
        <select id="st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded border px-2 py-1">
          <option value="open">Open</option><option value="assigned">Awaiting acknowledgement</option>
          <option value="acknowledged">Acknowledged</option><option value="closed">Closed</option><option value="">All</option>
        </select>
      </div>
      {!data ? <p role="status">Loading leads…</p> : data.leads.length === 0 ? <p>No leads match. Create one below or submit the public form.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b text-left"><th className="py-1">Lead</th><th>Source</th><th>Owner</th><th>Status</th><th>Time left</th><th>Escalations</th><th>Action</th></tr></thead>
            <tbody>
              {data.leads.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-1"><Link className="underline" href={`/leads/${l.id}`}>{l.title}</Link></td>
                  <td>{l.source.replace("_", " ")}</td>
                  <td>{l.owner_name ?? "—"}{l.owner_id === me.user.id && " (you)"}</td>
                  <td>{l.status}{l.chain_exhausted && " · chain exhausted"}</td>
                  <td>{l.status === "assigned" && l.ack_deadline ? <Countdown deadline={l.ack_deadline} serverTime={data.serverTime} /> : "—"}</td>
                  <td>{l.escalation_count}</td>
                  <td>{l.status === "assigned" && l.owner_id === me.user.id && <Button busy={busy === l.id} onClick={() => ack(l.id)} className="py-1 text-sm">Acknowledge</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <button className="underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages} · {data.total} leads</span>
            <button className="underline disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
      {me.user.permissions.includes("crm.create") && (
        <section aria-labelledby="new-h" className="max-w-md">
          <h2 id="new-h" className="mb-2 text-lg font-semibold">Manual lead entry</h2>
          <form onSubmit={create} className="flex flex-col gap-3" noValidate>
            <Field id="l-name" name="name" label="Customer name" required error={errs.name} />
            <Field id="l-email" name="email" type="email" label="Email" error={errs.email} />
            <Field id="l-phone" name="phone" label="Phone (+923001234567)" error={errs.phone} />
            <Field id="l-msg" name="message" label="Note" error={errs.message} />
            <Button busy={busy === "new"} type="submit">Create lead</Button>
          </form>
        </section>
      )}
    </div>
  );
}
