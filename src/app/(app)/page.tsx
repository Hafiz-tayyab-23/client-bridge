"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { ArrowRight, Banknote, Briefcase, CalendarClock, ChartNoAxesColumn, LifeBuoy, Settings2, Siren, Timer, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { dateTime, duration, money } from "@/lib/format";
import { useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Ico, Loading, Modal, PageHead, Pill, Who, type Tone } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { LeadRow } from "@/components/leads/lead-bits";

interface Dash {
  scope: "company" | "personal"; timezone: string; today_start: string; hidden: string[];
  new_leads_today: number;
  open_pipeline: { value_masked: boolean; totals: { currency: string; value_cents: number }[] | null; by_stage: { id: string; name: string; pipeline: string; count: number; values: { currency: string; value_cents: number }[] | null }[] };
  avg_first_response_seconds: number | null; first_response_sample: number;
  recovery_queue: number; escalations_24h: number;
  availability: Record<string, number>;
  upcoming_appointments: { id: string; title: string; starts_at: string; contact_name: string | null; user_name: string | null }[];
  payments_month: { currency: string; collected_cents: number | null; count: number }[];
  generated_at: string;
}
const WIDGETS: [string, string][] = [
  ["new_leads", "New leads today"], ["pipeline", "Open pipeline value"], ["first_response", "Avg time to first response"],
  ["recovery", "Recovery queue"], ["escalations", "Escalations (24h)"], ["payments", "Payments received this month"],
  ["availability", "Employee availability"], ["appointments", "Upcoming appointments"],
];
const AVC: [string, string, string][] = [["available", "Available", "#22b07d"], ["busy", "Busy", "#3b82f6"], ["on_leave", "On leave", "#f0a020"], ["offline", "Offline", "#9aa1b5"]];

function Donut({ items, total }: { items: { v: number; col: string }[]; total: number }) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="donut" role="img" aria-label={`${total} team members`}>
      <svg viewBox="0 0 132 132"><circle cx="66" cy="66" r={R} fill="none" stroke="#f0f1f6" strokeWidth="16" />
        {total > 0 && items.map((i, k) => { const len = (i.v / total) * C; const el = <circle key={k} cx="66" cy="66" r={R} fill="none" stroke={i.col} strokeWidth="16" strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-off} />; off += len; return el; })}
      </svg>
      <div><b>{total}</b><small>members</small></div>
    </div>
  );
}

export default function Dashboard() {
  const me = useMe();
  const toast = useToast();
  const d = useApi<Dash>("/api/dashboard", { pollMs: 15000 });
  const rec = useApi<{ leads: LeadRow[] }>("/api/leads?state=recovery&pageSize=5", { pollMs: 15000 });
  const [custom, setCustom] = useState(false);

  if (d.error) return <><PageHead title="Operational Dashboard" /><ErrorBox>{d.error.message}</ErrorBox></>;
  if (!d.data) return <><PageHead title="Operational Dashboard" /><Loading label="Calculating figures from live records…" /></>;
  const x = d.data;
  const show = (k: string) => !x.hidden.includes(k);
  const teamTotal = AVC.reduce((a, [k]) => a + (x.availability[k] ?? 0), 0);
  const paid = x.payments_month;
  const multi = (list: { currency: string; value_cents?: number | null; collected_cents?: number | null }[] | null | undefined, empty = "PKR 0") =>
    !list || list.length === 0 ? empty : list.map((x) => money(x.value_cents ?? x.collected_cents ?? 0, x.currency)).join(" · ");
  const paidLabel = multi(paid);

  async function savePrefs(hidden: string[]) {
    try { await api("/api/dashboard/prefs", { method: "PUT", body: { hidden } }); toast("Dashboard layout saved"); d.reload(); setCustom(false); }
    catch (e) { toast((e as Error).message, "error"); }
  }

  const Kpi = ({ k, href, icon, tone, label, value, sub }: { k: string; href: string; icon: React.ReactNode; tone?: Tone; label: string; value: React.ReactNode; sub: React.ReactNode }) =>
    show(k) ? (
      <Link className="card kpi" href={href} aria-label={`${label}: open the matching records`}>
        <div className="l"><Ico tone={tone}>{icon}</Ico>{label}</div><div className="v num">{value}</div><div className="t">{sub}</div>
      </Link>
    ) : null;

  return (
    <>
      <PageHead title="Operational Dashboard"
        sub={<>{x.scope === "company" ? "Company-wide figures" : "Your personal figures"} from live records · updated {dateTime(x.generated_at, x.timezone)} ({x.timezone}). Click a figure to open its records.</>}
        actions={<><Pill tone={x.scope === "company" ? "purple" : "blue"}>{x.scope === "company" ? "Company scope" : "Personal scope"}</Pill><Btn onClick={() => setCustom(true)}><Settings2 size={16} />Customize</Btn></>} />
      <section className="grid g6 kp" aria-label="Key metrics">
        <Kpi k="new_leads" href={`/leads?createdFrom=${encodeURIComponent(x.today_start)}`} icon={<UserPlus size={16} />} label="New leads today" value={x.new_leads_today} sub="Since midnight, workspace time" />
        <Kpi k="pipeline" href="/crm?tab=opps" icon={<Briefcase size={16} />} tone="blue" label="Open pipeline value" value={x.open_pipeline.value_masked ? "Hidden" : multi(x.open_pipeline.totals)} sub={x.open_pipeline.value_masked ? "Requires value permission" : `${x.open_pipeline.by_stage.reduce((a, s) => a + s.count, 0)} open opportunities`} />
        <Kpi k="first_response" href="/leads?state=ack" icon={<Timer size={16} />} tone="green" label="Avg time to first response" value={duration(x.avg_first_response_seconds)} sub={`${x.first_response_sample} acknowledged leads · 30 days`} />
        <Kpi k="recovery" href="/leads?state=recovery" icon={<LifeBuoy size={16} />} tone="red" label="Recovery queue items" value={x.recovery_queue} sub="Overdue, escalated 2+, or idle" />
        <Kpi k="escalations" href="/leads?escalated=24" icon={<Siren size={16} />} tone="amber" label="Escalations (last 24h)" value={x.escalations_24h} sub="Automatic, excludes manual reassignment" />
        <Kpi k="payments" href="/payments?status=paid" icon={<Banknote size={16} />} tone="green" label="Payments received this month" value={paidLabel} sub={`${paid.reduce((a, p) => a + p.count, 0)} confirmed by Safepay, minus refunds${paid.length > 1 ? " · shown per currency" : ""}`} />
      </section>

      <div className="grid r32 mt">
        {show("pipeline") && (
          <section className="card" aria-labelledby="h-pipe">
            <header><h2 id="h-pipe"><ChartNoAxesColumn size={16} />Open pipeline by stage</h2><Link className="link" href="/crm?tab=opps">View board <ArrowRight size={14} /></Link></header>
            <div className="cb">
              {x.open_pipeline.by_stage.length === 0 ? <div className="empty">No open stages yet.</div> : x.open_pipeline.by_stage.map((s) => {
                const max = Math.max(1, ...x.open_pipeline.by_stage.map((t) => t.count));
                const v = s.count;
                return (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(96px,1fr) 3fr minmax(110px,1.2fr)", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line2)" }}>
                    <div><b>{s.name}</b><div className="faint">{s.pipeline} · {s.count} opps</div></div>
                    <div className="bar" role="img" aria-label={`${s.name}: ${s.count} opportunities`}><i style={{ width: `${(v / max) * 100}%` }} /></div>
                    <div className="right num"><b>{x.open_pipeline.value_masked ? `${s.count} opps` : multi(s.values, "—")}</b></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {show("availability") && (
          <section className="card" aria-labelledby="h-av">
            <header><h2 id="h-av"><Users size={16} />Employee availability</h2><Link className="link" href="/team">Team <ArrowRight size={14} /></Link></header>
            <div className="cb">
              <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
                <Donut total={teamTotal} items={AVC.map(([k, , col]) => ({ v: x.availability[k] ?? 0, col }))} />
                <ul className="legend grow" style={{ padding: 0, minWidth: 160 }}>
                  {AVC.map(([k, label, col]) => <li key={k}><span className="sq" style={{ background: col }} />{label}<span className="c num">{x.availability[k] ?? 0}</span></li>)}
                </ul>
              </div>
              <p className="faint" style={{ marginTop: 10 }}>{x.availability.available ?? 0} member(s) can receive new leads (subject to the open-lead limit).</p>
            </div>
          </section>
        )}
      </div>

      {show("recovery") && (
        <section className="card mt" aria-labelledby="h-rec">
          <header><h2 id="h-rec"><LifeBuoy size={16} />Lead recovery queue</h2><Link className="link" href="/leads?state=recovery">Open queue <ArrowRight size={14} /></Link></header>
          {!rec.data ? <Loading /> : rec.data.leads.length === 0 ? <div className="empty">Nothing needs recovery right now.</div> : (
            <div className="tw"><table className="stk"><thead><tr><th scope="col">Lead</th><th scope="col">Owner</th><th scope="col">Reason</th><th scope="col">Escalations</th></tr></thead>
              <tbody>{rec.data.leads.map((l) => (
                <tr key={l.id} className="lvl-red"><td data-l="Lead"><Link className="link" href={`/leads?state=recovery&id=${l.id}`}>{l.contact_name ?? l.title}</Link></td>
                  <td data-l="Owner">{l.owner_name ? <Who name={l.owner_name} /> : "—"}</td>
                  <td data-l="Reason"><div className="row wrap" style={{ gap: 4 }}>{l.recovery_reasons.map((r) => <Pill key={r} tone="red">{r}</Pill>)}</div></td>
                  <td data-l="Escalations">{l.escalation_count}</td></tr>))}</tbody></table></div>
          )}
        </section>
      )}

      <div className="grid g2 mt">
        {show("appointments") && (
          <section className="card" aria-labelledby="h-ap"><header><h2 id="h-ap"><CalendarClock size={16} />Upcoming appointments</h2><Link className="link" href="/calendar">Calendar</Link></header>
            {x.upcoming_appointments.length === 0 ? <div className="empty">No upcoming appointments.</div> : (
              <ul className="list">{x.upcoming_appointments.map((a) => <li key={a.id}><span className="tm">{dateTime(a.starts_at, x.timezone)}</span><div className="grow"><b>{a.contact_name ?? a.title}</b><span>{a.title} · {a.user_name}</span></div></li>)}</ul>
            )}</section>
        )}
        {show("payments") && (
          <section className="card" aria-labelledby="h-pay"><header><h2 id="h-pay"><Banknote size={16} />Collected this month</h2><Link className="link" href="/payments?status=paid">Payments</Link></header>
            <div className="cb">{paid.length === 0 ? <div className="empty">No confirmed payments this month.</div> : (
              <dl className="kv">{paid.map((p) => <Fragment key={p.currency}><dt>{p.currency.toUpperCase()} · {p.count} payment(s)</dt><dd className="num up">{money(p.collected_cents, p.currency)}</dd></Fragment>)}</dl>
            )}<p className="faint" style={{ marginTop: 10 }}>Collected revenue = payments confirmed by Safepay (verified webhook or status check) minus confirmed refunds, shown separately per currency. Unpaid links are not counted.</p></div></section>
        )}
      </div>
      <p className="faint mt">Signed in as {me.user.name}. Hidden figures: {x.hidden.length ? x.hidden.length : "none"}.</p>
      {custom && <CustomizeModal hidden={x.hidden} onClose={() => setCustom(false)} onSave={savePrefs} />}
    </>
  );
}

function CustomizeModal({ hidden, onClose, onSave }: { hidden: string[]; onClose: () => void; onSave: (h: string[]) => void }) {
  const [h, setH] = useState<string[]>(hidden);
  return (
    <Modal title="Show or hide figures" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" onClick={() => onSave(h)}>Save</Btn></>}>
      <p className="muted" style={{ marginBottom: 8 }}>Your choice is saved to your account and remembered on every device.</p>
      {WIDGETS.map(([k, label]) => (
        <label key={k} className="srow" style={{ cursor: "pointer" }}>
          <div><b>{label}</b></div>
          <span className="sw"><input type="checkbox" role="switch" aria-label={label} checked={!h.includes(k)} onChange={(e) => setH(e.target.checked ? h.filter((x) => x !== k) : [...h, k])} /><i /></span>
        </label>
      ))}
    </Modal>
  );
}
