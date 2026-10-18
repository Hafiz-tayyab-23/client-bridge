"use client";
// TEMPORARY assignment rules editor (F3.3, F3.5, F3.6, F3.7).
import { useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/api";
import { Button, Field, Notice, Select } from "@/components/temp/ui";

interface Level { type: "next_employee" | "backup" | "manager"; window_seconds: number }
interface Rules { max_open_leads: number; ack_window_seconds: number; levels: Level[]; backup_user_id: string | null; manager_user_id: string | null; idle_seconds: number; absence_policy: string }

export default function AssignmentSettings() {
  const [r, setR] = useState<Rules | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ rules: Rules }>("/api/assignment-rules").then((x) => setR(x.rules)).catch((e) => setMsg({ kind: "error", text: e.message }));
    api<{ users: { id: string; name: string }[] }>("/api/team/users").then((x) => setUsers(x.users)).catch(() => {});
  }, []);
  if (!r) return msg ? <Notice kind="error">{msg.text}</Notice> : <p role="status">Loading…</p>;
  const rules = r;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErrs({});
    try {
      await api("/api/assignment-rules", {
        method: "PUT",
        body: {
          maxOpenLeads: rules.max_open_leads, ackWindowSeconds: rules.ack_window_seconds, levels: rules.levels,
          backupUserId: rules.backup_user_id, managerUserId: rules.manager_user_id, idleSeconds: rules.idle_seconds, absencePolicy: rules.absence_policy,
        },
      });
      setMsg({ kind: "success", text: "Rules saved. New timers use these values." });
    } catch (err) { setMsg({ kind: "error", text: (err as Error).message }); setErrs(fieldErrors(err)); }
    finally { setBusy(false); }
  }
  const num = (v: string) => Number(v || 0);
  const setLevel = (i: number, patch: Partial<Level>) => setR({ ...rules, levels: rules.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <form onSubmit={save} className="flex max-w-xl flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Assignment rules</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <p className="text-sm">Strategy: round-robin among Available employees below the open-lead limit.</p>
      <Field id="max" label="Max open leads per employee" type="number" min={1} value={rules.max_open_leads} onChange={(e) => setR({ ...rules, max_open_leads: num(e.target.value) })} error={errs.maxOpenLeads} />
      <Field id="ack" label="Acknowledgement window (seconds)" type="number" min={5} value={rules.ack_window_seconds} onChange={(e) => setR({ ...rules, ack_window_seconds: num(e.target.value) })} error={errs.ackWindowSeconds} />
      <fieldset className="flex flex-col gap-2 rounded border p-3">
        <legend className="px-1 text-sm font-medium">Escalation levels (in order)</legend>
        {rules.levels.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Select id={`lt${i}`} label={`Level ${i + 1}`} value={l.type} onChange={(e) => setLevel(i, { type: e.target.value as Level["type"] })}>
              <option value="next_employee">Next available employee</option>
              <option value="backup">Designated backup</option>
              <option value="manager">Manager</option>
            </Select>
            <Field id={`lw${i}`} label="Window (s)" type="number" min={5} value={l.window_seconds} onChange={(e) => setLevel(i, { window_seconds: num(e.target.value) })} />
            <button type="button" className="underline disabled:opacity-40" onClick={() => setR({ ...rules, levels: rules.levels.filter((_, j) => j !== i) })} disabled={rules.levels.length <= 1}>Remove</button>
          </div>
        ))}
        <button type="button" className="self-start underline" onClick={() => setR({ ...rules, levels: [...rules.levels, { type: "next_employee", window_seconds: 60 }] })}>Add level</button>
        {errs.levels && <p className="text-sm text-red-700">⚠ {errs.levels}</p>}
      </fieldset>
      <Select id="bk" label="Designated backup" value={rules.backup_user_id ?? ""} onChange={(e) => setR({ ...rules, backup_user_id: e.target.value || null })}>
        <option value="">None</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      <Select id="mg" label="Manager (final level)" value={rules.manager_user_id ?? ""} onChange={(e) => setR({ ...rules, manager_user_id: e.target.value || null })}>
        <option value="">None</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      <Field id="idle" label="Recovery: idle period (seconds)" type="number" min={10} value={rules.idle_seconds} onChange={(e) => setR({ ...rules, idle_seconds: num(e.target.value) })} />
      <Select id="ab" label="When an owner goes On leave / Offline" value={rules.absence_policy} onChange={(e) => setR({ ...rules, absence_policy: e.target.value })}>
        <option value="keep_acknowledged">Move unacknowledged leads; acknowledged stay</option>
        <option value="reassign_all">Move all open leads (must be re-acknowledged)</option>
      </Select>
      <Button busy={busy} type="submit">Save rules</Button>
    </form>
  );
}
