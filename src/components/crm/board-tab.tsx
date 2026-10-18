"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { money } from "@/lib/format";
import { useCan } from "@/components/shell/app-shell";
import { Avatar, Btn, ErrorBox, Field, Loading, Modal, Note, Pill, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { CustomInputs, type FieldDef, type Opp, type Pipeline } from "./shared";

export function BoardTab() {
  const can = useCan();
  const toast = useToast();
  const pipes = useApi<{ pipelines: Pipeline[] }>("/api/crm/pipelines");
  const [pid, setPid] = useState<string | null>(null);
  useEffect(() => { if (!pid && pipes.data?.pipelines[0]) setPid(pipes.data.pipelines[0].id); }, [pipes.data, pid]);
  const board = useApi<{ stages: { id: string; name: string; kind: string }[]; opportunities: Opp[]; total: number }>(pid ? `/api/crm/pipelines/${pid}/board` : null, { pollMs: 10000 });
  const fields = useApi<{ fields: FieldDef[] }>("/api/crm/fields?entity=opportunity");
  const [editing, setEditing] = useState<Opp | "new" | null>(null);
  const [blocked, setBlocked] = useState<{ opp: Opp; message: string } | null>(null);
  const pipeFields = fields.data?.fields.filter((f) => !f.pipeline_id || f.pipeline_id === pid) ?? [];

  async function move(o: Opp, stageId: string) {
    if (stageId === o.stage_id) return;
    try { await api(`/api/crm/opportunities/${o.id}/move`, { body: { stageId, version: o.version } }); toast("Stage updated"); board.reload(); }
    catch (e) {
      const err = e as ApiError;
      if (err.status === 422) setBlocked({ opp: o, message: err.message });
      else toast(err.status === 409 ? "Someone else changed this opportunity. The board has been reloaded." : err.message, "error");
      board.reload();
    }
  }

  if (!pipes.data || !pid) return <Loading />;
  return (
    <>
      <div className="row wrap between" style={{ marginBottom: 12 }}>
        <div className="row wrap" style={{ minWidth: 0 }}>
          <label htmlFor="pl" className="muted">Pipeline</label>
          <select id="pl" className="sel-c" value={pid} onChange={(e) => setPid(e.target.value)}>{pipes.data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span className="faint">Fields on this pipeline:</span>{pipeFields.length ? pipeFields.map((f) => <Pill key={f.id} tone="purple">{f.label}</Pill>) : <span className="faint">none</span>}
        </div>
        <div className="row">
          {can("crm.export") && <a className="btn" href={`/api/crm/export?entity=opportunity&pipelineId=${pid}`}><Download size={16} />Export</a>}
          {can("crm.create") && <Btn variant="pri" onClick={() => setEditing("new")}><Plus size={16} />Add opportunity</Btn>}
        </div>
      </div>
      {board.error && <ErrorBox>{board.error.message}</ErrorBox>}
      {!board.data ? <Loading /> : (
        <div className="board" role="list">
          {board.data.stages.map((s) => {
            const cards = board.data!.opportunities.filter((o) => o.stage_id === s.id);
            const tot = cards.some((c) => c.value_masked) ? null : [...cards.reduce((m, c) => m.set(c.currency, (m.get(c.currency) ?? 0) + Number(c.value_cents ?? 0)), new Map<string, number>())];
            return (
              <section key={s.id} className="col" role="listitem" aria-label={s.name}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); const o = cards.concat(board.data!.opportunities).find((x) => x.id === id); if (o) move(o, s.id); }}>
                <h3>{s.name}<span className="pill gray">{cards.length}</span></h3>
                <div className="tot num">{tot === null ? "Value hidden" : tot.length === 0 ? "—" : tot.map(([cur, v]) => money(v, cur)).join(" · ")}{s.kind !== "open" && ` · ${s.kind}`}</div>
                {cards.length === 0 && <div className="faint" style={{ textAlign: "center", padding: 16 }}>No opportunities</div>}
                {cards.map((o) => (
                  <div key={o.id} className="kc" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}>
                    <button className="link" style={{ fontWeight: 600, color: "var(--ink)", textAlign: "left" }} onClick={() => setEditing(o)}>{o.title}</button>
                    <span className="faint">{o.contact_id ? <Link className="link" href={`/crm/contacts/${o.contact_id}`}>{o.contact_name}</Link> : "No contact"}</span>
                    <div className="m"><b className="num" style={{ color: "var(--ink)" }}>{o.value_masked ? "Hidden" : money(o.value_cents, o.currency)}</b>{o.owner_name && <Avatar name={o.owner_name} size="sm" />}</div>
                    <label className="sr" htmlFor={`mv-${o.id}`}>Move {o.title} to stage</label>
                    <select id={`mv-${o.id}`} className="sel-c" style={{ width: "100%", marginTop: 8, minHeight: 30, fontSize: 12 }} value={o.stage_id} disabled={!can("crm.edit")} onChange={(e) => move(o, e.target.value)}>
                      {board.data!.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {blocked && (
        <Modal title="Move blocked" onClose={() => setBlocked(null)} footer={<><Btn onClick={() => setBlocked(null)}>Keep in place</Btn><Btn variant="pri" onClick={() => { setEditing(blocked.opp); setBlocked(null); }}>Fill required fields</Btn></>}>
          <ErrorBox>{blocked.message}</ErrorBox>
          <p className="faint" style={{ marginTop: 10 }}>The server enforces stage-required fields; the card stays in its current stage.</p>
        </Modal>
      )}
      {editing && <OppModal pipelines={pipes.data.pipelines} pipelineId={pid} fields={fields.data?.fields ?? []} opp={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); board.reload(); refreshAll(); }} />}
    </>
  );
}

export function OppModal({ pipelines, pipelineId, fields, opp, contactId, onClose, onDone }: {
  pipelines: Pipeline[]; pipelineId: string; fields: FieldDef[]; opp: Opp | null; contactId?: string; onClose: () => void; onDone: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const [pid, setPid] = useState(opp?.pipeline_id ?? pipelineId);
  const [custom, setCustom] = useState<Record<string, unknown>>(opp?.custom ?? {});
  const contacts = useApi<{ contacts: { id: string; name: string }[] }>("/api/crm/contacts?pageSize=100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const defs = fields.filter((f) => !f.pipeline_id || f.pipeline_id === pid);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const valueRaw = f.get("value");
    const body: Record<string, unknown> = { title: f.get("title"), currency: f.get("currency"), contactId: f.get("contactId") || null, custom };
    if (can("crm.view_value") && valueRaw !== null && valueRaw !== "") body.value = Number(valueRaw);
    setBusy(true); setError(null); setErrs({});
    try {
      if (opp) await api(`/api/crm/opportunities/${opp.id}`, { method: "PATCH", body: { ...body, version: opp.version } });
      else await api("/api/crm/opportunities", { body: { ...body, pipelineId: pid } });
      toast(opp ? "Opportunity saved" : "Opportunity created"); onDone();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.status === 409 ? "Someone else changed this opportunity after you opened it. Close and reopen to see their changes." : ae.message);
      setErrs(fieldErrors(err)); setBusy(false);
    }
  }
  return (
    <Modal wide title={opp ? "Edit opportunity" : "New opportunity"} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="op">Save</Btn></>}>
      <form id="op" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        <Field id="o-title" name="title" label="Title *" defaultValue={opp?.title} error={errs.title} />
        <div className="grid g2">
          <SelectField id="o-pipe" label="Pipeline" value={pid} disabled={Boolean(opp)} onChange={(e) => setPid(e.target.value)}>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
          {contactId && !opp ? <><input type="hidden" name="contactId" value={contactId} /><Field id="o-contact-fixed" label="Contact" value="This contact" readOnly /></> : (
          <SelectField key={contacts.data ? "loaded" : "loading"} id="o-contact" name="contactId" label="Contact" defaultValue={opp?.contact_id ?? contactId ?? ""}>
            <option value="">No contact</option>{contacts.data?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>)}
        </div>
        {can("crm.view_value") ? (
          <div className="grid g2">
            <Field id="o-value" name="value" type="number" min={0} step="0.01" label="Value" defaultValue={opp?.value_cents != null ? Number(opp.value_cents) / 100 : ""} error={errs.value} />
            <SelectField id="o-cur" name="currency" label="Currency" defaultValue={opp?.currency ?? "pkr"}>{["pkr", "usd", "eur", "gbp", "aed"].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}</SelectField>
          </div>
        ) : <><input type="hidden" name="currency" value={opp?.currency ?? "pkr"} /><Note>Opportunity values are hidden for your role.</Note></>}
        <CustomInputs defs={defs} values={custom} onChange={(k, v) => setCustom({ ...custom, [k]: v })} errors={errs} />
      </form>
    </Modal>
  );
}
