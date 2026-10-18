"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Check, Clock, Inbox, LifeBuoy, Plus, Search, Siren, TriangleAlert } from "lucide-react";
import { api, fieldErrors } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime, sourceLabel } from "@/lib/format";
import { useCan, useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Ico, Loading, Modal, Note, PageHead, Pager, Pill, type Tone } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Countdown, leadState, RecoveryPill, useServerNow, type LeadRow } from "@/components/leads/lead-bits";
import { LeadPanel } from "@/components/leads/lead-panel";

type Counts = Record<"all" | "unack" | "ack" | "overdue" | "escalated" | "recovery" | "open", number>;
const SUMMARY: [keyof Counts, string, React.ReactNode, Tone | ""][] = [
  ["all", "All leads", <Inbox key="i" size={16} />, ""],
  ["unack", "Unacknowledged", <Clock key="c" size={16} />, "amber"],
  ["ack", "Acknowledged", <Check key="k" size={16} />, "green"],
  ["overdue", "Overdue", <TriangleAlert key="t" size={16} />, "red"],
  ["escalated", "Escalated", <Siren key="s" size={16} />, "red"],
  ["recovery", "Recovery queue", <LifeBuoy key="l" size={16} />, "pink"],
];

function LeadsScreen() {
  const sp = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const state = sp.get("state") ?? "all";
  const sel = sp.get("id");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const qs = new URLSearchParams({ state, page: String(page), pageSize: "25" });
  if (q) qs.set("q", q);
  if (source) qs.set("source", source);
  if (owner) qs.set("ownerId", owner);
  const createdFrom = sp.get("createdFrom");
  const escalated = sp.get("escalated");
  if (createdFrom) qs.set("createdFrom", createdFrom);
  if (escalated) qs.set("escalatedWithinHours", escalated);
  const list = useApi<{ leads: LeadRow[]; total: number; page: number; pageSize: number; serverTime: string }>(`/api/leads?${qs}`, { pollMs: 5000 });
  const counts = useApi<{ counts: Counts }>("/api/leads/summary", { pollMs: 5000 });
  const users = useApi<{ users: { id: string; name: string }[] }>("/api/team/users");
  const now = useServerNow(list.data?.serverTime);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    router.replace(`/leads?${n}`, { scroll: false });
  };

  async function ack(id: string) {
    try { await api(`/api/leads/${id}/acknowledge`, { method: "POST" }); toast("Lead acknowledged"); refreshAll(); }
    catch (e) { toast((e as Error).message, "error"); refreshAll(); }
  }

  return (
    <>
      <PageHead title="Leads" sub="Every lead has one accountable owner and a clock. The server escalates ignored leads automatically, even when nobody has the app open."
        actions={can("crm.create") && <Btn variant="pri" onClick={() => setAdding(true)}><Plus size={16} />Add lead</Btn>} />
      <div className="grid g6 kp" role="group" aria-label="Filter by lead state">
        {SUMMARY.map(([k, label, icon, tone]) => (
          <button key={k} className="card kpi" style={{ textAlign: "left", ...(state === k ? { borderColor: "var(--p)", boxShadow: "0 0 0 2px var(--p-l)" } : {}) }}
            aria-pressed={state === k} onClick={() => { setPage(1); setParam("state", k === "all" ? null : k); }}>
            <div className="l"><Ico tone={tone || undefined}>{icon}</Ico>{label}</div>
            <div className="v num">{counts.data ? counts.data.counts[k] : "–"}</div>
          </button>
        ))}
      </div>
      <div className="split mt">
        <section className="card" aria-label="Lead list">
          <div className="fbar">
            <div className="search"><Search size={16} /><label className="sr" htmlFor="lq">Search leads</label>
              <input id="lq" placeholder="Search name, company, email, phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
            <label className="sr" htmlFor="lsrc">Source</label>
            <select id="lsrc" className="sel-c" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
              <option value="">All sources</option><option value="web_form">Web form</option><option value="message">Telegram message</option><option value="manual">Manual entry</option>
            </select>
            {can("crm.view_all") && <>
              <label className="sr" htmlFor="lown">Owner</label>
              <select id="lown" className="sel-c" value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }}>
                <option value="">All owners</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </>}
            {createdFrom && <button className="chip" aria-pressed="true" onClick={() => setParam("createdFrom", null)}>Created today ✕</button>}
            {escalated && <button className="chip" aria-pressed="true" onClick={() => setParam("escalated", null)}>Escalated in last {escalated}h ✕</button>}
            <span className="badge-live" style={{ marginLeft: "auto" }}><span className="dot" />Live</span>
          </div>
          {list.error && <div className="cb"><ErrorBox>{list.error.message}</ErrorBox></div>}
          {!list.data ? <Loading label="Loading leads…" /> : (
            <div className="tw">
              <table className="stk">
                <thead><tr><th scope="col">Lead</th><th scope="col">Source</th><th scope="col">Owner</th><th scope="col">Assigned</th><th scope="col">Time remaining</th><th scope="col">Status</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
                <tbody>
                  {list.data.leads.length === 0 && <tr><td colSpan={7} className="empty">{state === "recovery" ? "Nothing needs recovery right now." : "No leads match these filters."}</td></tr>}
                  {list.data.leads.map((l) => {
                    const s = leadState(l, now);
                    return (
                      <tr key={l.id} className={`clk ${s.row} ${sel === l.id ? "sel" : ""}`} tabIndex={0} aria-label={`Open ${l.contact_name ?? l.title}`}
                        onClick={() => setParam("id", l.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setParam("id", l.id); } }}>
                        <td data-l="Lead"><b>{l.contact_name ?? l.title}</b><small>{l.company_name ?? l.contact_email ?? l.contact_phone ?? "—"}</small></td>
                        <td data-l="Source">{sourceLabel(l.source)}</td>
                        <td data-l="Owner">{l.owner_name ?? "—"}{l.owner_id === me.user.id && <small>You</small>}</td>
                        <td data-l="Assigned">{dateTime(l.assigned_at)}</td>
                        <td data-l="Time remaining"><Countdown deadline={l.ack_deadline} now={now} status={l.status} /></td>
                        <td data-l="Status"><div className="row wrap" style={{ gap: 4 }}><Pill tone={s.tone} icon={s.icon}>{s.label}</Pill><RecoveryPill reasons={l.recovery_reasons} /></div></td>
                        <td data-l="Actions" onClick={(e) => e.stopPropagation()}>
                          {l.status === "assigned" && l.owner_id === me.user.id && <Btn size="sm" variant="pri" onClick={() => ack(l.id)}><Check size={14} />Acknowledge</Btn>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
            </div>
          )}
        </section>
        <div className={`dpanel ${sel ? "open" : ""}`}>
          {sel ? <LeadPanel id={sel} onClose={() => setParam("id", null)} /> : (
            <aside className="card"><div className="cb"><Note>Select a lead to see its owner, acknowledgement window, escalation chain and history.</Note></div></aside>
          )}
        </div>
      </div>
      {adding && <AddLeadModal onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setParam("id", id); refreshAll(); }} />}
    </>
  );
}

function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      const r = await api<{ leadId: string; ownerId: string }>("/api/leads", { body: { name: f.get("name"), email: f.get("email"), phone: f.get("phone"), message: f.get("message"), title: f.get("title") || undefined } });
      toast("Lead created and assigned by the server");
      onCreated(r.leadId);
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); setBusy(false); }
  }
  return (
    <Modal title="Add lead" onClose={onClose} footer={<><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="nl"><Plus size={16} />Create lead</Btn></>}>
      <form id="nl" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        <div className="grid g2"><Field id="nl-name" name="name" label="Customer name *" required error={errs.name} /><Field id="nl-title" name="title" label="Lead title" hint="Optional" error={errs.title} /></div>
        <div className="grid g2"><Field id="nl-phone" name="phone" label="Phone" placeholder="+923001234567" inputMode="tel" error={errs.phone} /><Field id="nl-email" name="email" type="email" label="Email" error={errs.email} /></div>
        <Field id="nl-msg" name="message" label="Note" error={errs.message} />
        <Note>Source: manual entry. The server assigns the owner by round-robin among Available employees under the open-lead limit, and starts the acknowledgement window.</Note>
      </form>
    </Modal>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<Loading />}><LeadsScreen /></Suspense>;
}
