"use client";
// Shared presentation primitives matching the approved UI reference.
import { TriangleAlert, Info, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export type Tone = "green" | "red" | "amber" | "blue" | "gray" | "purple" | "pink";

export function Pill({ tone = "gray", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{icon}{children}</span>;
}

const COLORS = ["#5b4fe9", "#14925e", "#2563c9", "#b86a05", "#b3265e", "#0e7490", "#7c3aed", "#be123c"];
export function colorOf(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}
export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return <span className={`av ${size ?? ""}`} style={{ background: colorOf(name) }} aria-hidden="true">{initials(name)}</span>;
}
export function Who({ name, sub }: { name: string; sub?: ReactNode }) {
  return <div className="who"><Avatar name={name} size="sm" /><div><b>{name}</b>{sub && <small>{sub}</small>}</div></div>;
}
export function Ico({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ico ${tone ?? ""}`}>{children}</span>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ph">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

export function Btn({ busy, variant, size, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "pri" | "dng"; size?: "sm" }) {
  return (
    <button {...rest} className={`btn ${variant ?? ""} ${size ?? ""} ${className}`} disabled={busy || rest.disabled} aria-busy={busy || undefined}>
      {busy && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; id: string }) {
  return (
    <label className="f" htmlFor={id}>
      {label}
      <input id={id} className="inp" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
      {hint && !error && <small id={`${id}-h`}>{hint}</small>}
      {error && <span id={`${id}-e`} className="fe"><TriangleAlert size={13} />{error}</span>}
    </label>
  );
}

export function SelectField({ label, hint, error, id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; id: string; children: ReactNode }) {
  return (
    <label className="f" htmlFor={id}>
      {label}
      <select id={id} className="inp" aria-invalid={error ? true : undefined} {...rest}>{children}</select>
      {hint && !error && <small>{hint}</small>}
      {error && <span className="fe"><TriangleAlert size={13} />{error}</span>}
    </label>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="err" role="alert"><TriangleAlert size={16} /><div>{children}</div></div>;
}
export function Note({ children }: { children: ReactNode }) {
  return <div className="note"><Info size={15} /><span>{children}</span></div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="empty" role="status"><span className="spin" aria-hidden="true" /> {label}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button.pri") ?? ref.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 640 } : undefined}>
        <div className="mh"><h2 style={{ fontSize: 16 }}>{title}</h2><button className="ibtn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="row between" style={{ padding: "10px 18px" }}>
      <span className="faint">Page {page} of {pages} · {total} records</span>
      <div className="row">
        <Btn size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Btn>
        <Btn size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Btn>
      </div>
    </div>
  );
}
