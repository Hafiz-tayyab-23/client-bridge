"use client";
import Link from "next/link";
import { Suspense } from "react";
import { Field, Loading } from "@/components/ui/primitives";
import { FormError, SubmitBtn, useAuthSubmit } from "@/components/auth/auth-form";

function LoginForm() {
  const { busy, error, errs, submit } = useAuthSubmit("/api/auth/login");
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit({ email: f.get("email"), password: f.get("password") }); }}>
      <h1>Sign in</h1>
      <p className="muted" style={{ marginBottom: 18 }}>Use the account your workspace Owner created or invited.</p>
      <FormError error={error} />
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={errs.email} />
      <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required error={errs.password} />
      <SubmitBtn busy={busy}>Sign in</SubmitBtn>
      <p className="faint" style={{ marginTop: 16 }}>New company? <Link className="link" href="/signup">Create a workspace</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<Loading />}><LoginForm /></Suspense>;
}
