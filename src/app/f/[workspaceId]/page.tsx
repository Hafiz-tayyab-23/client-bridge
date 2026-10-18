"use client";
// Public web form (F3.1). TEMPORARY styling.
import { use, useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Button, Field, Notice } from "@/components/temp/ui";

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
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="mb-4 text-2xl font-semibold">Contact us</h1>
      {done ? <Notice kind="success">Thanks! We received your request (ref {done}). Someone will reply shortly.</Notice> : (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {error && <Notice kind="error">{error}</Notice>}
          <Field id="name" name="name" label="Your name" required error={errs.name} />
          <Field id="email" name="email" type="email" label="Email" error={errs.email} />
          <Field id="phone" name="phone" label="Phone (+923001234567)" error={errs.phone} />
          <Field id="message" name="message" label="How can we help?" error={errs.message} />
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <Button busy={busy} type="submit">Send</Button>
        </form>
      )}
    </main>
  );
}
