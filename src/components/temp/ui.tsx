"use client";
// TEMPORARY test UI primitives. Replace with the approved design system; keep the API calls.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Field({ label, error, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        className="rounded border border-neutral-400 bg-white px-3 py-2 text-base"
        {...rest}
      />
      {error && <p id={`${id}-err`} className="text-sm text-red-700">⚠ {error}</p>}
    </div>
  );
}

export function Select({ label, id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} className="rounded border border-neutral-400 bg-white px-3 py-2" {...rest}>{children}</select>
    </div>
  );
}

export function Button({ busy, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      aria-busy={busy}
      className={`rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 ${className}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Notice({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const style = kind === "error" ? "border-red-700 bg-red-50 text-red-900" : kind === "success" ? "border-green-700 bg-green-50 text-green-900" : "border-neutral-500 bg-white";
  const label = kind === "error" ? "Error: " : kind === "success" ? "Done: " : "";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded border-l-4 px-3 py-2 text-sm ${style}`}>
      <strong>{label}</strong>{children}
    </div>
  );
}

export function TempBanner() {
  return <p className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900">Temporary test interface — final design pending</p>;
}
