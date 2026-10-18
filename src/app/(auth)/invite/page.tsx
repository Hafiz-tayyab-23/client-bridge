"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useApi } from "@/lib/hooks";
import { ErrorBox, Field, Loading } from "@/components/ui/primitives";
import { FormError, SubmitBtn, useAuthSubmit } from "@/components/auth/auth-form";

function AcceptInvite() {
  const token = useSearchParams().get("token") ?? "";
  const info = useApi<{ email: string; name: string; workspace: string }>(`/api/auth/invite-info?token=${encodeURIComponent(token)}`);
  const { busy, error, errs, submit } = useAuthSubmit("/api/auth/accept-invite");
  if (info.loading) return <Loading label="Checking invitation…" />;
  if (info.error || !info.data) return <><h1>Invitation</h1><div style={{ marginTop: 12 }}><ErrorBox>{info.error?.message ?? "Invitation not found."}</ErrorBox></div></>;
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); submit({ token, password: new FormData(e.currentTarget).get("password") }); }}>
      <h1>Join {info.data.workspace}</h1>
      <p className="muted" style={{ marginBottom: 18 }}>Signing up as <b>{info.data.name}</b> ({info.data.email}).</p>
      <FormError error={error} />
      <Field id="password" name="password" type="password" label="Choose a password" hint="At least 8 characters" autoComplete="new-password" required error={errs.password} />
      <SubmitBtn busy={busy}>Join workspace</SubmitBtn>
    </form>
  );
}

export default function InvitePage() {
  return <Suspense fallback={<Loading />}><AcceptInvite /></Suspense>;
}
