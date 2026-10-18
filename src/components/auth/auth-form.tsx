"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Btn, ErrorBox } from "@/components/ui/primitives";

/** Shared submit logic for auth forms: inline field errors, busy state, redirect on success. */
export function useAuthSubmit(endpoint: string) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  async function submit(body: Record<string, unknown>) {
    setBusy(true); setError(null); setErrs({});
    try {
      await api(endpoint, { body });
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message); setErrs(fieldErrors(e));
      setBusy(false);
    }
  }
  return { busy, error, errs, submit };
}

export function FormError({ error }: { error: string | null }) {
  return error ? <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div> : null;
}

export function SubmitBtn({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return <Btn variant="pri" busy={busy} type="submit" style={{ width: "100%", justifyContent: "center", marginTop: 4 }}>{children}</Btn>;
}
