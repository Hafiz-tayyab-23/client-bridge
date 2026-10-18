"use client";
import Link from "next/link";
import { Suspense } from "react";
import { Field, Loading } from "@/components/ui/primitives";
import { FormError, SubmitBtn, useAuthSubmit } from "@/components/auth/auth-form";

function SignupForm() {
  const { busy, error, errs, submit } = useAuthSubmit("/api/auth/signup");
  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      submit({ workspaceName: f.get("workspaceName"), name: f.get("name"), email: f.get("email"), password: f.get("password") });
    }}>
      <h1>Create your company workspace</h1>
      <p className="muted" style={{ marginBottom: 18 }}>You become the workspace Owner. Your data is isolated from every other company.</p>
      <FormError error={error} />
      <Field id="workspaceName" name="workspaceName" label="Company name" required error={errs.workspaceName} />
      <Field id="name" name="name" label="Your name" autoComplete="name" required error={errs.name} />
      <Field id="email" name="email" type="email" label="Work email" autoComplete="email" required error={errs.email} />
      <Field id="password" name="password" type="password" label="Password" hint="At least 8 characters" autoComplete="new-password" required error={errs.password} />
      <SubmitBtn busy={busy}>Create workspace</SubmitBtn>
      <p className="faint" style={{ marginTop: 16 }}>Already have an account? <Link className="link" href="/login">Sign in</Link></p>
    </form>
  );
}

export default function SignupPage() {
  return <Suspense fallback={<Loading />}><SignupForm /></Suspense>;
}
