import "server-only";
import { z } from "zod";
import { sql, type Db, type Tx } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { activity, audit } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { setAvailability, type Availability } from "./team";
import { notifyUser } from "./notifications";

// ───────── Types & inputs ─────────
export type LeadSource = "web_form" | "message" | "manual";
export interface Level { type: "next_employee" | "backup" | "manager"; window_seconds: number }
export interface Rules {
  workspace_id: string;
  max_open_leads: number;
  ack_window_seconds: number;
  levels: Level[];
  backup_user_id: string | null;
  manager_user_id: string | null;
  idle_seconds: number;
  absence_policy: "keep_acknowledged" | "reassign_all";
  rr_last_user_id: string | null;
}

export const RulesInput = z.object({
  maxOpenLeads: z.number().int().min(1).max(1000),
  ackWindowSeconds: z.number().int().min(5).max(604800),
  levels: z
    .array(z.object({ type: z.enum(["next_employee", "backup", "manager"]), window_seconds: z.number().int().min(5).max(604800) }))
    .min(1)
    .max(10),
  backupUserId: z.string().uuid().nullable(),
  managerUserId: z.string().uuid().nullable(),
  idleSeconds: z.number().int().min(10).max(2592000),
  absencePolicy: z.enum(["keep_acknowledged", "reassign_all"]),
});

const phone = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +923001234567.");
export const LeadIntakeInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal("").transform(() => undefined)),
    phone: phone.optional().or(z.literal("").transform(() => undefined)),
    message: z.string().trim().max(2000).optional(),
    title: z.string().trim().max(160).optional(),
  })
  .refine((v) => v.email || v.phone, { message: "Provide an email or a phone number.", path: ["email"] });

export const ReassignInput = z.object({ userId: z.string().uuid(), reason: z.string().trim().max(300).optional() });

// ───────── Rules ─────────
export async function getRules(db: Db, workspaceId: string): Promise<Rules> {
  const [r] = await db<Rules[]>`select * from assignment_rules where workspace_id = ${workspaceId}`;
  if (!r) throw notFound("Assignment rules missing.");
  return r;
}

export async function updateRules(actor: Actor, input: z.infer<typeof RulesInput>) {
  requirePerm(actor, "assignment.manage");
  for (const uid of [input.backupUserId, input.managerUserId]) {
    if (!uid) continue;
    const [u] = await sql`select 1 from users where id = ${uid} and workspace_id = ${actor.workspaceId} and active`;
    if (!u) throw badRequest("Backup/manager must be an active user of this workspace.");
  }
  return sql.begin(async (tx) => {
    const before = await getRules(tx, actor.workspaceId);
    const [after] = await tx`
      update assignment_rules set max_open_leads = ${input.maxOpenLeads}, ack_window_seconds = ${input.ackWindowSeconds},
        levels = ${tx.json(input.levels as never)}, backup_user_id = ${input.backupUserId}, manager_user_id = ${input.managerUserId},
        idle_seconds = ${input.idleSeconds}, absence_policy = ${input.absencePolicy}, updated_at = now()
      where workspace_id = ${actor.workspaceId} returning *`;
    const strip = ({ rr_last_user_id: _r, updated_at: _u, ...rest }: Record<string, unknown>) => rest;
    await audit(tx, actor.workspaceId, actor, { event: "assignment_rules.changed", targetType: "assignment_rules", targetId: actor.workspaceId, before: strip(before as never), after: strip(after) });
    return after;
  });
}

// ───────── Assignment engine ─────────
/** Serialises every assignment decision within one workspace (Q5, F3.8). */
async function lockWorkspace(tx: Tx, workspaceId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${"assign:" + workspaceId}, 0))`;
}

/** Round-robin among Available employees below the open-lead limit (F3.3). */
async function pickRoundRobin(tx: Tx, rules: Rules, exclude: string[]): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    select u.id from users u
    where u.workspace_id = ${rules.workspace_id} and u.active and u.availability = 'available'
      and not (u.id = any(${exclude}::uuid[]))
      and (select count(*) from leads l where l.owner_id = u.id and l.status in ('assigned','acknowledged')) < ${rules.max_open_leads}
    order by u.created_at, u.id`;
  if (rows.length === 0) return null;
  const lastIdx = rows.findIndex((r) => r.id === rules.rr_last_user_id);
  let pick = rows[(lastIdx + 1) % rows.length];
  if (lastIdx === -1 && rules.rr_last_user_id) {
    // previous pick no longer eligible: continue after it in creation order
    const [next] = await tx<{ id: string }[]>`
      select u.id from users u where u.id = any(${rows.map((r) => r.id)}::uuid[])
        and (u.created_at, u.id) > (select created_at, id from users where id = ${rules.rr_last_user_id})
      order by u.created_at, u.id limit 1`;
    pick = next ?? rows[0];
  }
  await tx`update assignment_rules set rr_last_user_id = ${pick.id} where workspace_id = ${rules.workspace_id}`;
  rules.rr_last_user_id = pick.id;
  return pick.id;
}

async function activeUser(tx: Tx, workspaceId: string, id: string | null, exclude: string[]) {
  if (!id || exclude.includes(id)) return null;
  // Designated backup/manager must be present (not On leave / Offline) to receive a lead.
  const [u] = await tx`select id from users where id = ${id} and workspace_id = ${workspaceId} and active and availability in ('available','busy')`;
  return u ? (u.id as string) : null;
}

async function ownerOf(tx: Tx, workspaceId: string) {
  const [u] = await tx`select id from users where workspace_id = ${workspaceId} and base_role = 'owner'`;
  return u.id as string;
}

type Kind = "initial" | "escalation" | "manual" | "absence";

/** Ends the open assignment (if any) and gives the lead to `userId`. The partial unique index rejects double ownership. */
async function assign(
  tx: Tx,
  lead: { id: string; workspace_id: string; owner_id: string | null; title: string; source: string; contact_id: string | null; escalation_level: number },
  userId: string,
  opts: { kind: Kind; level: number; reason: string; windowSeconds: number | null; actor: Actor | null; status?: "assigned" | "acknowledged" },
) {
  await tx`update lead_assignments set ended_at = now() where lead_id = ${lead.id} and ended_at is null`;
  await tx`insert into lead_assignments (workspace_id, lead_id, user_id, kind, level, reason)
           values (${lead.workspace_id}, ${lead.id}, ${userId}, ${opts.kind}, ${opts.level}, ${opts.reason})`;
  const status = opts.status ?? "assigned";
  const deadline = status === "assigned" && opts.windowSeconds ? new Date(Date.now() + opts.windowSeconds * 1000) : null;
  await tx`
    update leads set owner_id = ${userId}, status = ${status}, assigned_at = now(),
      first_assigned_at = coalesce(first_assigned_at, now()),
      ack_deadline = ${deadline}, acknowledged_at = case when ${status} = 'assigned' then null else acknowledged_at end,
      escalation_level = ${opts.level},
      escalation_count = escalation_count + ${opts.kind === "escalation" ? 1 : 0},
      chain_exhausted = false, version = version + 1
    where id = ${lead.id}`;
  const [names] = await tx`select (select name from users where id = ${lead.owner_id}) as from_name, (select name from users where id = ${userId}) as to_name`;
  const summary = lead.owner_id
    ? `${opts.kind === "escalation" ? "Escalated" : "Reassigned"} from ${names.from_name ?? "—"} to ${names.to_name}: ${opts.reason}`
    : `Assigned to ${names.to_name}: ${opts.reason}`;
  await activity(tx, lead.workspace_id, opts.actor?.id ?? null, { leadId: lead.id, contactId: lead.contact_id, type: `lead.${opts.kind}`, summary });
  await audit(tx, lead.workspace_id, opts.actor, {
    event: opts.kind === "escalation" ? "lead.escalated" : opts.kind === "initial" ? "lead.assigned" : "lead.reassigned",
    targetType: "lead",
    targetId: lead.id,
    before: { owner_id: lead.owner_id, level: lead.escalation_level },
    after: { owner_id: userId, level: opts.level, kind: opts.kind, reason: opts.reason, ack_deadline: deadline },
  });
  const link = `/leads/${lead.id}`;
  const external = opts.kind === "escalation" || opts.kind === "absence";
  await notifyUser(tx, {
    workspaceId: lead.workspace_id,
    userId,
    leadId: lead.id,
    kind: `lead.${opts.kind}`,
    title: opts.kind === "escalation" ? `Escalated lead: ${lead.title}` : `New lead assigned: ${lead.title}`,
    body: `Source: ${lead.source}. ${opts.reason}.${deadline ? ` Acknowledge within ${opts.windowSeconds}s.` : ""}`,
    link,
    external,
  });
}

/** Chooses the first owner for a new lead; never leaves it unowned. */
async function initialOwner(tx: Tx, rules: Rules): Promise<{ userId: string; reason: string }> {
  const rr = await pickRoundRobin(tx, rules, []);
  if (rr) return { userId: rr, reason: "Round-robin among available employees" };
  const backup = await activeUser(tx, rules.workspace_id, rules.backup_user_id, []);
  if (backup) return { userId: backup, reason: "No available employee under the open-lead limit; sent to backup" };
  const mgr = await activeUser(tx, rules.workspace_id, rules.manager_user_id, []);
  if (mgr) return { userId: mgr, reason: "No available employee or backup; sent to manager" };
  return { userId: await ownerOf(tx, rules.workspace_id), reason: "No available employee, backup or manager; sent to Owner" };
}

// ───────── Capture (F3.1) ─────────
async function findOrCreateContact(tx: Tx, workspaceId: string, i: { name: string; email?: string; phone?: string }) {
  const [existing] = await tx`
    select id, name from contacts where workspace_id = ${workspaceId}
      and ((${i.phone ?? null}::text is not null and phone = ${i.phone ?? null})
        or (${i.email ?? null}::text is not null and lower(email) = ${i.email ?? null}))
    order by created_at limit 1`;
  if (existing) return { id: existing.id as string, created: false };
  const [c] = await tx`insert into contacts (workspace_id, name, email, phone) values (${workspaceId}, ${i.name}, ${i.email ?? null}, ${i.phone ?? null}) returning id`;
  return { id: c.id as string, created: true };
}

export async function captureLead(
  workspaceId: string,
  source: LeadSource,
  input: { name: string; email?: string; phone?: string; message?: string; title?: string; sourceDetail?: string; contactId?: string },
  actor: Actor | null,
  db?: Tx,
) {
  const run = async (tx: Tx) => {
    await lockWorkspace(tx, workspaceId);
    const rules = await getRules(tx, workspaceId);
    const contact = input.contactId ? { id: input.contactId, created: false } : await findOrCreateContact(tx, workspaceId, input);
    const title = input.title || `${input.name} (${source.replace("_", " ")})`;
    const [lead] = await tx`
      insert into leads (workspace_id, contact_id, source, source_detail, title, message)
      values (${workspaceId}, ${contact.id}, ${source}, ${input.sourceDetail ?? null}, ${title}, ${input.message ?? null})
      returning id, workspace_id, owner_id, title, source, contact_id, escalation_level`;
    await activity(tx, workspaceId, actor?.id ?? null, { leadId: lead.id, contactId: contact.id, type: "lead.created", summary: `Lead captured from ${source.replace("_", " ")}` });
    await audit(tx, workspaceId, actor, { event: "lead.created", targetType: "lead", targetId: lead.id, after: { source, title, contact_id: contact.id } });
    const { userId, reason } = await initialOwner(tx, rules);
    await tx`update contacts set owner_id = coalesce(owner_id, ${userId}) where id = ${contact.id}`;
    await assign(tx, lead as never, userId, { kind: "initial", level: 0, reason, windowSeconds: rules.ack_window_seconds, actor });
    return { leadId: lead.id as string, contactId: contact.id, ownerId: userId };
  };
  return db ? run(db) : sql.begin(run);
}

export async function createManualLead(actor: Actor, input: z.infer<typeof LeadIntakeInput>) {
  requirePerm(actor, "crm.create");
  return captureLead(actor.workspaceId, "manual", { ...input, sourceDetail: `Entered by ${actor.name}` }, actor);
}

// ───────── Acknowledge / act (F3.4) ─────────
export async function acknowledge(actor: Actor, leadId: string) {
  return sql.begin(async (tx) => {
    const [lead] = await tx`select * from leads where id = ${leadId} and workspace_id = ${actor.workspaceId} for update`;
    if (!lead) throw notFound("Lead not found.");
    if (lead.owner_id !== actor.id) throw forbidden("Only the current owner can acknowledge this lead.");
    if (lead.status !== "assigned") throw conflict(`This lead is already ${lead.status}.`);
    await markActed(tx, lead as never, actor, "acknowledged", "Acknowledged");
    return { ok: true };
  });
}

/** Any recorded action by the owner counts as acknowledgement (glossary: Acknowledged). */
export async function markActed(tx: Tx, lead: { id: string; workspace_id: string; owner_id: string | null; status: string; contact_id: string | null }, actor: Actor, how: string, summary: string) {
  await tx`update leads set last_action_at = now(), version = version + 1 where id = ${lead.id}`;
  if (lead.status === "assigned" && lead.owner_id === actor.id) {
    await tx`
      update leads set status = 'acknowledged', acknowledged_at = now(),
        first_acknowledged_at = coalesce(first_acknowledged_at, now()), ack_deadline = null, chain_exhausted = false
      where id = ${lead.id} and status = 'assigned'`;
    await activity(tx, lead.workspace_id, actor.id, { leadId: lead.id, contactId: lead.contact_id, type: "lead.acknowledged", summary: `${summary} by ${actor.name}` });
    await audit(tx, lead.workspace_id, actor, { event: "lead.acknowledged", targetType: "lead", targetId: lead.id, before: { status: "assigned" }, after: { status: "acknowledged", via: how } });
  }
}

/** Called by other modules (notes, messages, stage changes, appointments) when they act on a contact's open lead. */
export async function recordLeadAction(tx: Tx, actor: Actor, contactId: string, how: string) {
  const leads = await tx`select * from leads where workspace_id = ${actor.workspaceId} and contact_id = ${contactId} and status in ('assigned','acknowledged') for update`;
  for (const l of leads) await markActed(tx, l as never, actor, how, `Acted on (${how})`);
}

export async function closeLead(actor: Actor, leadId: string) {
  return sql.begin(async (tx) => {
    const [lead] = await tx`select * from leads where id = ${leadId} and workspace_id = ${actor.workspaceId} for update`;
    if (!lead) throw notFound("Lead not found.");
    if (lead.owner_id !== actor.id && !can(actor, "leads.assign")) throw forbidden("Only the owner or a lead manager can close this lead.");
    if (lead.status === "closed") throw conflict("This lead is already closed.");
    await tx`update lead_assignments set ended_at = now() where lead_id = ${leadId} and ended_at is null`;
    await tx`update leads set status = 'closed', closed_at = now(), ack_deadline = null, version = version + 1 where id = ${leadId}`;
    await activity(tx, actor.workspaceId, actor.id, { leadId, contactId: lead.contact_id, type: "lead.closed", summary: `Closed by ${actor.name}` });
    await audit(tx, actor.workspaceId, actor, { event: "lead.closed", targetType: "lead", targetId: leadId, before: { status: lead.status }, after: { status: "closed" } });
    return { ok: true };
  });
}

// ───────── Manual reassignment ─────────
export async function reassign(actor: Actor, leadId: string, input: z.infer<typeof ReassignInput>) {
  requirePerm(actor, "leads.assign");
  return sql.begin(async (tx) => {
    await lockWorkspace(tx, actor.workspaceId);
    const [lead] = await tx`select * from leads where id = ${leadId} and workspace_id = ${actor.workspaceId} for update`;
    if (!lead) throw notFound("Lead not found.");
    if (lead.status === "closed") throw conflict("Closed leads cannot be reassigned.");
    const target = await activeUser(tx, actor.workspaceId, input.userId, []);
    if (!target) throw badRequest("Choose an active user of this workspace who is not On leave or Offline.");
    if (target === lead.owner_id) throw conflict("This user already owns the lead.");
    const rules = await getRules(tx, actor.workspaceId);
    await assign(tx, lead as never, target, {
      kind: "manual", level: lead.escalation_level, reason: input.reason || `Manually reassigned by ${actor.name}`,
      windowSeconds: rules.ack_window_seconds, actor,
    });
    return { ok: true };
  });
}

// ───────── Escalation (F3.5, F3.8) ─────────
async function nextInChain(tx: Tx, rules: Rules, lead: { id: string; owner_id: string | null; escalation_level: number }) {
  const prior = (await tx<{ user_id: string }[]>`select distinct user_id from lead_assignments where lead_id = ${lead.id} and user_id is not null`).map((r) => r.user_id);
  const exclude = [...new Set([...prior, ...(lead.owner_id ? [lead.owner_id] : [])])];
  for (let i = lead.escalation_level; i < rules.levels.length; i++) {
    const lvl = rules.levels[i];
    let userId: string | null = null;
    let reason = "";
    if (lvl.type === "next_employee") {
      userId = await pickRoundRobin(tx, rules, exclude);
      reason = "Acknowledgement window expired; next available employee";
    } else if (lvl.type === "backup") {
      userId = await activeUser(tx, rules.workspace_id, rules.backup_user_id, lead.owner_id ? [lead.owner_id] : []);
      reason = "Acknowledgement window expired; designated backup";
    } else {
      userId = await activeUser(tx, rules.workspace_id, rules.manager_user_id, lead.owner_id ? [lead.owner_id] : []);
      reason = "Acknowledgement window expired; escalated to manager";
    }
    if (userId) return { userId, level: i + 1, reason, windowSeconds: lvl.window_seconds };
  }
  return null;
}

/** Escalates one expired lead. Re-checks under the row lock so two timers never escalate it twice. */
async function escalateOne(leadId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [peek] = await tx`select workspace_id from leads where id = ${leadId}`;
    if (!peek) return false;
    await lockWorkspace(tx, peek.workspace_id);
    const [lead] = await tx`
      select * from leads where id = ${leadId} and status = 'assigned' and not chain_exhausted
        and ack_deadline is not null and ack_deadline <= now() for update`;
    if (!lead) return false; // someone else handled it, or it was acknowledged meanwhile
    const rules = await getRules(tx, lead.workspace_id);
    const next = await nextInChain(tx, rules, lead as never);
    if (!next) {
      await tx`update leads set chain_exhausted = true, ack_deadline = null, version = version + 1 where id = ${leadId}`;
      await activity(tx, lead.workspace_id, null, { leadId, contactId: lead.contact_id, type: "lead.chain_exhausted", summary: "Escalation chain exhausted; lead stays with current owner and is in the recovery queue" });
      await audit(tx, lead.workspace_id, null, { event: "lead.chain_exhausted", targetType: "lead", targetId: leadId, after: { owner_id: lead.owner_id } });
      return true;
    }
    await assign(tx, lead as never, next.userId, { kind: "escalation", level: next.level, reason: next.reason, windowSeconds: next.windowSeconds, actor: null });
    return true;
  });
}

export async function escalateDue(limit = 50) {
  const due = await sql<{ id: string }[]>`
    select id from leads where status = 'assigned' and not chain_exhausted and ack_deadline <= now()
    order by ack_deadline limit ${limit}`;
  let escalated = 0;
  for (const d of due) if (await escalateOne(d.id)) escalated++;
  return { checked: due.length, escalated };
}

// ───────── Absence (F3.6) ─────────
export async function changeAvailability(actor: Actor, userId: string, availability: Availability) {
  const res = await setAvailability(actor, userId, availability);
  if (availability !== "on_leave" && availability !== "offline") return { ...res, reassigned: 0 };
  const reassigned = await sql.begin(async (tx) => {
    await lockWorkspace(tx, actor.workspaceId);
    const rules = await getRules(tx, actor.workspaceId);
    const statuses = rules.absence_policy === "reassign_all" ? ["assigned", "acknowledged"] : ["assigned"];
    const leads = await tx`select * from leads where workspace_id = ${actor.workspaceId} and owner_id = ${userId} and status = any(${statuses}) for update`;
    for (const lead of leads) {
      const rr = await pickRoundRobin(tx, rules, [userId]);
      const fallback = rr ?? (await activeUser(tx, actor.workspaceId, rules.backup_user_id, [userId])) ?? (await activeUser(tx, actor.workspaceId, rules.manager_user_id, [userId])) ?? (await ownerOf(tx, actor.workspaceId));
      if (fallback === userId) continue; // owner going offline with nobody else: keep, recovery queue will show it
      await assign(tx, lead as never, fallback, {
        kind: "absence", level: lead.escalation_level,
        reason: `Previous owner set to ${availability.replace("_", " ")}`, windowSeconds: rules.ack_window_seconds, actor,
      });
    }
    return leads.length;
  });
  return { ...res, reassigned };
}

// ───────── Queries ─────────
/** Accountable owners always see their own leads; crm.view + crm.view_all widens to the whole workspace. */
function visibility(actor: Actor) {
  return can(actor, "crm.view") && can(actor, "crm.view_all") ? null : actor.id;
}

// One definition of each lead state, shared by lists, counts, the recovery queue and the dashboard (Q12).
// Recovery item (glossary): unacknowledged beyond its window, escalated 2+ times, or idle beyond the configured period.
function stateSql(idleSeconds: number) {
  const open = sql`l.status in ('assigned','acknowledged')`;
  const overdue = sql`(l.status = 'assigned' and (l.chain_exhausted or l.ack_deadline < now()))`;
  const idle = sql`(l.last_action_at < now() - make_interval(secs => ${idleSeconds}))`;
  return {
    unack: sql`(l.status = 'assigned' and not l.chain_exhausted and l.ack_deadline >= now())`,
    ack: sql`l.status = 'acknowledged'`,
    overdue,
    escalated: sql`(${open} and l.escalation_count > 0)`,
    recovery: sql`(${open} and (${overdue} or l.escalation_count >= 2 or ${idle}))`,
    open,
    closed: sql`l.status = 'closed'`,
    reasons: sql`case when ${open} then array_remove(array[
        case when ${overdue} then 'Unacknowledged beyond its window' end,
        case when l.escalation_count >= 2 then 'Escalated ' || l.escalation_count || ' times' end,
        case when ${idle} then 'No recorded action for over ' || ${Math.max(1, Math.round(idleSeconds / 60))} || ' min' end
      ], null) else '{}'::text[] end`,
  };
}
export const LEAD_STATES = ["all", "unack", "ack", "overdue", "escalated", "recovery", "open", "closed"] as const;

export const LeadListQuery = z.object({
  state: z.enum(LEAD_STATES).default("all"),
  source: z.enum(["web_form", "message", "manual"]).optional(),
  ownerId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  createdFrom: z.string().datetime({ offset: true }).optional(),
  escalatedWithinHours: z.coerce.number().int().min(1).max(720).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listLeads(actor: Actor, q: z.infer<typeof LeadListQuery>) {
  const mine = visibility(actor);
  const rules = await getRules(sql, actor.workspaceId);
  const st = stateSql(rules.idle_seconds);
  const where = sql`
    l.workspace_id = ${actor.workspaceId}
    ${mine ? sql`and l.owner_id = ${mine}` : sql``}
    ${q.state !== "all" ? sql`and ${st[q.state]}` : sql``}
    ${q.source ? sql`and l.source = ${q.source}` : sql``}
    ${q.ownerId ? sql`and l.owner_id = ${q.ownerId}` : sql``}
    ${q.createdFrom ? sql`and l.created_at >= ${q.createdFrom}` : sql``}
    ${q.escalatedWithinHours ? sql`and exists (select 1 from lead_assignments ea where ea.lead_id = l.id and ea.kind = 'escalation' and ea.assigned_at >= now() - make_interval(hours => ${q.escalatedWithinHours}))` : sql``}
    ${q.q ? sql`and (l.title ilike ${"%" + q.q + "%"} or c.name ilike ${"%" + q.q + "%"} or c.email ilike ${"%" + q.q + "%"} or c.phone ilike ${"%" + q.q + "%"} or co.name ilike ${"%" + q.q + "%"})` : sql``}`;
  const from = sql`leads l left join users u on u.id = l.owner_id left join contacts c on c.id = l.contact_id left join companies co on co.id = c.company_id`;
  const [{ total }] = await sql`select count(*)::int as total from ${from} where ${where}`;
  const rows = await sql`
    select l.id, l.title, l.source, l.source_detail, l.status, l.owner_id, u.name as owner_name, l.contact_id, c.name as contact_name,
           c.email as contact_email, c.phone as contact_phone, co.name as company_name,
           l.assigned_at, l.ack_deadline, l.acknowledged_at, l.escalation_level, l.escalation_count, l.chain_exhausted, l.created_at,
           ${st.reasons} as recovery_reasons
    from ${from} where ${where} order by l.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`;
  return { total, page: q.page, pageSize: q.pageSize, leads: rows, serverTime: new Date().toISOString() };
}

/** Counts per state with the same definitions as the list filters. */
export async function leadSummary(actor: Actor) {
  const mine = visibility(actor);
  const rules = await getRules(sql, actor.workspaceId);
  const st = stateSql(rules.idle_seconds);
  const [r] = await sql`
    select count(*)::int as all,
      count(*) filter (where ${st.unack})::int as unack, count(*) filter (where ${st.ack})::int as ack,
      count(*) filter (where ${st.overdue})::int as overdue, count(*) filter (where ${st.escalated})::int as escalated,
      count(*) filter (where ${st.recovery})::int as recovery, count(*) filter (where ${st.open})::int as open
    from leads l where l.workspace_id = ${actor.workspaceId} ${mine ? sql`and l.owner_id = ${mine}` : sql``}`;
  return r;
}

export async function getLead(actor: Actor, leadId: string) {
  const mine = visibility(actor);
  const rules = await getRules(sql, actor.workspaceId);
  const st = stateSql(rules.idle_seconds);
  const [lead] = await sql`
    select l.*, u.name as owner_name, c.name as contact_name, c.phone as contact_phone, c.email as contact_email, co.name as company_name,
           ${st.reasons} as recovery_reasons
    from leads l left join users u on u.id = l.owner_id left join contacts c on c.id = l.contact_id left join companies co on co.id = c.company_id
    where l.id = ${leadId} and l.workspace_id = ${actor.workspaceId} ${mine ? sql`and l.owner_id = ${mine}` : sql``}`;
  if (!lead) throw notFound("Lead not found.");
  const [assignments, activities, names] = await Promise.all([
    sql`select a.*, u.name as user_name from lead_assignments a left join users u on u.id = a.user_id where a.lead_id = ${leadId} order by a.assigned_at`,
    sql`select a.id, a.type, a.summary, a.created_at, coalesce(u.name, 'System') as actor from activities a left join users u on u.id = a.actor_id where a.lead_id = ${leadId} order by a.created_at desc limit 200`,
    sql`select (select name from users where id = ${rules.backup_user_id}) as backup, (select name from users where id = ${rules.manager_user_id}) as manager`,
  ]);
  return {
    lead, assignments, activities, serverTime: new Date().toISOString(),
    absencePolicy: rules.absence_policy,
    chain: { ackWindowSeconds: rules.ack_window_seconds, levels: rules.levels, backupName: names[0].backup, managerName: names[0].manager },
  };
}

export async function recoveryQueue(actor: Actor) {
  const r = await listLeads(actor, { state: "recovery", page: 1, pageSize: 100 });
  return r.leads.map((l) => ({ ...l, reasons: l.recovery_reasons }));
}
