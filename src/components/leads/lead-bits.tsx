"use client";
import { Check, Clock, LifeBuoy, Minus, Siren, Timer, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Pill, type Tone } from "@/components/ui/primitives";

export interface LeadRow {
  id: string; title: string; source: string; source_detail: string | null; status: string;
  owner_id: string | null; owner_name: string | null; contact_id: string | null; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null; company_name: string | null;
  assigned_at: string | null; ack_deadline: string | null; acknowledged_at: string | null;
  escalation_level: number; escalation_count: number; chain_exhausted: boolean; created_at: string; recovery_reasons: string[];
}

/** Display-only mapping of server state; the server decides assignment and escalation. */
export function leadState(l: Pick<LeadRow, "status" | "ack_deadline" | "chain_exhausted" | "escalation_count" | "recovery_reasons">, nowMs: number) {
  if (l.status === "closed") return { label: "Closed", tone: "gray" as Tone, icon: <Minus size={12} />, row: "" };
  if (l.status === "acknowledged") return { label: "Acknowledged", tone: "green" as Tone, icon: <Check size={12} />, row: "lvl-green" };
  const overdue = l.chain_exhausted || (l.ack_deadline !== null && Date.parse(l.ack_deadline) <= nowMs);
  if (overdue) return { label: l.chain_exhausted ? "Overdue · chain exhausted" : "Overdue · escalating", tone: "red" as Tone, icon: <TriangleAlert size={12} />, row: "lvl-red" };
  if (l.escalation_count > 0) return { label: `Escalated L${l.escalation_count}`, tone: "red" as Tone, icon: <Siren size={12} />, row: "lvl-amber" };
  return { label: "Unacknowledged", tone: "amber" as Tone, icon: <Clock size={12} />, row: "lvl-amber" };
}

export function RecoveryPill({ reasons }: { reasons: string[] }) {
  if (!reasons?.length) return null;
  return <Pill tone="pink" icon={<LifeBuoy size={12} />}>In recovery</Pill>;
}

/** Ticks every second; corrects client clock skew with the server time from the last response. */
export function useServerNow(serverTime: string | undefined) {
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (serverTime) setSkew(Date.parse(serverTime) - Date.now()); }, [serverTime]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now + skew;
}

export function Countdown({ deadline, now, status }: { deadline: string | null; now: number; status: string }) {
  if (status !== "assigned") return <span className="cd gray"><Minus size={14} />Done</span>;
  if (!deadline) return <span className="cd red"><TriangleAlert size={14} />No window (chain exhausted)</span>;
  const left = Math.round((Date.parse(deadline) - now) / 1000);
  if (left <= 0) return <span className="cd red" title="The server escalates this lead on its next worker pass"><TriangleAlert size={14} />{Math.abs(left)}s overdue · server escalating</span>;
  const m = Math.floor(left / 60), s = left % 60;
  return (
    <span className={`cd ${left <= 60 ? "red" : "amber"}`} aria-label={`${m} minutes ${s} seconds left to acknowledge`}>
      <Timer size={14} /><span>{m}:{String(s).padStart(2, "0")}</span> left
    </span>
  );
}
