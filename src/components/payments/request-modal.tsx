"use client";
import { useState } from "react";
import { CreditCard, Link as LinkIcon } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { refreshAll } from "@/lib/hooks";
import { Btn, ErrorBox, Field, Modal, Note, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

/** Creates a real Stripe test-mode Checkout link on the server (I2.1). No card data touches this app. */
export function PaymentRequestModal({ opportunities, defaultOpp, onClose }: { opportunities: { id: string; title: string; currency?: string }[]; defaultOpp?: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [url, setUrl] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      const r = await api<{ payment: { url: string } }>(`/api/crm/opportunities/${f.get("opp")}/payments`, {
        body: { amount: Number(f.get("amount")), currency: f.get("currency"), description: f.get("description") || undefined },
      });
      setUrl(r.payment.url); toast("Stripe payment link created"); refreshAll();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.body?.code === "integration_not_connected" ? `${ae.message} (Integrations → Stripe → enter a test secret key.)` : ae.message);
      setErrs(fieldErrors(err));
    } finally { setBusy(false); }
  }
  return (
    <Modal title="New payment request" onClose={onClose} footer={url ? <Btn variant="pri" onClick={onClose}>Done</Btn> : <><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="prq" disabled={opportunities.length === 0}><CreditCard size={16} />Create link</Btn></>}>
      {url ? (
        <>
          <p style={{ marginBottom: 10 }}>Send this Stripe Checkout link to the customer. The status updates automatically from Stripe’s verified webhook.</p>
          <div className="row"><input className="inp" readOnly value={url} aria-label="Payment link" onFocus={(e) => e.currentTarget.select()} />
            <Btn onClick={() => navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => {})}><LinkIcon size={14} />Copy</Btn></div>
          <div style={{ marginTop: 12 }}><Note>Test mode: pay with card 4242 4242 4242 4242, any future date and any CVC.</Note></div>
        </>
      ) : (
        <form id="prq" onSubmit={submit} noValidate>
          {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
          {opportunities.length === 0 ? <Note>Create an opportunity first; payments are requested against an opportunity.</Note> : (
            <SelectField id="pr-opp" name="opp" label="Opportunity" defaultValue={defaultOpp}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</SelectField>
          )}
          <div className="grid g2">
            <Field id="pr-amt" name="amount" type="number" min={0.5} step="0.01" label="Amount *" error={errs.amount} />
            <SelectField id="pr-cur" name="currency" label="Currency" defaultValue="usd">{["usd", "eur", "gbp", "pkr", "aed"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</SelectField>
          </div>
          <Field id="pr-desc" name="description" label="Description" hint="Shown on Stripe's checkout page" />
          <Note>Created in Stripe test mode on the server. Card details are entered only on Stripe’s hosted page.</Note>
        </form>
      )}
    </Modal>
  );
}
