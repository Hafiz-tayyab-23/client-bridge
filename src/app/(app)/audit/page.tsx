"use client";
import { useState } from "react";
import { ArrowRight, Cpu, Lock } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { ErrorBox, Field, Loading, PageHead, Pager, Pill, SelectField, Who } from "@/components/ui/primitives";

interface Entry { id: number; actor_id: string | null; actor_label: string; event: string; target_type: string; target_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; created_at: string }

function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].slice(0, 6);
  if (!keys.length) return <span className="faint">—</span>;
  const fmt = (v: unknown) => (v === undefined ? "—" : v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 60);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {keys.map((k) => (
        <div key={k} className="diff"><span className="faint">{k}:</span>
          {before && k in before && <del>{fmt(before[k])}</del>}{before && after && k in before && <ArrowRight size={12} />}{after && k in after && <ins>{fmt(after[k])}</ins>}
        </div>
      ))}
    </div>
  );
}

export default function AuditPage() {
  const [event, setEvent] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (event) qs.set("event", event);
  if (actor === "system") qs.set("system", "1"); else if (actor) qs.set("actorId", actor);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const data = useApi<{ entries: Entry[]; total: number; eventTypes: string[] }>(`/api/audit?${qs}`, { pollMs: 15000 });
  const users = useApi<{ users: { id: string; name: string }[] }>("/api/team/users");
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <>
      <PageHead title="Audit Log" sub="A tamper-resistant record of who changed what, and when." />
      <div className="banner blue card" style={{ borderRadius: "var(--r)", marginBottom: 16 }}><Lock size={16} /><span>Read-only. Entries cannot be edited or deleted — there is no endpoint for it, and the database rejects updates and deletes. Access requires the “View audit log” permission.</span></div>
      <section className="card">
        <div className="fbar" style={{ alignItems: "flex-end" }}>
          <div style={{ minWidth: 200 }}><SelectField id="aev" label="Event type" value={event} onChange={(e) => reset(() => setEvent(e.target.value))}>
            <option value="">All event types</option>{data.data?.eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}</SelectField></div>
          <div style={{ minWidth: 180 }}><SelectField id="aus" label="User" value={actor} onChange={(e) => reset(() => setActor(e.target.value))}>
            <option value="">All users</option><option value="system">System (automatic)</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField></div>
          <Field id="afr" type="date" label="From" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
          <Field id="ato" type="date" label="To" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </div>
        {data.error && <div className="cb"><ErrorBox>{data.error.message}</ErrorBox></div>}
        {!data.data ? <Loading /> : data.data.entries.length === 0 ? <div className="empty">No audit entries match.</div> : (
          <div className="tw"><table className="stk"><thead><tr><th scope="col">Event</th><th scope="col">Actor</th><th scope="col">Target</th><th scope="col">Before → After</th><th scope="col">Time</th></tr></thead>
            <tbody>{data.data.entries.map((a) => (
              <tr key={a.id}>
                <td data-l="Event"><b>{a.event}</b></td>
                <td data-l="Actor">{a.actor_id ? <Who name={a.actor_label.split(" <")[0]} sub={a.actor_label.match(/<(.*)>/)?.[1]} /> : <Pill icon={<Cpu size={12} />}>{a.actor_label === "system" ? "System" : `${a.actor_label} (removed)`}</Pill>}</td>
                <td data-l="Target">{a.target_type}<small><code>{a.target_id?.slice(0, 8) ?? "—"}</code></small></td>
                <td data-l="Change"><Diff before={a.before} after={a.after} /></td>
                <td data-l="Time" className="num">{dateTime(a.created_at)}</td>
              </tr>))}</tbody></table>
            <Pager page={page} pageSize={50} total={data.data.total} onPage={setPage} /></div>
        )}
      </section>
    </>
  );
}
