"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Button, Field, Notice } from "@/components/temp/ui";

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<{ email: string; name: string; workspace: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ email: string; name: string; workspace: string }>(`/api/auth/invite-info?token=${encodeURIComponent(token)}`)
      .then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      await api("/api/auth/accept-invite", { body: { token, password: f.get("password") } });
      router.replace("/"); router.refresh();
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); }
    finally { setBusy(false); }
  }

  if (!info && !error) return <p role="status">Checking invitation…</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Join {info?.workspace ?? "workspace"}</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {info && (
        <>
          <p className="text-sm">Signing up as <strong>{info.name}</strong> ({info.email}).</p>
          <Field id="password" name="password" type="password" label="Choose a password (min 8)" autoComplete="new-password" required error={errs.password} />
          <Button busy={busy} type="submit">Join workspace</Button>
        </>
      )}
    </form>
  );
}

export default function InvitePage() {
  return <Suspense fallback={<p role="status">Loading…</p>}><AcceptInvite /></Suspense>;
}
