"use client";
// Public web form (F3.1). Customer-facing; no session.
import { use, useState } from "react";
import { CircleCheck, Layers, Send } from "lucide-react";
import { api, fieldErrors } from "@/lib/api";
import { Btn, ErrorBox, Field } from "@/components/ui/primitives";

export default function PublicForm({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      const r = await api<{ reference: string }>(`/api/public/forms/${workspaceId}`, { body: Object.fromEntries(f) });
      setDone(r.reference);
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth" id="main">
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div className="brand"><span className="logo"><Layers size={18} /></span><div><b>Contact us</b><small>We reply within minutes during business hours</small></div></div>
        <section className="card"><div className="cb" style={{ padding: 24 }}>
          {done ? (
            <div role="status" className="row" style={{ alignItems: "flex-start" }}><span className="ico green"><CircleCheck size={16} /></span>
              <div><b>Thanks — we received your request.</b><p className="muted">Reference {done}. A team member has been assigned and will contact you shortly.</p></div></div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1>How can we help?</h1>
              <p className="muted" style={{ marginBottom: 16 }}>Leave your details and the right person will get back to you.</p>
              {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
              <Field id="name" name="name" label="Your name *" required autoComplete="name" error={errs.name} />
              <Field id="email" name="email" type="email" label="Email" autoComplete="email" error={errs.email} />
              <Field id="phone" name="phone" label="Phone" placeholder="+923001234567" inputMode="tel" autoComplete="tel" error={errs.phone} />
              <Field id="message" name="message" label="Message" error={errs.message} />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" hidden />
              <Btn variant="pri" busy={busy} type="submit" style={{ width: "100%", justifyContent: "center" }}><Send size={16} />Send request</Btn>
            </form>
          )}
        </div></section>
      </div>
    </main>
  );
}
