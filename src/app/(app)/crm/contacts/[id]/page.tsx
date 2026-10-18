"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, use, useState } from "react";
import { ArrowLeft, CalendarPlus, CreditCard, History, Kanban, MessageCircle, MessagesSquare, Pencil, Plus, Trash2, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime, money } from "@/lib/format";
import { useCan } from "@/components/shell/app-shell";
import { Avatar, Btn, ErrorBox, Loading, Note, PageHead, Pill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { ContactModal } from "@/components/crm/contacts-tab";
import { OppModal } from "@/components/crm/board-tab";
import { showCustom, type FieldDef, type Opp, type Pipeline } from "@/components/crm/shared";
import { PaymentRequestModal } from "@/components/payments/request-modal";
import { PayPill } from "@/components/payments/pay-pill";
import { BookModal } from "@/components/calendar/book-modal";

interface View {
  contact: { id: string; name: string; email: string | null; phone: string | null; company_id: string | null; tags: string[]; opted_out: boolean; custom: Record<string, unknown>; version: number; created_at: string };
  owner: { id: string; name: string; availability: string } | null;
  company: { id: string; name: string; domain: string | null } | null;
  opportunities: (Opp & { pipeline_name: string; stage_kind: string })[];
  conversations: { id: string; channel: string; assignee_name: string | null; last_message_at: string; messages: { id: string; direction: string; body: string; status: string; error_message: string | null; created_at: string }[] | null }[];
  payments: { id: string; opportunity_id: string; amount_cents: number | null; currency: string; status: string; refunded_cents: number | null; provider_session: string | null; created_at: string; url: string | null }[];
  appointments: { id: string; title: string; starts_at: string; timezone: string; status: string; user_name: string | null }[];
  leads: { id: string; title: string; source: string; status: string }[];
  timeline: { id: number; type: string; summary: string; actor: string; created_at: string }[];
  fields: FieldDef[];
}

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const v = useApi<View>(`/api/crm/contacts/${id}`, { pollMs: 8000 });
  const pipes = useApi<{ pipelines: Pipeline[] }>("/api/crm/pipelines");
  const oppFields = useApi<{ fields: FieldDef[] }>("/api/crm/fields?entity=opportunity");
  const [tab, setTab] = useState("timeline");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "edit" | "opp" | "pay" | "book">(null);

  if (v.error) return <><Link className="link back" href="/crm"><ArrowLeft size={14} />Back to CRM</Link><ErrorBox>{v.error.message}</ErrorBox></>;
  if (!v.data) return <Loading label="Loading customer…" />;
  const { contact: c } = v.data;

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try { await api(`/api/crm/contacts/${id}/notes`, { body: { body: note } }); setNote(""); toast("Note added"); v.reload(); refreshAll(); }
    catch (err) { toast((err as Error).message, "error"); }
    finally { setBusy(false); }
  }
  async function del() {
    if (!confirm(`Delete ${c.name}? Open leads for this contact are closed. This is recorded in the audit log.`)) return;
    try { await api(`/api/crm/contacts/${id}`, { method: "DELETE" }); toast("Contact deleted"); router.push("/crm"); }
    catch (err) { toast((err as Error).message, "error"); }
  }
  const tabs: [string, string, React.ReactNode, number][] = [
    ["timeline", "Activity", <History key="h" size={16} />, v.data.timeline.length], ["opps", "Opportunities", <Kanban key="k" size={16} />, v.data.opportunities.length],
    ["conv", "Conversations", <MessagesSquare key="m" size={16} />, v.data.conversations.length], ["pay", "Payments", <CreditCard key="p" size={16} />, v.data.payments.length],
    ["appt", "Appointments", <Calendar key="a" size={16} />, v.data.appointments.length],
  ];

  return (
    <>
      <Link className="link back" href="/crm"><ArrowLeft size={14} />Back to CRM</Link>
      <PageHead title={c.name} sub={v.data.company ? `at ${v.data.company.name}` : "No company"}
        actions={<>
          <Link className="btn" href={`/conversations?contact=${id}`}><MessageCircle size={16} />Message</Link>
          {can("crm.edit") && <Btn onClick={() => setModal("pay")}><CreditCard size={16} />Request payment</Btn>}
          {can("crm.edit") && <Btn variant="pri" onClick={() => setModal("book")}><CalendarPlus size={16} />Book appointment</Btn>}
        </>} />
      <div className="grid" style={{ gridTemplateColumns: "320px minmax(0,1fr)", alignItems: "start" }} id="cgrid">
        <div className="grid">
          <section className="card"><div className="cb">
            <div className="row"><Avatar name={c.name} size="lg" /><div><b style={{ fontSize: 17 }}>{c.name}</b><div className="muted">{c.email ?? c.phone ?? "No contact details"}</div></div></div>
            <div className="row wrap" style={{ marginTop: 12, gap: 4 }}>{c.tags.map((t) => <Pill key={t} tone="purple">{t}</Pill>)}</div>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Company</dt><dd>{v.data.company?.name ?? "—"}</dd>
              <dt>Email</dt><dd>{c.email ?? "—"}</dd><dt>Phone</dt><dd>{c.phone ?? "—"}</dd>
              <dt>Assigned to</dt><dd>{v.data.owner?.name ?? "—"}</dd>
              {showCustom(v.data.fields, c.custom).map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value ?? <span className="faint">Not set</span>}</dd></Fragment>)}
              <dt>Messaging</dt><dd>{c.opted_out ? <Pill tone="red">Opted out</Pill> : <Pill tone="green">Opted in</Pill>}</dd>
            </dl>
            <div className="row wrap" style={{ marginTop: 14 }}>
              {can("crm.edit") && <Btn size="sm" onClick={() => setModal("edit")}><Pencil size={14} />Edit</Btn>}
              {can("crm.delete") && <Btn size="sm" variant="dng" onClick={del}><Trash2 size={14} />Delete</Btn>}
            </div>
          </div></section>
          {v.data.leads.length > 0 && (
            <section className="card"><header><h2>Leads</h2></header>
              <ul className="list">{v.data.leads.map((l) => <li key={l.id}><div className="grow"><Link className="link" href={`/leads?id=${l.id}`}>{l.title}</Link><span>{l.source} · {l.status}</span></div></li>)}</ul></section>
          )}
        </div>
        <section className="card">
          <div className="tabs" role="tablist" style={{ padding: "0 8px", margin: 0 }}>
            {tabs.map(([k, label, icon, n]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{icon}{label} <span className="faint">{n}</span></button>)}
          </div>
          {tab === "timeline" && (
            <div className="cb">
              {can("crm.edit") && (
                <form className="row" onSubmit={addNote} style={{ marginBottom: 16 }}>
                  <label className="sr" htmlFor="note">Add a note</label>
                  <input id="note" className="inp" placeholder="Add a note (counts as acting on an open lead)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Btn variant="pri" busy={busy} type="submit"><Plus size={14} />Add</Btn>
                </form>
              )}
              {v.data.timeline.length === 0 ? <div className="empty">No activity yet.</div> : (
                <ul className="tl">{v.data.timeline.map((t) => (
                  <li key={t.id}><span className="ico"><History size={14} /></span><div><b style={{ whiteSpace: "pre-wrap" }}>{t.summary}</b><p className="faint">{t.actor} · {dateTime(t.created_at)} · {t.type}</p></div></li>
                ))}</ul>
              )}
            </div>
          )}
          {tab === "opps" && (
            <div className="cb">
              {can("crm.create") && <Btn size="sm" style={{ marginBottom: 12 }} onClick={() => setModal("opp")}><Plus size={14} />New opportunity</Btn>}
              {v.data.opportunities.length === 0 ? <div className="empty">No opportunities.</div> : (
                <div className="tw"><table className="stk"><thead><tr><th scope="col">Opportunity</th><th scope="col">Pipeline</th><th scope="col">Stage</th><th scope="col">Value</th></tr></thead>
                  <tbody>{v.data.opportunities.map((o) => <tr key={o.id}><td data-l="Opportunity"><b>{o.title}</b></td><td data-l="Pipeline">{o.pipeline_name}</td><td data-l="Stage"><Pill tone="purple">{o.stage_name}</Pill></td><td data-l="Value"><b className="num">{o.value_masked ? "Hidden" : money(o.value_cents, o.currency)}</b></td></tr>)}</tbody></table></div>
              )}
            </div>
          )}
          {tab === "conv" && (
            <div className="cb">{v.data.conversations.length === 0 ? <div className="empty">No conversations yet. <Link className="link" href={`/conversations?contact=${id}`}>Open Conversations</Link></div> : v.data.conversations.map((cv) => (
              <div key={cv.id} style={{ marginBottom: 12 }}><b>{cv.channel}</b> <span className="faint">· assigned to {cv.assignee_name ?? "nobody"}</span>
                <ul className="list" style={{ margin: "0 -18px" }}>{(cv.messages ?? []).slice(-5).map((m) => <li key={m.id}><div className="grow"><b style={{ whiteSpace: "normal", fontWeight: 500 }}>{m.direction === "outbound" ? "You: " : ""}{m.body}</b><span>{m.status}{m.error_message ? ` · ${m.error_message}` : ""} · {dateTime(m.created_at)}</span></div></li>)}</ul></div>
            ))}</div>
          )}
          {tab === "pay" && (
            <div className="cb">{v.data.payments.length === 0 ? <div className="empty">No payment requests.</div> : (
              <div className="tw"><table className="stk"><thead><tr><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Stripe reference</th><th scope="col">Created</th></tr></thead>
                <tbody>{v.data.payments.map((p) => <tr key={p.id}><td data-l="Amount"><b className="num">{money(p.amount_cents, p.currency)}</b></td><td data-l="Status"><PayPill s={p.status} /></td><td data-l="Reference"><code>{p.provider_session ?? "—"}</code></td><td data-l="Created">{dateTime(p.created_at)}</td></tr>)}</tbody></table></div>
            )}</div>
          )}
          {tab === "appt" && (
            <div className="cb">{v.data.appointments.length === 0 ? <div className="empty">No appointments. Use “Book appointment” above.</div> : (
              <ul className="list">{v.data.appointments.map((a) => <li key={a.id}><div className="grow"><b>{a.title}</b><span>{dateTime(a.starts_at, a.timezone)} · {a.user_name} · {a.status}</span></div></li>)}</ul>
            )}</div>
          )}
        </section>
      </div>
      {modal === "edit" && <ContactModal fields={v.data.fields} initial={c} onClose={() => setModal(null)} onDone={() => { setModal(null); v.reload(); }} />}
      {modal === "opp" && pipes.data && <OppModal pipelines={pipes.data.pipelines} pipelineId={pipes.data.pipelines[0].id} fields={oppFields.data?.fields ?? []} opp={null} contactId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); v.reload(); }} />}
      {modal === "book" && <BookModal contactId={id} onClose={() => { setModal(null); v.reload(); }} />}
      {modal === "pay" && <PaymentRequestModal opportunities={v.data.opportunities} onClose={() => { setModal(null); v.reload(); }} />}
    </>
  );
}
