import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { can, type Actor } from "../permissions";
import { getRules } from "./leads";

// One payload so every figure shares the glossary definitions (F5.2, Q12).
// Company scope requires dashboard.company; otherwise figures are personal (F5.4).
export const WIDGETS = ["new_leads", "pipeline", "first_response", "recovery", "escalations", "availability", "appointments", "payments"] as const;
export const PrefsInput = z.object({ hidden: z.array(z.enum(WIDGETS)).max(WIDGETS.length) });

export async function dashboard(actor: Actor) {
  const company = can(actor, "dashboard.company");
  const me = company ? null : actor.id;
  const ws = actor.workspaceId;
  const [{ timezone }] = await sql`select timezone from workspaces where id = ${ws}`;
  const rules = await getRules(sql, ws);
  const own = (col: string) => (me ? sql`and ${sql.unsafe(col)} = ${me}` : sql``);

  const [{ today_start }] = await sql`select (date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone}) as today_start`;
  const [newLeads] = await sql`
    select count(*)::int as n from leads l
    where l.workspace_id = ${ws} and l.created_at >= ${today_start} ${own("l.owner_id")}`;
  // Time to first response: first assignment → first acknowledgement (glossary). Personal = leads I first acknowledged.
  const [ttfr] = await sql`
    select avg(extract(epoch from l.first_acknowledged_at - l.first_assigned_at))::float as avg_s, count(*)::int as n
    from leads l where l.workspace_id = ${ws} and l.first_acknowledged_at is not null and l.first_assigned_at is not null
      and l.first_acknowledged_at >= now() - interval '30 days'
      ${me ? sql`and exists (select 1 from audit_log a where a.target_id = l.id::text and a.event = 'lead.acknowledged' and a.actor_id = ${me})` : sql``}`;
  const [recovery] = await sql`
    select count(*)::int as n from leads l
    where l.workspace_id = ${ws} and l.status in ('assigned','acknowledged') ${own("l.owner_id")}
      and ((l.status = 'assigned' and (l.chain_exhausted or l.ack_deadline < now())) or l.escalation_count >= 2
           or l.last_action_at < now() - make_interval(secs => ${rules.idle_seconds}))`;
  // Escalation = automatic reassignment from an expired window (manual reassignments excluded).
  const [esc] = await sql`
    select count(*)::int as n from lead_assignments a where a.workspace_id = ${ws} and a.kind = 'escalation'
      and a.assigned_at >= now() - interval '24 hours' ${own("a.user_id")}`;
  const showValue = can(actor, "crm.view_value");
  const pipeline = await sql`
    select s.id, s.name, s.position, p.name as pipeline, count(o.id)::int as count, coalesce(sum(o.value_cents), 0)::bigint as value_cents
    from stages s join pipelines p on p.id = s.pipeline_id
    left join opportunities o on o.stage_id = s.id ${own("o.owner_id")}
    where s.workspace_id = ${ws} and s.kind = 'open'
    group by s.id, s.name, s.position, p.name, p.position order by p.position, s.position`;
  const availability = await sql`
    select availability, count(*)::int as n from users where workspace_id = ${ws} and active group by 1`;
  const appointments = await sql`
    select a.id, a.title, a.starts_at, a.timezone, c.name as contact_name, u.name as user_name
    from appointments a left join contacts c on c.id = a.contact_id left join users u on u.id = a.user_id
    where a.workspace_id = ${ws} and a.status = 'scheduled' and a.starts_at >= now() ${own("a.user_id")}
    order by a.starts_at limit 5`;
  // Collected revenue (glossary): payments confirmed by provider webhook, minus confirmed refunds; this calendar month.
  const payments = await sql`
    select currency, coalesce(sum(amount_cents - refunded_cents), 0)::bigint as collected_cents, count(*)::int as count
    from payments where workspace_id = ${ws} and status in ('paid','partially_refunded','refunded')
      and paid_at >= date_trunc('month', now() at time zone ${timezone}) at time zone ${timezone} ${own("requested_by")}
    group by currency order by currency`;
  const [prefs] = await sql`select prefs from users where id = ${actor.id}`;

  return {
    scope: company ? "company" : "personal",
    timezone,
    today_start: new Date(today_start).toISOString(),
    hidden: (prefs?.prefs?.dashboardHidden as string[] | undefined) ?? [],
    new_leads_today: newLeads.n,
    open_pipeline: {
      value_masked: !showValue,
      total_cents: showValue ? pipeline.reduce((a, s) => a + Number(s.value_cents), 0) : null,
      by_stage: pipeline.map((s) => ({ id: s.id, name: s.name, pipeline: s.pipeline, count: s.count, value_cents: showValue ? Number(s.value_cents) : null })),
    },
    avg_first_response_seconds: ttfr.avg_s, first_response_sample: ttfr.n,
    recovery_queue: recovery.n,
    escalations_24h: esc.n,
    availability: Object.fromEntries(availability.map((a) => [a.availability, a.n])),
    upcoming_appointments: appointments,
    payments_month: payments.map((p) => ({ currency: p.currency, collected_cents: showValue ? Number(p.collected_cents) : null, count: p.count })),
    generated_at: new Date().toISOString(),
  };
}

export async function savePrefs(actor: Actor, input: z.infer<typeof PrefsInput>) {
  await sql`update users set prefs = jsonb_set(prefs, '{dashboardHidden}', ${sql.json(input.hidden as never)}) where id = ${actor.id}`;
  return { hidden: input.hidden };
}
