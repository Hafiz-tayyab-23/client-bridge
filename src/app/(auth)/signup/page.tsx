"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Button, Field, Notice } from "@/components/temp/ui";

export default function SignupPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setErrs({});
    try {
      await api("/api/auth/signup", {
        body: { workspaceName: f.get("workspaceName"), name: f.get("name"), email: f.get("email"), password: f.get("password") },
      });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message); setErrs(fieldErrors(err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Create your company workspace</h1>
      <p className="text-sm">You will be the workspace Owner.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <Field id="workspaceName" name="workspaceName" label="Company name" required error={errs.workspaceName} />
      <Field id="name" name="name" label="Your name" autoComplete="name" required error={errs.name} />
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={errs.email} />
      <Field id="password" name="password" type="password" label="Password (min 8 characters)" autoComplete="new-password" required error={errs.password} />
      <Button busy={busy} type="submit">Create workspace</Button>
      <p className="text-sm">Already have an account? <Link className="underline" href="/login">Sign in</Link></p>
    </form>
  );
}
