"use client";
import { Field, SelectField } from "@/components/ui/primitives";

export interface FieldDef { id: string; entity: string; pipeline_id: string | null; key: string; label: string; type: "text" | "number" | "date" | "dropdown" | "checkbox"; options: string[] }
export interface Stage { id: string; name: string; position: number; kind: "open" | "won" | "lost"; opportunity_count: number; required_field_ids: string[] }
export interface Pipeline { id: string; name: string; position: number; stages: Stage[] }
export interface Opp {
  id: string; title: string; value_cents: number | null; value_masked: boolean; currency: string; pipeline_id: string; stage_id: string; stage_name: string;
  contact_id: string | null; contact_name: string | null; owner_id: string | null; owner_name: string | null; custom: Record<string, unknown>; version: number;
}

/** Inputs for custom fields, rendered from server definitions (F2.2). Values are validated again on the server. */
export function CustomInputs({ defs, values, onChange, errors }: { defs: FieldDef[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; errors?: Record<string, string> }) {
  if (defs.length === 0) return null;
  return (
    <div className="grid g2">
      {defs.map((d) => {
        const id = `cf-${d.key}`;
        const err = errors?.[`custom.${d.key}`];
        const v = values[d.key];
        if (d.type === "checkbox") return (
          <label key={d.key} className="row" style={{ marginBottom: 12 }} htmlFor={id}>
            <input id={id} type="checkbox" checked={v === true} onChange={(e) => onChange(d.key, e.target.checked)} /> {d.label}
            {err && <span className="fe">{err}</span>}
          </label>
        );
        if (d.type === "dropdown") return (
          <SelectField key={d.key} id={id} label={d.label} value={(v as string) ?? ""} onChange={(e) => onChange(d.key, e.target.value || null)} error={err}>
            <option value="">—</option>{d.options.map((o) => <option key={o}>{o}</option>)}
          </SelectField>
        );
        return (
          <Field key={d.key} id={id} label={d.label} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"} error={err}
            value={v === null || v === undefined ? "" : String(v)}
            onChange={(e) => onChange(d.key, d.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value || null)} />
        );
      })}
    </div>
  );
}

export function showCustom(defs: FieldDef[], values: Record<string, unknown>) {
  return defs.map((d) => ({ label: d.label, value: values?.[d.key] === undefined || values?.[d.key] === null || values?.[d.key] === "" ? null : d.type === "checkbox" ? (values[d.key] ? "Yes" : "No") : String(values[d.key]) }));
}
