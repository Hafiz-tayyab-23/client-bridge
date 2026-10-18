"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Banknote, Clock, Copy, Receipt, RefreshCw, TriangleAlert, Undo2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { dateTime, money } from "@/lib/format";
import { Btn, ErrorBox, Ico, Loading, Note, PageHead, Pager } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { PayPill } from "@/components/payments/pay-pill";

interface Payment {
  id: string; provider: string; status: string; amount_cents: number | null; currency: string; refunded_cents: number | null; url: string | null;
  provider_session: string | null; provider_intent: string | null; created_at: string; paid_at: string | null;
  opportunity_id: string | null; opportunity_title: string | null; contact_id: string | null; contact_name: string | null; requested_by_name: string | null; value_masked?: boolean;
}

function Payments() {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const status = sp.get("status") ?? "";
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const list = useApi<{ payments: Payment[]; total: number }>(`/api/payments?page=${page}&pageSize=25${status ? `&status=${status}` : ""}`, { pollMs: 5000 });
  const dash = useApi<{ payments_month: { currency: string; collected_cents: number | null; count: number }[]; scope: string }>("/api/dashboard", { pollMs: 15000 });
  const p = list.data?.payments.find((x) => x.id === sel);
  const [syncing, setSyncing] = useState(false);
  async function sync(id: string) {
    setSyncing(true);
    try { const r = await api<{ state: string; changed: boolean; note?: string }>(`/api/payments/${id}/sync`, { method: "POST" }); toast(`Safepay state: ${r.state}${r.changed ? " — record updated" : ""}${r.note ? ` (${r.note})` : ""}`); list.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setSyncing(false); }
  }
  const collected = dash.data?.payments_month ?? [];

  return (
    <>
      <PageHead title="Payments" sub="Stripe test-mode payment requests tied to contacts and opportunities. Statuses change only from Stripe’s verified webhooks." />
      <div className="grid g4 kp">
        <div className="card kpi"><div className="l"><Ico tone="green"><Banknote size={16} /></Ico>Collected this month</div>
          <div className="v num">{collected.length ? collected.map((c) => money(c.collected_cents, c.currency)).join(" + ") : money(0)}</div><div className="t">Confirmed payments minus refunds ({dash.data?.scope ?? "…"})</div></div>
        <div className="card kpi"><div className="l"><Ico tone="amber"><Clock size={16} /></Ico>Pending</div><div className="v num">{list.data?.payments.filter((x) => x.status === "pending").length ?? "–"}</div><div className="t">Awaiting the customer (this page)</div></div>
        <div className="card kpi"><div className="l"><Ico tone="red"><TriangleAlert size={16} /></Ico>Failed or expired</div><div className="v num">{list.data?.payments.filter((x) => ["failed", "expired"].includes(x.status)).length ?? "–"}</div><div className="t">Need follow-up (this page)</div></div>
        <div className="card kpi"><div className="l"><Ico tone="blue"><Undo2 size={16} /></Ico>Refunded</div><div className="v num">{list.data?.payments.filter((x) => x.status.includes("refunded")).length ?? "–"}</div><div className="t">Refunds made in the Stripe Dashboard</div></div>
      </div>
      <div className="split mt">
        <section className="card">
          <div className="fbar"><div className="chips" role="group" aria-label="Filter by status">
            {["", "paid", "pending", "failed", "cancelled", "expired", "refunded", "partially_refunded"].map((s) => (
              <button key={s} className="chip" aria-pressed={status === s} onClick={() => { setPage(1); router.replace(s ? `/payments?status=${s}` : "/payments"); }}>{s ? s.replace("_", " ") : "All"}</button>
            ))}</div></div>
          {list.error && <div className="cb"><ErrorBox>{list.error.message}</ErrorBox></div>}
          {!list.data ? <Loading /> : list.data.payments.length === 0 ? <div className="empty">No payment requests{status ? ` with status “${status}”` : ""}. Create one from a contact’s page.</div> : (
            <div className="tw"><table className="stk"><thead><tr><th scope="col">Contact / opportunity</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Requested by</th><th scope="col">Created</th></tr></thead>
              <tbody>{list.data.payments.map((x) => (
                <tr key={x.id} className={`clk ${sel === x.id ? "sel" : ""}`} tabIndex={0} onClick={() => setSel(x.id)} onKeyDown={(e) => { if (e.key === "Enter") setSel(x.id); }}>
                  <td data-l="Contact"><b>{x.contact_name ?? "—"}</b><small>{x.opportunity_title ?? "—"}</small></td>
                  <td data-l="Amount"><b className="num">{money(x.amount_cents, x.currency)}</b></td>
                  <td data-l="Status"><PayPill s={x.status} /></td>
                  <td data-l="Requested by">{x.requested_by_name ?? "—"}</td>
                  <td data-l="Created">{dateTime(x.created_at)}</td>
                </tr>))}</tbody></table>
              <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} /></div>
          )}
        </section>
        <div className={`dpanel ${p ? "open" : ""}`}>
          {!p ? <aside className="card"><div className="cb"><Note>Select a payment to see its Stripe reference and status.</Note></div></aside> : (
            <aside className="card" aria-label="Payment details">
              <header><h2><Receipt size={16} />Payment</h2><span className="row"><PayPill s={p.status} /><button className="ibtn dclose" onClick={() => setSel(null)} aria-label="Close details"><X size={16} /></button></span></header>
              <div className="cb">
                <div className="faint">Amount</div><b style={{ fontSize: 28 }} className="num">{money(p.amount_cents, p.currency)}</b>
                <dl className="kv" style={{ marginTop: 14 }}>
                  <dt>Contact</dt><dd>{p.contact_id ? <Link className="link" href={`/crm/contacts/${p.contact_id}`}>{p.contact_name}</Link> : "—"}</dd>
                  <dt>Opportunity</dt><dd>{p.opportunity_title ?? "—"}</dd><dt>Requested by</dt><dd>{p.requested_by_name ?? "—"}</dd>
                  <dt>Provider</dt><dd>{p.provider === "safepay" ? "Safepay (sandbox)" : "Stripe (test mode)"}</dd><dt>{p.provider === "safepay" ? "Tracker" : "Checkout session"}</dt><dd><code>{p.provider_session ?? "—"}</code></dd>
                  <dt>Payment intent</dt><dd><code>{p.provider_intent ?? "—"}</code></dd>
                  <dt>Refunded</dt><dd>{p.refunded_cents ? money(p.refunded_cents, p.currency) : "—"}</dd>
                  <dt>Created</dt><dd>{dateTime(p.created_at)}</dd><dt>Paid</dt><dd>{dateTime(p.paid_at)}</dd>
                </dl>
                <div className="row wrap" style={{ marginTop: 14 }}>
                  {p.url && p.status === "pending" && <Btn onClick={() => navigator.clipboard?.writeText(p.url!).then(() => toast("Link copied"), () => {})}><Copy size={14} />Copy payment link</Btn>}
                  {p.provider === "safepay" && <Btn busy={syncing} onClick={() => sync(p.id)}><RefreshCw size={14} />Check status with Safepay</Btn>}
                </div>
                <div style={{ marginTop: 14 }}><Note>{p.provider === "safepay" ? "Refunds are made in the Safepay dashboard; the payment.refunded webhook updates this record. Cancel/expiry has no documented webhook, so use Check status." : "Refunds are issued in the Stripe Dashboard; the refund webhook updates this record automatically."}</Note></div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}

export default function PaymentsPage() {
  return <Suspense fallback={<Loading />}><Payments /></Suspense>;
}
