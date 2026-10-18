"use client";
import { useState } from "react";
import { CreditCard, Link as LinkIcon } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { refreshAll } from "@/lib/hooks";
import { Btn, ErrorBox, Field, Modal, Note, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

/** Creates a real Safepay sandbox checkout link on the server (I2.1). No card data touches this app. */
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
        body: { amount: Number(f.get("amount")), currency: f.get("currency"), description: f.get("description") || undefined, provider: "safepay" },
      });
      setUrl(r.payment.url); toast("Payment link created"); refreshAll();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      setErrs(fieldErrors(err));
    } finally { setBusy(false); }
  }
  return (
    <Modal title="New payment request" onClose={onClose} footer={url ? <Btn variant="pri" onClick={onClose}>Done</Btn> : <><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="prq" disabled={opportunities.length === 0}><CreditCard size={16} />Create link</Btn></>}>
      {url ? (
        <>
          <p style={{ marginBottom: 10 }}>Send this hosted checkout link to the customer. The status updates from the provider’s verified webhook.</p>
          <div className="row"><input className="inp" readOnly value={url} aria-label="Payment link" onFocus={(e) => e.currentTarget.select()} />
            <Btn onClick={() => navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => {})}><LinkIcon size={14} />Copy</Btn></div>
          <div style={{ marginTop: 12 }}><Note>Safepay sandbox: pay with a test card from Safepay’s sandbox documentation.</Note></div>
        </>
      ) : (
        <form id="prq" onSubmit={submit} noValidate>
          {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
          {opportunities.length === 0 ? <Note>Create an opportunity first; payments are requested against an opportunity.</Note> : (
            <SelectField id="pr-opp" name="opp" label="Opportunity" defaultValue={defaultOpp}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</SelectField>
          )}
          <div className="grid g2">
            <Field id="pr-amt" name="amount" type="number" min={0.5} step="0.01" label="Amount (PKR) *" hint="e.g. 1234.50 — charged exactly as entered" error={errs.amount} />
            <SelectField id="pr-cur" name="currency" label="Currency" defaultValue="pkr" hint="Safepay sandbox charges in PKR."><option value="pkr">PKR</option></SelectField>
          </div>
          <Field id="pr-desc" name="description" label="Description" hint="Shown on the provider checkout page" />
          <Note>Created on the server through Safepay’s sandbox. Card details are entered only on Safepay’s hosted page.</Note>
        </form>
      )}
    </Modal>
  );
}
