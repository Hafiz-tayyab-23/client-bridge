"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, ListFilter, Plus, Save, Search, Trash2, X } from "lucide-react";
import { api, fieldErrors } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/format";
import { useCan } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Loading, Modal, Note, Pager, Pill, SelectField, Who } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { CustomInputs, type FieldDef, type Pipeline } from "./shared";

interface Contact { id: string; name: string; email: string | null; phone: string | null; tags: string[]; owner_name: string | null; company_name: string | null; opted_out: boolean; created_at: string }
interface Filters { q?: string; tag?: string; stageId?: string; ownerId?: string; createdFrom?: string; createdTo?: string; custom?: { key: string; op: string; value: string }[] }
interface SavedList { id: string; name: string; entity: string; filters: Filters }

function toQs(f: Filters) {
  const p = new URLSearchParams();
  for (const k of ["q", "tag", "stageId", "ownerId", "createdFrom", "createdTo"] as const) if (f[k]) p.set(k, f[k]!);
  if (f.custom?.length) p.set("custom", JSON.stringify(f.custom));
  return p;
}
const count = (f: Filters) => ["q", "tag", "stageId", "ownerId", "createdFrom", "createdTo"].filter((k) => f[k as keyof Filters]).length + (f.custom?.length ?? 0);

export function ContactsTab({ initialQ }: { initialQ?: string }) {
  const can = useCan();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<Filters>(initialQ ? { q: initialQ } : {});
  const [listId, setListId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const qs = toQs(f); qs.set("page", String(page)); qs.set("pageSize", "25");
  const data = useApi<{ contacts: Contact[]; total: number; page: number; pageSize: number }>(listId ? `/api/crm/lists/${listId}?page=${page}` : `/api/crm/contacts?${qs}`, { pollMs: 10000 });
  const lists = useApi<{ lists: SavedList[] }>("/api/crm/lists");
  const fields = useApi<{ fields: FieldDef[] }>("/api/crm/fields?entity=contact");
  const pipes = useApi<{ pipelines: Pipeline[] }>("/api/crm/pipelines");
  const users = useApi<{ users: { id: string; name: string }[] }>("/api/team/users");

  const set = (patch: Partial<Filters>) => { setListId(null); setPage(1); setF({ ...f, ...patch }); };
  async function saveList() {
    const name = prompt("Name for this saved list:");
    if (!name) return;
    try { await api("/api/crm/lists", { body: { name, entity: "contact", filters: f } }); toast(`Saved list “${name}”. It updates automatically as records change.`); lists.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  async function delList(id: string) {
    try { await api(`/api/crm/lists/${id}`, { method: "DELETE" }); if (listId === id) setListId(null); lists.reload(); toast("List deleted"); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  const cust = f.custom ?? [];

  return (
    <section className="card">
      <div className="fbar">
        <div className="search"><Search size={16} /><label className="sr" htmlFor="cq">Search contacts</label>
          <input id="cq" placeholder="Search name, email or phone" value={f.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} /></div>
        <div className="chips" role="group" aria-label="Saved lists">
          <button className="chip" aria-pressed={!listId && count(f) === 0} onClick={() => { setListId(null); setF({}); }}>All contacts</button>
          {lists.data?.lists.filter((l) => l.entity === "contact").map((l) => (
            <span key={l.id} className="row" style={{ gap: 2 }}>
              <button className="chip" aria-pressed={listId === l.id} onClick={() => { setListId(l.id); setF(l.filters); setPage(1); }}>{l.name}</button>
              <button className="ibtn" style={{ width: 24, height: 24 }} aria-label={`Delete list ${l.name}`} onClick={() => delList(l.id)}><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="row wrap" style={{ marginLeft: "auto" }}>
          <Btn size="sm" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}><ListFilter size={14} />Filters{count(f) ? ` (${count(f)})` : ""}</Btn>
          <Btn size="sm" disabled={count(f) === 0 || Boolean(listId)} onClick={saveList}><Save size={14} />Save as list</Btn>
          {can("crm.export") && <a className="btn sm" href={`/api/crm/export?entity=contact&${toQs(f)}`}><Download size={14} />Export CSV</a>}
          {can("crm.create") && <Btn size="sm" variant="pri" onClick={() => setCreating(true)}><Plus size={14} />New contact</Btn>}
        </div>
      </div>
      {showFilters && (
        <div className="cb" style={{ borderBottom: "1px solid var(--line2)" }}>
          <div className="grid g4">
            <Field id="f-tag" label="Tag" value={f.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} />
            <SelectField id="f-stage" label="Has opportunity in stage" value={f.stageId ?? ""} onChange={(e) => set({ stageId: e.target.value || undefined })}>
              <option value="">Any</option>{pipes.data?.pipelines.flatMap((p) => p.stages.map((s) => <option key={s.id} value={s.id}>{p.name} · {s.name}</option>))}</SelectField>
            <SelectField id="f-owner" label="Owner" value={f.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value || undefined })}>
              <option value="">Anyone</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField>
            <div className="grid g2"><Field id="f-from" type="date" label="Created from" value={f.createdFrom ?? ""} onChange={(e) => set({ createdFrom: e.target.value || undefined })} />
              <Field id="f-to" type="date" label="Created to" value={f.createdTo ?? ""} onChange={(e) => set({ createdTo: e.target.value || undefined })} /></div>
          </div>
          {cust.map((c, i) => (
            <div key={i} className="row wrap" style={{ alignItems: "flex-end" }}>
              <SelectField id={`cfk${i}`} label="Custom field" value={c.key} onChange={(e) => set({ custom: cust.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}>
                {fields.data?.fields.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</SelectField>
              <SelectField id={`cfo${i}`} label="Condition" value={c.op} onChange={(e) => set({ custom: cust.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                <option value="eq">equals</option><option value="contains">contains</option><option value="gt">greater than</option><option value="lt">less than</option></SelectField>
              <Field id={`cfv${i}`} label="Value" value={c.value} onChange={(e) => set({ custom: cust.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <button className="ibtn" style={{ marginBottom: 12 }} aria-label="Remove condition" onClick={() => set({ custom: cust.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="row">
            <Btn size="sm" disabled={!fields.data?.fields.length} onClick={() => set({ custom: [...cust, { key: fields.data!.fields[0].key, op: "eq", value: "" }] })}><Plus size={14} />Custom field condition</Btn>
            <Btn size="sm" onClick={() => { setF({}); setListId(null); }}>Clear all</Btn>
            <span className="faint">All conditions must match. Saved lists store the conditions and re-run them live.</span>
          </div>
        </div>
      )}
      {data.error && <div className="cb"><ErrorBox>{data.error.message}</ErrorBox></div>}
      {!data.data ? <Loading /> : data.data.contacts.length === 0 ? <div className="empty">No contacts match.</div> : (
        <div className="tw"><table className="stk">
          <thead><tr><th scope="col">Contact</th><th scope="col">Company</th><th scope="col">Owner</th><th scope="col">Tags</th><th scope="col">Created</th></tr></thead>
          <tbody>{data.data.contacts.map((c) => (
            <tr key={c.id} className="clk" tabIndex={0} onClick={() => router.push(`/crm/contacts/${c.id}`)} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/crm/contacts/${c.id}`); }}>
              <td data-l="Contact"><Who name={c.name} sub={c.email ?? c.phone ?? ""} /></td>
              <td data-l="Company">{c.company_name ?? "—"}</td>
              <td data-l="Owner">{c.owner_name ?? "—"}</td>
              <td data-l="Tags"><div className="row wrap" style={{ gap: 4 }}>{c.tags.map((t) => <Pill key={t} tone="purple">{t}</Pill>)}{c.opted_out && <Pill tone="red">Opted out</Pill>}</div></td>
              <td data-l="Created">{dateTime(c.created_at)}</td>
            </tr>))}</tbody>
        </table><Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} /></div>
      )}
      {creating && <ContactModal fields={fields.data?.fields ?? []} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); refreshAll(); router.push(`/crm/contacts/${id}`); }} />}
    </section>
  );
}

export function ContactModal({ fields, initial, onClose, onDone }: {
  fields: FieldDef[]; onClose: () => void; onDone: (id: string) => void;
  initial?: { id: string; name: string; email: string | null; phone: string | null; company_id: string | null; tags: string[]; opted_out: boolean; custom: Record<string, unknown>; version: number };
}) {
  const toast = useToast();
  const companies = useApi<{ companies: { id: string; name: string }[] }>("/api/crm/companies?pageSize=100");
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"), email: f.get("email"), phone: f.get("phone"), companyId: f.get("companyId") || null,
      tags: String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean), optedOut: f.get("optedOut") === "on", custom,
      ...(initial ? { version: initial.version } : {}),
    };
    setBusy(true); setError(null); setErrs({});
    try {
      const r = initial ? await api<{ contact: { id: string } }>(`/api/crm/contacts/${initial.id}`, { method: "PATCH", body }) : await api<{ contact: { id: string } }>("/api/crm/contacts", { body });
      toast(initial ? "Contact saved" : "Contact created"); onDone(r.contact.id);
    } catch (err) { setError((err as Error).message); setErrs(fieldErrors(err)); setBusy(false); }
  }
  return (
    <Modal wide title={initial ? "Edit contact" : "New contact"} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="pri" busy={busy} type="submit" form="ct">Save contact</Btn></>}>
      <form id="ct" onSubmit={submit} noValidate>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        <div className="grid g2"><Field id="c-name" name="name" label="Name *" defaultValue={initial?.name} error={errs.name} />
          <SelectField key={companies.data ? "loaded" : "loading"} id="c-co" name="companyId" label="Company" defaultValue={initial?.company_id ?? ""}>
            <option value="">No company</option>{companies.data?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></div>
        <div className="grid g2"><Field id="c-email" name="email" type="email" label="Email" defaultValue={initial?.email ?? ""} error={errs.email} />
          <Field id="c-phone" name="phone" label="Phone" placeholder="+923001234567" defaultValue={initial?.phone ?? ""} error={errs.phone} /></div>
        <Field id="c-tags" name="tags" label="Tags" hint="Comma separated" defaultValue={initial?.tags.join(", ")} />
        <CustomInputs defs={fields} values={custom} onChange={(k, v) => setCustom({ ...custom, [k]: v })} errors={errs} />
        <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" name="optedOut" defaultChecked={initial?.opted_out} /> Opted out of messaging</label>
        {initial && <Note>If someone else saved this contact after you opened it, the server rejects your save and asks you to reload instead of overwriting their change.</Note>}
      </form>
    </Modal>
  );
}

export function CompaniesTab() {
  const can = useCan();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const data = useApi<{ companies: { id: string; name: string; domain: string | null; contacts: number; created_at: string }[]; total: number; page: number; pageSize: number }>(`/api/crm/companies?q=${encodeURIComponent(q)}&page=${page}`);
  async function create() {
    const name = prompt("Company name:");
    if (!name) return;
    try { await api("/api/crm/companies", { body: { name } }); toast("Company created"); data.reload(); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  return (
    <section className="card">
      <div className="fbar"><div className="search"><Search size={16} /><label className="sr" htmlFor="coq">Search companies</label><input id="coq" placeholder="Search companies" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {can("crm.create") && <Btn size="sm" variant="pri" style={{ marginLeft: "auto" }} onClick={create}><Plus size={14} />New company</Btn>}</div>
      {!data.data ? <Loading /> : data.data.companies.length === 0 ? <div className="empty">No companies yet.</div> : (
        <div className="tw"><table className="stk"><thead><tr><th scope="col">Company</th><th scope="col">Domain</th><th scope="col">Contacts</th><th scope="col">Created</th></tr></thead>
          <tbody>{data.data.companies.map((c) => <tr key={c.id}><td data-l="Company"><b>{c.name}</b></td><td data-l="Domain">{c.domain ?? "—"}</td><td data-l="Contacts">{c.contacts}</td><td data-l="Created">{dateTime(c.created_at)}</td></tr>)}</tbody>
        </table><Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} /></div>
      )}
      <div className="cb"><Link className="link" href="/crm?tab=fields">Company custom fields are managed under Custom Fields.</Link></div>
    </section>
  );
}
