"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Button, Field, Notice } from "@/components/temp/ui";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message); setErrs(fieldErrors(err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {error && <Notice kind="error">{error}</Notice>}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={errs.email} />
      <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required error={errs.password} />
      <Button busy={busy} type="submit">Sign in</Button>
      <p className="text-sm">New company? <Link className="underline" href="/signup">Create a workspace</Link></p>
    </form>
  );
}
