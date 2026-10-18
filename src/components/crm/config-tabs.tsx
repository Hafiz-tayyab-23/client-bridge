"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useCan } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Loading, Modal, Note, Pill, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { FieldDef, Pipeline, Stage } from "./shared";

export function PipelinesTab() {
  const can = useCan();
  const toast = useToast();
  const pipes = useApi<{ pipelines: Pipeline[] }>("/api/crm/pipelines");
  const fields = useApi<{ fields: FieldDef[] }>("/api/crm/fields?entity=opportunity");
  const [stageEdit, setStageEdit] = useState<{ pipeline: Pipeline; stage: Stage | null } | null>(null);
  const [del, setDel] = useState<{ pipeline: Pipeline; stage: Stage } | null>(null);
  const edit = can("crm.configure");

  async function call(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast(ok); pipes.reload(); }
    catch (e) { toast((e as Error).message, "error"); pipes.reload(); }
  }
  const reorder = (p: Pipeline, i: number, dir: -1 | 1) => {
    const ids = p.stages.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    call(() => api(`/api/crm/pipelines/${p.id}/stages/order`, { method: "PUT", body: { stageIds: ids } }), "Stages reordered");
  };

  if (!pipes.data) return <Loading />;
  return (
    <>
      {!edit && <div style={{ marginBottom: 12 }}><Note>Viewing only. Changing pipelines needs the “Configure fields and pipelines” permission.</Note></div>}
      {edit && <div className="row" style={{ marginBottom: 12 }}><Btn variant="pri" onClick={() => { const name = prompt("New pipeline name:"); if (name) call(() => api("/api/crm/pipelines", { body: { name } }), "Pipeline created"); }}><Plus size={16} />New pipeline</Btn></div>}
      <div className="grid g2">
        {pipes.data.pipelines.map((p) => {
          const pf = fields.data?.fields.filter((f) => !f.pipeline_id || f.pipeline_id === p.id) ?? [];
          return (
            <section key={p.id} className="card">
              <header><h2><Workflow size={16} />{p.name}</h2>
                {edit && <Btn size="sm" onClick={() => { const name = prompt("Rename pipeline:", p.name); if (name && name !== p.name) call(() => api(`/api/crm/pipelines/${p.id}`, { method: "PUT", body: { name } }), "Pipeline renamed"); }}><Pencil size={14} />Rename</Btn>}</header>
              <div className="cb">
                <div className="faint" style={{ marginBottom: 6 }}>Stages (in order)</div>
                <ul className="list" style={{ margin: "0 -18px" }}>
                  {p.stages.map((s, i) => (
                    <li key={s.id}>
                      <div className="grow"><b>{s.name}</b><span>{s.kind} · {s.opportunity_count} opportunities{s.required_field_ids.length ? ` · requires ${s.required_field_ids.map((id) => pf.find((f) => f.id === id)?.label ?? "field").join(", ")}` : ""}</span></div>
                      {edit && <div className="row" style={{ gap: 4 }}>
                        <button className="ibtn" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => reorder(p, i, -1)}><ArrowUp size={14} /></button>
                        <button className="ibtn" aria-label={`Move ${s.name} down`} disabled={i === p.stages.length - 1} onClick={() => reorder(p, i, 1)}><ArrowDown size={14} /></button>
                        <button className="ibtn" aria-label={`Edit ${s.name}`} onClick={() => setStageEdit({ pipeline: p, stage: s })}><Pencil size={14} /></button>
                        <button className="ibtn" aria-label={`Delete ${s.name}`} onClick={() => setDel({ pipeline: p, stage: s })}><Trash2 size={14} /></button>
                      </div>}
                    </li>
                  ))}
                </ul>
                {edit && <Btn size="sm" style={{ marginTop: 10 }} onClick={() => setStageEdit({ pipeline: p, stage: null })}><Plus size={14} />Add stage</Btn>}
                <div className="faint" style={{ marginTop: 14 }}>Fields on this pipeline</div>
                <div className="row wrap" style={{ marginTop: 6 }}>{pf.length ? pf.map((f) => <Pill key={f.id} tone={f.pipeline_id ? "purple" : "blue"}>{f.label}{f.pipeline_id ? "" : " (all)"}</Pill>) : <span className="faint">None</span>}</div>
              </div>
            </section>
          );
        })}
      </div>
      {stageEdit && <StageModal {...stageEdit} fields={fields.data?.fields.filter((f) => !f.pipeline_id || f.pipeline_id === stageEdit.pipeline.id) ?? []} onClose={() => setStageEdit(null)} onDone={() => { setStageEdit(null); pipes.reload(); }} />}
      {del && <DeleteStageModal {...del} onClose={() => setDel(null)} onDone={() => { setDel(null); pipes.reload(); }} />}
    </>
  );
}

function StageModal({ pipeline, stage, fields, onClose, onDone }: { pipeline: Pipeline; stage: Stage | null; fields: FieldDef[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [req, setReq] = useState<string[]>(stage?.required_field_ids ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), kind: f.get("kind"), requiredFieldIds: req };
    setBusy(true); setError(null); setErrs({});
    try {
      if (stage) await api(`/api/crm/stages/${stage.id}`, { method: "PUT", body });
      else await api(`/api/crm/pipelines/${pipeline.id}/stages`, { body });
      toast(stage ? "Stage saved" : "Stage added"); onDone();
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); setBusy(false); }
  }
  return (
    <Modal title={stage ? `Edit stage · ${pipeline.name}` : `Add stage · ${pipeline.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" type="submit" form="stf" busy={busy}>Save stage</Btn></>}>
      <form id="stf" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        <Field id="st-name" name="name" label="Stage name *" defaultValue={stage?.name} error={errs.name} />
        <SelectField id="st-kind" name="kind" label="Kind" defaultValue={stage?.kind ?? "open"} hint="Won/lost stages are excluded from open pipeline value"><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></SelectField>
        <fieldset style={{ border: 0, padding: 0 }}><legend className="f" style={{ marginBottom: 6 }}>Required before entering this stage</legend>
          {fields.length === 0 ? <p className="faint">No opportunity fields for this pipeline yet. Add one under Custom Fields.</p> : fields.map((f) => (
            <label key={f.id} className="row" style={{ marginBottom: 6 }}><input type="checkbox" checked={req.includes(f.id)} onChange={(e) => setReq(e.target.checked ? [...req, f.id] : req.filter((x) => x !== f.id))} /> {f.label} <span className="faint">({f.type})</span></label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

function DeleteStageModal({ pipeline, stage, onClose, onDone }: { pipeline: Pipeline; stage: Stage; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const others = pipeline.stages.filter((s) => s.id !== stage.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ moved: number }>(`/api/crm/stages/${stage.id}${stage.opportunity_count ? `?moveTo=${target}` : ""}`, { method: "DELETE" });
      toast(r.moved ? `Stage deleted; ${r.moved} opportunit${r.moved === 1 ? "y" : "ies"} moved` : "Stage deleted"); onDone();
    } catch (e) { setError((e as ApiError).message); setBusy(false); }
  }
  return (
    <Modal title={`Delete stage “${stage.name}”`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="dng" busy={busy} onClick={go} disabled={others.length === 0}><Trash2 size={14} />Delete stage</Btn></>}>
      {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
      {stage.opportunity_count > 0 ? (
        <SelectField id="mv-to" label={`Move its ${stage.opportunity_count} opportunit${stage.opportunity_count === 1 ? "y" : "ies"} to`} value={target} onChange={(e) => setTarget(e.target.value)}>
          {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
      ) : <p>This stage is empty and can be deleted safely.</p>}
      <Note>Deletion is recorded in the audit log.</Note>
    </Modal>
  );
}

export function FieldsTab() {
  const can = useCan();
  const toast = useToast();
  const fields = useApi<{ fields: FieldDef[] }>("/api/crm/fields");
  const pipes = useApi<{ pipelines: Pipeline[] }>("/api/crm/pipelines");
  const [edit, setEdit] = useState<FieldDef | "new" | null>(null);
  const pname = (id: string | null) => (id ? pipes.data?.pipelines.find((p) => p.id === id)?.name ?? "pipeline" : null);
  async function del(f: FieldDef) {
    if (!confirm(`Delete field “${f.label}”? Its values are removed from all records and from stage requirements.`)) return;
    try { await api(`/api/crm/fields/${f.id}`, { method: "DELETE" }); toast("Field deleted"); fields.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  return (
    <section className="card">
      <header><h2>Custom fields</h2>{can("crm.configure") && <Btn size="sm" variant="pri" onClick={() => setEdit("new")}><Plus size={14} />New field</Btn>}</header>
      {!fields.data ? <Loading /> : fields.data.fields.length === 0 ? <div className="empty">No custom fields yet. Create text, number, date, dropdown or checkbox fields without code.</div> : (
        <div className="tw"><table className="stk"><thead><tr><th scope="col">Field</th><th scope="col">Applies to</th><th scope="col">Type</th><th scope="col">Pipeline</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
          <tbody>{fields.data.fields.map((f) => (
            <tr key={f.id}>
              <td data-l="Field"><b>{f.label}</b><small><code>{f.key}</code>{f.options.length ? ` · ${f.options.join(", ")}` : ""}</small></td>
              <td data-l="Applies to" style={{ textTransform: "capitalize" }}>{f.entity}</td>
              <td data-l="Type" style={{ textTransform: "capitalize" }}>{f.type}</td>
              <td data-l="Pipeline">{f.entity !== "opportunity" ? "—" : f.pipeline_id ? <Pill tone="purple">{pname(f.pipeline_id)}</Pill> : <Pill>All pipelines</Pill>}</td>
              <td data-l="Actions">{can("crm.configure") && <div className="row" style={{ justifyContent: "flex-end" }}><Btn size="sm" onClick={() => setEdit(f)}><Pencil size={14} />Edit</Btn><Btn size="sm" variant="dng" onClick={() => del(f)}><Trash2 size={14} />Delete</Btn></div>}</td>
            </tr>))}</tbody></table></div>
      )}
      {edit && <FieldModal field={edit === "new" ? null : edit} pipelines={pipes.data?.pipelines ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); fields.reload(); }} />}
    </section>
  );
}

function FieldModal({ field, pipelines, onClose, onDone }: { field: FieldDef | null; pipelines: Pipeline[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [entity, setEntity] = useState(field?.entity ?? "opportunity");
  const [type, setType] = useState(field?.type ?? "text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const options = String(f.get("options") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    setBusy(true); setError(null); setErrs({});
    try {
      if (field) await api(`/api/crm/fields/${field.id}`, { method: "PUT", body: { label: f.get("label"), options } });
      else await api("/api/crm/fields", { body: { entity, type, label: f.get("label"), options: type === "dropdown" ? options : undefined, pipelineId: entity === "opportunity" ? (f.get("pipelineId") || null) : null } });
      toast(field ? "Field saved" : "Field created — it now appears on forms and detail pages"); onDone();
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); setBusy(false); }
  }
  return (
    <Modal title={field ? "Edit custom field" : "New custom field"} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="cff">Save field</Btn></>}>
      <form id="cff" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        <Field id="cf-label" name="label" label="Field name *" defaultValue={field?.label} error={errs.label} />
        <div className="grid g2">
          <SelectField id="cf-ent" label="Applies to" value={entity} disabled={Boolean(field)} onChange={(e) => setEntity(e.target.value)}><option value="contact">Contact</option><option value="company">Company</option><option value="opportunity">Opportunity</option></SelectField>
          <SelectField id="cf-type" label="Type" value={type} disabled={Boolean(field)} onChange={(e) => setType(e.target.value as FieldDef["type"])}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option><option value="checkbox">Checkbox</option></SelectField>
        </div>
        {type === "dropdown" && <Field id="cf-opts" name="options" label="Dropdown options *" hint="Comma separated" defaultValue={field?.options.join(", ")} error={errs.options} />}
        {entity === "opportunity" && !field && (
          <SelectField id="cf-pipe" name="pipelineId" label="Pipeline" hint="Pipeline-specific fields appear only on that pipeline (F2.3)" error={errs.pipelineId}>
            <option value="">All pipelines</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
        )}
        <Note>Make a field required for a specific stage in CRM → Pipelines.</Note>
      </form>
    </Modal>
  );
}
