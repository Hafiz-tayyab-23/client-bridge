"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, CircleCheck, ExternalLink, LifeBuoy, Loader, UserRound, UserRoundCog, X, Circle } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll, useApi } from "@/lib/hooks";
import { availLabel, dateTime, sourceLabel } from "@/lib/format";
import { useCan, useMe } from "@/components/shell/app-shell";
import { Avatar, Btn, ErrorBox, Field, Loading, Modal, Note, Pill, SelectField } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Countdown, leadState, RecoveryPill, useServerNow, type LeadRow } from "./lead-bits";

interface Detail {
  lead: LeadRow & { message: string | null; first_assigned_at: string | null; first_acknowledged_at: string | null };
  assignments: { id: number; user_name: string | null; kind: string; level: number; reason: string; assigned_at: string; ended_at: string | null }[];
  activities: { id: number; type: string; summary: string; actor: string; created_at: string }[];
  absencePolicy: "keep_acknowledged" | "reassign_all";
  chain: { ackWindowSeconds: number; levels: { type: string; window_seconds: number }[]; backupName: string | null; managerName: string | null };
  serverTime: string;
}

const levelName = (t: string, c: Detail["chain"]) =>
  t === "next_employee" ? "Next available employee" : t === "backup" ? `Designated backup${c.backupName ? ` · ${c.backupName}` : " (not set — skipped)"}` : `Manager${c.managerName ? ` · ${c.managerName}` : " (not set — skipped)"}`;

export function LeadPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useMe();
  const can = useCan();
  const toast = useToast();
  const d = useApi<Detail>(`/api/leads/${id}`, { pollMs: 4000 });
  const now = useServerNow(d.data?.serverTime);
  const [busy, setBusy] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);

  async function act(path: string, label: string) {
    setBusy(path);
    try { await api(path, { method: "POST" }); toast(label); refreshAll(); }
    catch (e) { toast((e as Error).message, "error"); refreshAll(); }
    finally { setBusy(null); }
  }

  if (d.error) return <aside className="card"><div className="cb"><ErrorBox>{d.error.message}</ErrorBox><Btn style={{ marginTop: 10 }} onClick={onClose}>Close</Btn></div></aside>;
  if (!d.data) return <aside className="card"><Loading label="Loading lead…" /></aside>;
  const { lead: l, chain } = d.data;
  const s = leadState(l, now);
  const windowSec = l.escalation_level === 0 ? chain.ackWindowSeconds : chain.levels[l.escalation_level - 1]?.window_seconds ?? chain.ackWindowSeconds;
  const pct = l.status === "assigned" && l.ack_deadline ? Math.max(0, Math.min(100, 100 - ((Date.parse(l.ack_deadline) - now) / 1000 / windowSec) * 100)) : 100;
  const name = l.contact_name ?? l.title;

  return (
    <aside className="card" aria-label="Lead details">
      <header><h2><UserRound size={16} />Lead details</h2>
        <span className="row"><span className="faint">{l.id.slice(0, 8)}</span><button className="ibtn dclose" onClick={onClose} aria-label="Close details"><X size={16} /></button></span></header>
      <div className="cb">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <Avatar name={name} size="lg" />
          <div className="grow"><b style={{ fontSize: 17, whiteSpace: "normal" }}>{name}</b><span style={{ whiteSpace: "normal" }}>{l.title}</span>
            <div className="row wrap" style={{ marginTop: 7, gap: 4 }}><Pill tone={s.tone} icon={s.icon}>{s.label}</Pill><RecoveryPill reasons={l.recovery_reasons} /></div></div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="row between"><b style={{ fontSize: 13 }}>Acknowledgement window</b><Countdown deadline={l.ack_deadline} now={now} status={l.status} /></div>
          <div className="bar" style={{ marginTop: 7 }}><i style={{ width: `${pct}%`, background: l.status === "acknowledged" ? "#22b07d" : pct >= 100 ? "#e5484d" : "#f0a020" }} /></div>
          <p className="faint" style={{ marginTop: 5 }}>
            {l.status === "acknowledged" ? `Acknowledged ${dateTime(l.acknowledged_at)}` : `${windowSec}s window for level ${l.escalation_level} · assigned ${dateTime(l.assigned_at)}`}
          </p>
        </div>

        {l.recovery_reasons?.length > 0 && (
          <div className="err" style={{ marginTop: 14 }}><LifeBuoy size={16} /><div><b>Recovery reason</b><br />{l.recovery_reasons.join(" · ")}</div></div>
        )}

        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Source</dt><dd>{sourceLabel(l.source)}</dd>
          <dt>Accountable owner</dt><dd>{l.owner_name ?? "—"}{l.owner_id === me.user.id ? " (you)" : ""}</dd>
          <dt>Company</dt><dd>{l.company_name ?? "—"}</dd>
          <dt>Email</dt><dd>{l.contact_email ?? "—"}</dd>
          <dt>Phone</dt><dd>{l.contact_phone ?? "—"}</dd>
          <dt>Escalations</dt><dd>{l.escalation_count}</dd>
          <dt>Created</dt><dd>{dateTime(l.created_at)}</dd>
        </dl>
        {l.message && <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>“{l.message}”</p>}

        <div className="row wrap" style={{ marginTop: 14 }}>
          {l.status === "assigned" && l.owner_id === me.user.id && <Btn variant="pri" busy={busy === "ack"} onClick={() => act(`/api/leads/${id}/acknowledge`, "Lead acknowledged")}><Check size={16} />Acknowledge</Btn>}
          {can("leads.assign") && l.status !== "closed" && <Btn onClick={() => setReassigning(true)}><UserRoundCog size={16} />Reassign</Btn>}
          {l.status !== "closed" && (l.owner_id === me.user.id || can("leads.assign")) && <Btn busy={busy === "close"} onClick={() => act(`/api/leads/${id}/close`, "Lead closed")}>Close lead</Btn>}
          {l.contact_id && <Link className="btn" href={`/crm/contacts/${l.contact_id}`}><ExternalLink size={16} />Open in CRM</Link>}
        </div>

        <h3 style={{ fontSize: 13, margin: "18px 0 4px" }}>Escalation chain (configured)</h3>
        <div className="steps">
          {[{ type: "assigned", window_seconds: chain.ackWindowSeconds }, ...chain.levels].map((lv, i) => {
            const done = i < l.escalation_level, cur = i === l.escalation_level && l.status !== "closed";
            return (
              <div key={i} className={`step ${done ? "chain-done" : cur ? "chain-cur" : "chain-skip"}`}>
                <span className="nb">{done ? <CircleCheck size={14} /> : cur ? <Loader size={14} /> : <Circle size={14} />}</span>
                <div><b style={{ fontSize: 13 }}>{i === 0 ? "Initial owner (round-robin)" : `Level ${i}: ${levelName(lv.type, chain)}`}</b>
                  <p className="faint">{lv.window_seconds}s to acknowledge{cur ? " · current" : ""}</p></div>
              </div>
            );
          })}
        </div>
        {l.chain_exhausted && <Note>All escalation levels were tried. The lead stays with its current owner and is in the recovery queue.</Note>}

        <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Ownership history (server record)</h3>
        <ul className="tl">
          {d.data.assignments.map((a) => (
            <li key={a.id}><span className="ico gray"><UserRoundCog size={14} /></span>
              <div><b style={{ fontSize: 13 }}>{a.user_name ?? "—"} · {a.kind}{a.level ? ` (level ${a.level})` : ""}{!a.ended_at && " · current"}</b>
                <p className="faint">{a.reason} · {dateTime(a.assigned_at)}</p></div></li>
          ))}
        </ul>

        <h3 style={{ fontSize: 13, margin: "6px 0 8px" }}>Activity</h3>
        <ul className="list" style={{ margin: "0 -18px" }}>
          {d.data.activities.map((a) => <li key={a.id}><div className="grow"><b style={{ whiteSpace: "normal", fontSize: 13 }}>{a.summary}</b><span>{a.actor} · {dateTime(a.created_at)}</span></div></li>)}
        </ul>
        <p className="faint" style={{ marginTop: 10 }}>
          On leave / Offline: {d.data.absencePolicy === "keep_acknowledged" ? "unacknowledged leads move immediately; acknowledged leads stay with their owner." : "all open leads move immediately and must be re-acknowledged."}
        </p>
      </div>
      {reassigning && <ReassignModal leadId={id} currentOwner={l.owner_id} onClose={() => setReassigning(false)} />}
    </aside>
  );
}

function ReassignModal({ leadId, currentOwner, onClose }: { leadId: string; currentOwner: string | null; onClose: () => void }) {
  const toast = useToast();
  const users = useApi<{ users: { id: string; name: string; availability: string; active: boolean; open_leads: number }[] }>("/api/team/users");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/api/leads/${leadId}/reassign`, { body: { userId: f.get("userId"), reason: f.get("reason") || undefined } });
      toast("Lead reassigned; a new acknowledgement window started"); refreshAll(); onClose();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  const options = users.data?.users.filter((u) => u.id !== currentOwner && u.active) ?? [];
  return (
    <Modal title="Reassign lead" onClose={onClose} footer={<><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="pri" type="submit" form="ra" busy={busy}><UserRoundCog size={16} />Reassign</Btn></>}>
      <form id="ra" onSubmit={submit}>
        {error && <div style={{ marginBottom: 12 }}><ErrorBox>{error}</ErrorBox></div>}
        {!users.data ? <Loading /> : (
          <SelectField id="ra-user" name="userId" label="New owner" hint="People On leave or Offline cannot take leads; the server rejects them.">
            {options.map((u) => <option key={u.id} value={u.id} disabled={u.availability === "on_leave" || u.availability === "offline"}>{u.name} — {availLabel(u.availability)} · {u.open_leads} open</option>)}
          </SelectField>
        )}
        <Field id="ra-reason" name="reason" label="Reason (saved to the audit log)" placeholder="Workload balancing" />
        <Note>Counted as a manual reassignment, not an escalation.</Note>
      </form>
    </Modal>
  );
}
