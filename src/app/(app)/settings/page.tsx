"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing, Building2, ExternalLink, Plus, Save, ShieldCheck, Shuffle, Siren, SlidersHorizontal, Timer, Trash2 } from "lucide-react";
import { api, fieldErrors } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useCan, useMe } from "@/components/shell/app-shell";
import { Btn, ErrorBox, Field, Loading, Note, PageHead, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

interface Level { type: "next_employee" | "backup" | "manager"; window_seconds: number }
interface Rules { max_open_leads: number; ack_window_seconds: number; levels: Level[]; backup_user_id: string | null; manager_user_id: string | null; idle_seconds: number; absence_policy: string; updated_at: string }

const Sec = ({ id, title, icon, children }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="card sec" id={`s-${id}`}><header><h2>{icon}{title}</h2></header><div className="cb">{children}</div></section>
);

export default function SettingsPage() {
  const me = useMe();
  const can = useCan();
  const toast = useToast();
  const rules = useApi<{ rules: Rules }>("/api/assignment-rules");
  const users = useApi<{ users: { id: string; name: string; availability: string }[] }>("/api/team/users");
  const [r, setR] = useState<Rules | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (rules.data && !r) setR(rules.data.rules); }, [rules.data, r]);
  const editable = can("assignment.manage");

  async function save() {
    if (!r) return;
    setBusy(true); setError(null); setErrs({});
    try {
      const res = await api<{ rules: Rules }>("/api/assignment-rules", { method: "PUT", body: {
        maxOpenLeads: r.max_open_leads, ackWindowSeconds: r.ack_window_seconds, levels: r.levels,
        backupUserId: r.backup_user_id, managerUserId: r.manager_user_id, idleSeconds: r.idle_seconds, absencePolicy: r.absence_policy,
      } });
      setR(res.rules); toast("Settings saved. New windows apply to the next assignment.");
    } catch (e) { setError((e as Error).message); setErrs(fieldErrors(e)); toast("Fix the highlighted settings", "error"); }
    finally { setBusy(false); }
  }
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const setLevel = (i: number, patch: Partial<Level>) => r && setR({ ...r, levels: r.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <>
      <PageHead title="Settings" sub="Workspace configuration for assignment, escalation, CRM structure and access. Stored per workspace on the server."
        actions={editable && <Btn variant="pri" busy={busy} onClick={save} disabled={!r}><Save size={16} />Save changes</Btn>} />
      <div className="set">
        <nav className="snav" aria-label="Settings sections">
          {[["workspace", "Workspace", <Building2 key="1" size={16} />], ["assign", "Assignment rules", <Shuffle key="2" size={16} />], ["ack", "Acknowledgement & recovery", <Timer key="3" size={16} />],
            ["esc", "Escalation chain", <Siren key="4" size={16} />], ["crm", "Pipelines & fields", <SlidersHorizontal key="5" size={16} />], ["perms", "Permissions", <ShieldCheck key="6" size={16} />], ["notif", "Notification routing", <BellRing key="7" size={16} />]]
            .map(([id, label, icon]) => <a key={id as string} href={`#s-${id}`}>{icon}{label}</a>)}
        </nav>
        <div>
          {!editable && <div style={{ marginBottom: 16 }}><Note>You can view these settings. Changing them requires the “Manage assignment rules” permission.</Note></div>}
          {error && <div style={{ marginBottom: 16 }}><ErrorBox>{error}</ErrorBox></div>}
          <Sec id="workspace" title="Workspace" icon={<Building2 size={16} />}>
            <dl className="kv" style={{ maxWidth: 520 }}><dt>Name</dt><dd>{me.workspace.name}</dd><dt>Timezone</dt><dd>{me.workspace.timezone}</dd><dt>Workspace ID</dt><dd><code>{me.workspace.id}</code></dd>
              <dt>Public lead form</dt><dd><a className="link" href={`/f/${me.workspace.id}`} target="_blank" rel="noreferrer">/f/{me.workspace.id.slice(0, 8)}… <ExternalLink size={13} /></a></dd></dl>
          </Sec>
          {!r ? <Loading /> : (
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <Sec id="assign" title="Assignment rules" icon={<Shuffle size={16} />}>
                <p className="muted" style={{ marginBottom: 12 }}>Method: <b>round-robin among Available employees</b>. Employees who are Busy, On leave or Offline, or at the limit, never receive new leads.</p>
                <div className="grid g2"><Field id="max" label="Maximum open leads per employee" type="number" min={1} value={r.max_open_leads} onChange={(e) => setR({ ...r, max_open_leads: num(e.target.value) })} error={errs.maxOpenLeads} /></div>
              </Sec>
              <Sec id="ack" title="Acknowledgement & recovery" icon={<Timer size={16} />}>
                <div className="grid g3">
                  <Field id="ackw" label="Acknowledgement window (seconds)" hint="For the initial owner. Use 10–30 s for demos." type="number" min={5} value={r.ack_window_seconds} onChange={(e) => setR({ ...r, ack_window_seconds: num(e.target.value) })} error={errs.ackWindowSeconds} />
                  <Field id="idle" label="Idle recovery after (seconds)" hint="No recorded action for this long → recovery queue" type="number" min={10} value={r.idle_seconds} onChange={(e) => setR({ ...r, idle_seconds: num(e.target.value) })} error={errs.idleSeconds} />
                  <SelectField id="abs" label="When an owner goes On leave / Offline" value={r.absence_policy} onChange={(e) => setR({ ...r, absence_policy: e.target.value })}>
                    <option value="keep_acknowledged">Move unacknowledged leads; acknowledged stay</option>
                    <option value="reassign_all">Move all open leads (re-acknowledge)</option>
                  </SelectField>
                </div>
                <Note>Recovery queue items: unacknowledged beyond the window, escalated two or more times, or idle beyond the period above. A lead that escalated once and has a fresh window is not a recovery item.</Note>
              </Sec>
              <Sec id="esc" title="Escalation chain" icon={<Siren size={16} />}>
                <div className="steps">
                  {r.levels.map((l, i) => (
                    <div key={i} className="step"><span className="nb">{i + 1}</span>
                      <div className="grow grid g2" style={{ alignItems: "end" }}>
                        <SelectField id={`lt${i}`} label={`Level ${i + 1} target`} value={l.type} onChange={(e) => setLevel(i, { type: e.target.value as Level["type"] })}>
                          <option value="next_employee">Next available employee</option><option value="backup">Designated backup</option><option value="manager">Manager</option>
                        </SelectField>
                        <Field id={`lw${i}`} label="Time allowed at this level (s)" type="number" min={5} value={l.window_seconds} onChange={(e) => setLevel(i, { window_seconds: num(e.target.value) })} error={errs[`levels.${i}.window_seconds`]} />
                      </div>
                      <button type="button" className="ibtn" aria-label={`Remove level ${i + 1}`} disabled={r.levels.length <= 1} onClick={() => setR({ ...r, levels: r.levels.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <Btn size="sm" type="button" onClick={() => setR({ ...r, levels: [...r.levels, { type: "next_employee", window_seconds: 60 }] })} disabled={r.levels.length >= 10}><Plus size={14} />Add level</Btn>
                <div className="grid g2 mt">
                  <SelectField id="bk" label="Designated backup" value={r.backup_user_id ?? ""} onChange={(e) => setR({ ...r, backup_user_id: e.target.value || null })}>
                    <option value="">None (level skipped)</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField>
                  <SelectField id="mg" label="Manager" value={r.manager_user_id ?? ""} onChange={(e) => setR({ ...r, manager_user_id: e.target.value || null })}>
                    <option value="">None (level skipped)</option>{users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</SelectField>
                </div>
                <Note>The server runs the chain every few seconds, even when nobody has the app open. Each expiry escalates exactly once, and the new owner gets an in-app and Telegram alert.</Note>
              </Sec>
            </fieldset>
          )}
          <Sec id="crm" title="Pipelines & fields" icon={<SlidersHorizontal size={16} />}><p className="muted">Pipelines, stages, stage-required fields and custom fields are managed in CRM.</p><Link className="btn sm" style={{ marginTop: 10 }} href="/crm?tab=pipes">Open CRM configuration</Link></Sec>
          <Sec id="perms" title="Permissions" icon={<ShieldCheck size={16} />}><p className="muted">Roles are permission sets edited by the Owner on the Team page.</p><Link className="btn sm" style={{ marginTop: 10 }} href="/team">Open Team</Link></Sec>
          <Sec id="notif" title="Notification routing" icon={<BellRing size={16} />}><p className="muted">Escalation alerts are sent through Telegram to each employee’s own chat (set on the Team page). The bot is connected on the Integrations page.</p></Sec>
        </div>
      </div>
    </>
  );
}
