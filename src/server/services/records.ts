import "server-only";
import { z } from "zod";
import { sql, type Tx } from "../db";
import { AppError, badRequest, conflict, forbidden, notFound } from "../http";
import { activity, audit } from "../audit";
import { can, requirePerm, type Actor } from "../permissions";
import { fieldsFor, validateCustom } from "./crm-config";
import { recordLeadAction } from "./leads";

// ───────── Inputs ─────────
const phone = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +923001234567.");
const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const custom = z.record(z.string(), z.unknown()).optional();

export const CompanyInput = z.object({ name: z.string().trim().min(1).max(160), domain: optStr(200), custom });
export const ContactInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  phone: phone.optional().nullable().or(z.literal("").transform(() => null)),
  companyId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  optedOut: z.boolean().optional(),
  custom,
  version: z.number().int().optional(),
});
export const OpportunityInput = z.object({
  title: z.string().trim().min(1).max(160),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  value: z.number().min(0).max(1e10).optional(),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/).default("usd"),
  custom,
  version: z.number().int().optional(),
});
export const MoveInput = z.object({ stageId: z.string().uuid(), version: z.number().int() });
export const NoteInput = z.object({ body: z.string().trim().min(1).max(5000) });

export const FilterSpec = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
  custom: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), op: z.enum(["eq", "contains", "gt", "lt"]), value: z.string().max(200) })).max(10).optional(),
});
export type Filters = z.infer<typeof FilterSpec>;
export const ListQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const SavedListInput = z.object({ name: z.string().trim().min(1).max(80), entity: z.enum(["contact", "opportunity"]), filters: FilterSpec });

// ───────── Helpers ─────────
const own = (a: Actor) => (can(a, "crm.view_all") ? null : a.id);

async function sameWorkspace(tx: Tx | typeof sql, actor: Actor, table: "companies" | "contacts" | "users" | "pipelines", id: string | null | undefined) {
  if (!id) return;
  const [r] = await tx`select 1 from ${tx(table)} where id = ${id} and workspace_id = ${actor.workspaceId}`;
  if (!r) throw badRequest(`Unknown ${table.slice(0, -1).replace("ie", "y")}.`);
}

function maskOpp<T extends Record<string, unknown>>(actor: Actor, o: T): T {
  if (can(actor, "crm.view_value")) return { ...o, value_masked: false };
  return { ...o, value_cents: null, value_masked: true };
}

function filterSql(db: Tx | typeof sql, entity: "contact" | "opportunity", f: Filters, alias: string) {
  const a = db.unsafe(alias); // fixed internal alias, never user input
  const parts = [db`true`];
  if (f.q) parts.push(entity === "contact" ? db`(${a}.name ilike ${"%" + f.q + "%"} or ${a}.email ilike ${"%" + f.q + "%"} or ${a}.phone ilike ${"%" + f.q + "%"})` : db`${a}.title ilike ${"%" + f.q + "%"}`);
  if (f.tag) parts.push(entity === "contact" ? db`${f.tag} = any(${a}.tags)` : db`exists (select 1 from contacts tc where tc.id = ${a}.contact_id and ${f.tag} = any(tc.tags))`);
  if (f.pipelineId && entity === "opportunity") parts.push(db`${a}.pipeline_id = ${f.pipelineId}`);
  if (f.stageId) parts.push(entity === "opportunity" ? db`${a}.stage_id = ${f.stageId}` : db`exists (select 1 from opportunities so where so.contact_id = ${a}.id and so.stage_id = ${f.stageId})`);
  if (f.ownerId) parts.push(db`${a}.owner_id = ${f.ownerId}`);
  if (f.createdFrom) parts.push(db`${a}.created_at >= ${f.createdFrom}::date`);
  if (f.createdTo) parts.push(db`${a}.created_at < ${f.createdTo}::date + 1`);
  for (const c of f.custom ?? []) {
    const val = db`${a}.custom ->> ${c.key}`;
    if (c.op === "eq") parts.push(db`${val} = ${c.value}`);
    else if (c.op === "contains") parts.push(db`${val} ilike ${"%" + c.value + "%"}`);
    else {
      const n = Number(c.value);
      if (!Number.isFinite(n) && Number.isNaN(Date.parse(c.value))) throw badRequest(`Filter on ${c.key} needs a number or date.`);
      const lhs = Number.isFinite(n) ? db`case when ${val} ~ '^-?[0-9.]+$' then (${val})::numeric end` : db`(${val})`;
      const rhs = Number.isFinite(n) ? db`${n}::numeric` : db`${c.value}`;
      parts.push(c.op === "gt" ? db`${lhs} > ${rhs}` : db`${lhs} < ${rhs}`);
    }
  }
  return parts.reduce((acc, p) => db`${acc} and ${p}`);
}

// ───────── Companies ─────────
export async function listCompanies(actor: Actor, q: { q?: string; page: number; pageSize: number }) {
  requirePerm(actor, "crm.view");
  const where = sql`workspace_id = ${actor.workspaceId} ${q.q ? sql`and name ilike ${"%" + q.q + "%"}` : sql``}`;
  const [{ total }] = await sql`select count(*)::int as total from companies where ${where}`;
  const rows = await sql`select c.*, (select count(*)::int from contacts x where x.company_id = c.id) as contacts
    from companies c where ${where} order by name limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`;
  return { total, page: q.page, pageSize: q.pageSize, companies: rows };
}

export async function createCompany(actor: Actor, input: z.infer<typeof CompanyInput>) {
  requirePerm(actor, "crm.create");
  const customVals = validateCustom(await fieldsFor(actor.workspaceId, "company"), input.custom);
  return sql.begin(async (tx) => {
    const [c] = await tx`insert into companies (workspace_id, name, domain, custom) values (${actor.workspaceId}, ${input.name}, ${input.domain}, ${tx.json(customVals as never)}) returning *`;
    await audit(tx, actor.workspaceId, actor, { event: "company.created", targetType: "company", targetId: c.id, after: { name: c.name } });
    return c;
  });
}

export async function getCompany(actor: Actor, id: string) {
  requirePerm(actor, "crm.view");
  const [c] = await sql`select * from companies where id = ${id} and workspace_id = ${actor.workspaceId}`;
  if (!c) throw notFound("Company not found.");
  const mine = own(actor);
  const contacts = await sql`select id, name, email, phone from contacts where company_id = ${id} ${mine ? sql`and owner_id = ${mine}` : sql``} order by name limit 200`;
  return { company: c, contacts, fields: await fieldsFor(actor.workspaceId, "company") };
}

// ───────── Contacts ─────────
export async function listContacts(actor: Actor, f: Filters, page: z.infer<typeof ListQuery>) {
  requirePerm(actor, "crm.view");
  const mine = own(actor);
  const where = sql`c.workspace_id = ${actor.workspaceId} ${mine ? sql`and c.owner_id = ${mine}` : sql``} and ${filterSql(sql, "contact", f, "c")}`;
  const [{ total }] = await sql`select count(*)::int as total from contacts c where ${where}`;
  const rows = await sql`
    select c.id, c.name, c.email, c.phone, c.tags, c.owner_id, u.name as owner_name, c.company_id, co.name as company_name,
           c.opted_out, c.custom, c.created_at
    from contacts c left join users u on u.id = c.owner_id left join companies co on co.id = c.company_id
    where ${where} order by c.created_at desc limit ${page.pageSize} offset ${(page.page - 1) * page.pageSize}`;
  return { total, page: page.page, pageSize: page.pageSize, contacts: rows };
}

async function loadContact(actor: Actor, id: string, db: Tx | typeof sql = sql, lock = false) {
  const mine = own(actor);
  const [c] = await db`select * from contacts where id = ${id} and workspace_id = ${actor.workspaceId}
    ${mine ? db`and owner_id = ${mine}` : db``} ${lock ? db`for update` : db``}`;
  if (!c) throw notFound("Contact not found.");
  return c;
}

export async function createContact(actor: Actor, input: z.infer<typeof ContactInput>) {
  requirePerm(actor, "crm.create");
  await sameWorkspace(sql, actor, "companies", input.companyId);
  await sameWorkspace(sql, actor, "users", input.ownerId);
  const customVals = validateCustom(await fieldsFor(actor.workspaceId, "contact"), input.custom);
  return sql.begin(async (tx) => {
    const [c] = await tx`
      insert into contacts (workspace_id, company_id, name, email, phone, tags, owner_id, opted_out, opted_out_at, custom)
      values (${actor.workspaceId}, ${input.companyId ?? null}, ${input.name}, ${input.email ?? null}, ${input.phone ?? null}, ${input.tags ?? []},
              ${input.ownerId ?? actor.id}, ${input.optedOut ?? false}, ${input.optedOut ? new Date() : null}, ${tx.json(customVals as never)})
      returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: c.id, type: "contact.created", summary: `Contact created by ${actor.name}` });
    await audit(tx, actor.workspaceId, actor, { event: "contact.created", targetType: "contact", targetId: c.id, after: { name: c.name, email: c.email, phone: c.phone } });
    return c;
  });
}

const TRACKED_CONTACT = ["name", "email", "phone", "company_id", "owner_id", "tags", "opted_out", "custom"] as const;

export async function updateContact(actor: Actor, id: string, input: z.infer<typeof ContactInput>) {
  requirePerm(actor, "crm.edit");
  if (input.version === undefined) throw badRequest("Missing record version.");
  await sameWorkspace(sql, actor, "companies", input.companyId);
  await sameWorkspace(sql, actor, "users", input.ownerId);
  if (input.ownerId !== undefined && !can(actor, "leads.assign") && input.ownerId !== actor.id) throw forbidden("Only lead managers can give a contact to someone else.");
  const defs = await fieldsFor(actor.workspaceId, "contact");
  return sql.begin(async (tx) => {
    const before = await loadContact(actor, id, tx, true);
    if (before.version !== input.version) throw conflict("Someone else changed this contact. Reload to see their changes, then try again.", { currentVersion: before.version });
    const customVals = { ...before.custom, ...validateCustom(defs, input.custom) };
    const [after] = await tx`
      update contacts set name = ${input.name}, email = ${input.email ?? null}, phone = ${input.phone ?? null},
        company_id = ${input.companyId ?? null}, owner_id = ${input.ownerId === undefined ? before.owner_id : input.ownerId},
        tags = ${input.tags ?? before.tags}, opted_out = ${input.optedOut ?? before.opted_out},
        opted_out_at = case when ${input.optedOut ?? before.opted_out} and not opted_out then now() when not ${input.optedOut ?? before.opted_out} then null else opted_out_at end,
        custom = ${tx.json(customVals as never)}, version = version + 1, updated_at = now()
      where id = ${id} returning *`;
    const changed = TRACKED_CONTACT.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      const b = Object.fromEntries(changed.map((k) => [k, before[k]]));
      const a = Object.fromEntries(changed.map((k) => [k, after[k]]));
      await activity(tx, actor.workspaceId, actor.id, { contactId: id, type: "contact.edited", summary: `${actor.name} edited ${changed.join(", ")}`, data: { before: b, after: a } });
      await audit(tx, actor.workspaceId, actor, { event: "contact.updated", targetType: "contact", targetId: id, before: b, after: a });
      await recordLeadAction(tx, actor, id, "field edit");
    }
    return after;
  });
}

export async function deleteContact(actor: Actor, id: string) {
  requirePerm(actor, "crm.delete");
  return sql.begin(async (tx) => {
    const c = await loadContact(actor, id, tx, true);
    await tx`update leads set status = 'closed', closed_at = now(), ack_deadline = null where contact_id = ${id} and status <> 'closed'`;
    await tx`update lead_assignments set ended_at = now() where ended_at is null and lead_id in (select id from leads where contact_id = ${id})`;
    await tx`delete from contacts where id = ${id}`;
    await audit(tx, actor.workspaceId, actor, { event: "contact.deleted", targetType: "contact", targetId: id, before: { name: c.name, email: c.email, phone: c.phone } });
  });
}

export async function addNote(actor: Actor, contactId: string, input: z.infer<typeof NoteInput>, opportunityId?: string) {
  requirePerm(actor, "crm.edit");
  return sql.begin(async (tx) => {
    await loadContact(actor, contactId, tx);
    await activity(tx, actor.workspaceId, actor.id, { contactId, opportunityId: opportunityId ?? null, type: "note", summary: input.body });
    await recordLeadAction(tx, actor, contactId, "note");
    return { ok: true };
  });
}

/** Complete customer view (F2.8). */
export async function contact360(actor: Actor, id: string) {
  requirePerm(actor, "crm.view");
  const c = await loadContact(actor, id);
  const [owner, company, opps, conversations, payments, appointments, leads, timeline] = await Promise.all([
    c.owner_id ? sql`select id, name, email, availability from users where id = ${c.owner_id}` : Promise.resolve([]),
    c.company_id ? sql`select id, name, domain from companies where id = ${c.company_id}` : Promise.resolve([]),
    sql`select o.id, o.title, o.value_cents, o.currency, o.stage_id, s.name as stage_name, s.kind as stage_kind, p.name as pipeline_name, o.version
        from opportunities o join stages s on s.id = o.stage_id join pipelines p on p.id = o.pipeline_id where o.contact_id = ${id} order by o.created_at desc`,
    sql`select cv.id, cv.channel, cv.assignee_id, u.name as assignee_name, cv.last_message_at,
          (select json_agg(m order by m.created_at) from (select id, direction, body, status, error_message, created_at from messages where conversation_id = cv.id order by created_at desc limit 50) m) as messages
        from conversations cv left join users u on u.id = cv.assignee_id where cv.contact_id = ${id}`,
    sql`select id, opportunity_id, amount_cents, currency, status, refunded_cents, url, provider_session, created_at, paid_at from payments where contact_id = ${id} order by created_at desc`,
    sql`select a.id, a.title, a.starts_at, a.ends_at, a.timezone, a.status, a.user_id, u.name as user_name from appointments a left join users u on u.id = a.user_id where a.contact_id = ${id} order by a.starts_at desc`,
    sql`select id, title, source, status, owner_id, ack_deadline, created_at from leads where contact_id = ${id} order by created_at desc`,
    sql`select a.id, a.type, a.summary, a.created_at, a.opportunity_id, coalesce(u.name, 'System') as actor
        from activities a left join users u on u.id = a.actor_id
        where a.workspace_id = ${actor.workspaceId} and (a.contact_id = ${id} or a.opportunity_id in (select id from opportunities where contact_id = ${id}))
        order by a.created_at desc limit 300`,
  ]);
  const showValue = can(actor, "crm.view_value");
  return {
    contact: c,
    owner: owner[0] ?? null,
    company: company[0] ?? null,
    opportunities: opps.map((o) => maskOpp(actor, o)),
    conversations,
    payments: showValue ? payments : payments.map((p) => ({ ...p, amount_cents: null, refunded_cents: null, value_masked: true })),
    appointments,
    leads,
    timeline,
    fields: await fieldsFor(actor.workspaceId, "contact"),
  };
}

// ───────── Opportunities ─────────
export async function listOpportunities(actor: Actor, f: Filters, page: z.infer<typeof ListQuery>) {
  requirePerm(actor, "crm.view");
  const mine = own(actor);
  const where = sql`o.workspace_id = ${actor.workspaceId} ${mine ? sql`and o.owner_id = ${mine}` : sql``} and ${filterSql(sql, "opportunity", f, "o")}`;
  const [{ total }] = await sql`select count(*)::int as total from opportunities o where ${where}`;
  const rows = await sql`
    select o.id, o.title, o.value_cents, o.currency, o.pipeline_id, o.stage_id, s.name as stage_name, s.kind as stage_kind,
           o.contact_id, c.name as contact_name, o.owner_id, u.name as owner_name, o.custom, o.version, o.created_at, o.updated_at
    from opportunities o join stages s on s.id = o.stage_id left join contacts c on c.id = o.contact_id left join users u on u.id = o.owner_id
    where ${where} order by o.updated_at desc limit ${page.pageSize} offset ${(page.page - 1) * page.pageSize}`;
  return { total, page: page.page, pageSize: page.pageSize, opportunities: rows.map((o) => maskOpp(actor, o)) };
}

async function loadOpp(actor: Actor, id: string, db: Tx | typeof sql = sql, lock = false) {
  const mine = own(actor);
  const [o] = await db`select * from opportunities where id = ${id} and workspace_id = ${actor.workspaceId}
    ${mine ? db`and owner_id = ${mine}` : db``} ${lock ? db`for update` : db``}`;
  if (!o) throw notFound("Opportunity not found.");
  return o;
}

async function missingRequired(tx: Tx, stageId: string, customVals: Record<string, unknown>) {
  const req = await tx`select f.key, f.label from stage_required_fields r join custom_fields f on f.id = r.field_id where r.stage_id = ${stageId}`;
  return req.filter((f) => customVals[f.key] === undefined || customVals[f.key] === null || customVals[f.key] === "" || customVals[f.key] === false).map((f) => f.label as string);
}

export async function getOpportunity(actor: Actor, id: string) {
  requirePerm(actor, "crm.view");
  const o = await loadOpp(actor, id);
  const [timeline, payments, appointments] = await Promise.all([
    sql`select a.id, a.type, a.summary, a.created_at, coalesce(u.name, 'System') as actor from activities a left join users u on u.id = a.actor_id where a.opportunity_id = ${id} order by a.created_at desc limit 300`,
    sql`select id, amount_cents, currency, status, refunded_cents, url, provider_session, requested_by, created_at, paid_at from payments where opportunity_id = ${id} order by created_at desc`,
    sql`select id, title, starts_at, ends_at, timezone, status, user_id from appointments where opportunity_id = ${id} order by starts_at desc`,
  ]);
  const showValue = can(actor, "crm.view_value");
  return {
    opportunity: maskOpp(actor, o),
    timeline,
    payments: showValue ? payments : payments.map((p) => ({ ...p, amount_cents: null, refunded_cents: null, value_masked: true })),
    appointments,
    fields: await fieldsFor(actor.workspaceId, "opportunity", o.pipeline_id),
  };
}

export async function createOpportunity(actor: Actor, input: z.infer<typeof OpportunityInput>) {
  requirePerm(actor, "crm.create");
  await sameWorkspace(sql, actor, "pipelines", input.pipelineId);
  await sameWorkspace(sql, actor, "contacts", input.contactId);
  await sameWorkspace(sql, actor, "companies", input.companyId);
  await sameWorkspace(sql, actor, "users", input.ownerId);
  if (input.value !== undefined && !can(actor, "crm.view_value")) throw forbidden("You cannot set opportunity values.");
  const customVals = validateCustom(await fieldsFor(actor.workspaceId, "opportunity", input.pipelineId), input.custom);
  return sql.begin(async (tx) => {
    const [stage] = input.stageId
      ? await tx`select id, kind from stages where id = ${input.stageId} and pipeline_id = ${input.pipelineId}`
      : await tx`select id, kind from stages where pipeline_id = ${input.pipelineId} order by position limit 1`;
    if (!stage) throw badRequest("Stage must belong to the selected pipeline.");
    const missing = await missingRequired(tx, stage.id, customVals);
    if (missing.length) throw badRequest(`Fill required fields for this stage: ${missing.join(", ")}.`, missing.map((m) => ({ path: "custom", message: `${m} is required` })));
    const [o] = await tx`
      insert into opportunities (workspace_id, pipeline_id, stage_id, contact_id, company_id, title, value_cents, currency, owner_id, custom, closed_at)
      values (${actor.workspaceId}, ${input.pipelineId}, ${stage.id}, ${input.contactId ?? null}, ${input.companyId ?? null}, ${input.title},
              ${Math.round((input.value ?? 0) * 100)}, ${input.currency}, ${input.ownerId ?? actor.id}, ${tx.json(customVals as never)},
              ${stage.kind === "open" ? null : new Date()})
      returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: o.contact_id, opportunityId: o.id, type: "opportunity.created", summary: `Opportunity "${o.title}" created` });
    await audit(tx, actor.workspaceId, actor, { event: "opportunity.created", targetType: "opportunity", targetId: o.id, after: { title: o.title, stage_id: o.stage_id, value_cents: o.value_cents } });
    if (o.contact_id) await tx`update leads set opportunity_id = coalesce(opportunity_id, ${o.id}) where contact_id = ${o.contact_id} and status <> 'closed'`;
    return maskOpp(actor, o);
  });
}

const TRACKED_OPP = ["title", "value_cents", "currency", "contact_id", "company_id", "owner_id", "custom"] as const;

export async function updateOpportunity(actor: Actor, id: string, input: Omit<z.infer<typeof OpportunityInput>, "pipelineId" | "stageId">) {
  requirePerm(actor, "crm.edit");
  if (input.version === undefined) throw badRequest("Missing record version.");
  await sameWorkspace(sql, actor, "contacts", input.contactId);
  await sameWorkspace(sql, actor, "companies", input.companyId);
  await sameWorkspace(sql, actor, "users", input.ownerId);
  if (input.value !== undefined && !can(actor, "crm.view_value")) throw forbidden("You cannot change opportunity values.");
  return sql.begin(async (tx) => {
    const before = await loadOpp(actor, id, tx, true);
    if (before.version !== input.version) throw conflict("Someone else changed this opportunity. Reload and try again.", { currentVersion: before.version });
    const defs = await fieldsFor(actor.workspaceId, "opportunity", before.pipeline_id);
    const customVals = { ...before.custom, ...validateCustom(defs, input.custom) };
    const missing = await missingRequired(tx, before.stage_id, customVals);
    if (missing.length) throw badRequest(`This stage requires: ${missing.join(", ")}.`);
    const [after] = await tx`
      update opportunities set title = ${input.title}, value_cents = ${input.value === undefined ? before.value_cents : Math.round(input.value * 100)},
        currency = ${input.currency}, contact_id = ${input.contactId === undefined ? before.contact_id : input.contactId},
        company_id = ${input.companyId === undefined ? before.company_id : input.companyId},
        owner_id = ${input.ownerId === undefined ? before.owner_id : input.ownerId},
        custom = ${tx.json(customVals as never)}, version = version + 1, updated_at = now()
      where id = ${id} returning *`;
    const changed = TRACKED_OPP.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      const b = Object.fromEntries(changed.map((k) => [k, before[k]]));
      const a = Object.fromEntries(changed.map((k) => [k, after[k]]));
      await activity(tx, actor.workspaceId, actor.id, { contactId: after.contact_id, opportunityId: id, type: "opportunity.edited", summary: `${actor.name} edited ${changed.join(", ")}`, data: can(actor, "crm.view_value") ? { before: b, after: a } : {} });
      await audit(tx, actor.workspaceId, actor, { event: "opportunity.updated", targetType: "opportunity", targetId: id, before: b, after: a });
      if (after.contact_id) await recordLeadAction(tx, actor, after.contact_id, "field edit");
    }
    return maskOpp(actor, after);
  });
}

/** Board/list stage move with stage-required fields and optimistic concurrency (F2.4, F2.5, Q4). */
export async function moveOpportunity(actor: Actor, id: string, input: z.infer<typeof MoveInput>) {
  requirePerm(actor, "crm.edit");
  return sql.begin(async (tx) => {
    const o = await loadOpp(actor, id, tx, true);
    if (o.version !== input.version) throw conflict("Someone else changed this opportunity. Reload and try again.", { currentVersion: o.version });
    if (o.stage_id === input.stageId) return maskOpp(actor, o);
    const [target] = await tx`select id, name, kind from stages where id = ${input.stageId} and pipeline_id = ${o.pipeline_id}`;
    if (!target) throw badRequest("Target stage must be in the same pipeline.");
    const missing = await missingRequired(tx, target.id, o.custom);
    if (missing.length) {
      throw new AppError(422, "required_fields", `Cannot move to "${target.name}" until these fields are filled: ${missing.join(", ")}.`, { missing });
    }
    const [from] = await tx`select name from stages where id = ${o.stage_id}`;
    const [after] = await tx`update opportunities set stage_id = ${target.id}, version = version + 1, updated_at = now(),
      closed_at = ${target.kind === "open" ? null : new Date()} where id = ${id} returning *`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: o.contact_id, opportunityId: id, type: "opportunity.stage_changed", summary: `Stage: ${from.name} → ${target.name}` });
    await audit(tx, actor.workspaceId, actor, { event: "opportunity.stage_changed", targetType: "opportunity", targetId: id, before: { stage_id: o.stage_id, stage: from.name }, after: { stage_id: target.id, stage: target.name } });
    if (o.contact_id) await recordLeadAction(tx, actor, o.contact_id, "stage change");
    return maskOpp(actor, after);
  });
}

export async function deleteOpportunity(actor: Actor, id: string) {
  requirePerm(actor, "crm.delete");
  return sql.begin(async (tx) => {
    const o = await loadOpp(actor, id, tx, true);
    await tx`delete from opportunities where id = ${id}`;
    await audit(tx, actor.workspaceId, actor, { event: "opportunity.deleted", targetType: "opportunity", targetId: id, before: { title: o.title, stage_id: o.stage_id, value_cents: o.value_cents } });
  });
}

// ───────── Saved lists (F2.6) — filters are stored, results computed on read ─────────
export async function listSavedLists(actor: Actor) {
  requirePerm(actor, "crm.view");
  return sql`select id, name, entity, filters, created_at from saved_lists where workspace_id = ${actor.workspaceId} and user_id = ${actor.id} order by created_at desc`;
}
export async function createSavedList(actor: Actor, input: z.infer<typeof SavedListInput>) {
  requirePerm(actor, "crm.view");
  const [l] = await sql`insert into saved_lists (workspace_id, user_id, name, entity, filters) values (${actor.workspaceId}, ${actor.id}, ${input.name}, ${input.entity}, ${sql.json(input.filters as never)}) returning *`;
  return l;
}
export async function runSavedList(actor: Actor, id: string, page: z.infer<typeof ListQuery>) {
  const [l] = await sql`select * from saved_lists where id = ${id} and workspace_id = ${actor.workspaceId} and user_id = ${actor.id}`;
  if (!l) throw notFound("List not found.");
  const f = FilterSpec.parse(l.filters);
  const result = l.entity === "contact" ? await listContacts(actor, f, page) : await listOpportunities(actor, f, page);
  return { list: l, ...result };
}
export async function deleteSavedList(actor: Actor, id: string) {
  const r = await sql`delete from saved_lists where id = ${id} and workspace_id = ${actor.workspaceId} and user_id = ${actor.id} returning 1`;
  if (!r.length) throw notFound("List not found.");
}

// ───────── Export (F1.3 export, F1.4 masking) ─────────
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(actor: Actor, entity: "contact" | "opportunity", f: Filters) {
  requirePerm(actor, "crm.export");
  const all = { page: 1, pageSize: 100 };
  const rows: Record<string, unknown>[] = [];
  for (let p = 1; p <= 50; p++) {
    const r = entity === "contact" ? await listContacts(actor, f, { ...all, page: p }) : await listOpportunities(actor, f, { ...all, page: p });
    const items = (entity === "contact" ? (r as { contacts: Record<string, unknown>[] }).contacts : (r as { opportunities: Record<string, unknown>[] }).opportunities);
    rows.push(...items);
    if (items.length < all.pageSize) break;
  }
  const cols = entity === "contact"
    ? ["id", "name", "email", "phone", "company_name", "owner_name", "tags", "opted_out", "created_at", "custom"]
    : ["id", "title", "stage_name", "contact_name", "owner_name", "value", "currency", "created_at", "custom"];
  const lines = [cols.join(",")];
  for (const r of rows) {
    const row = { ...r, value: r.value_masked ? "hidden" : r.value_cents == null ? "" : Number(r.value_cents) / 100 };
    lines.push(cols.map((c) => csvCell((row as Record<string, unknown>)[c])).join(","));
  }
  await audit(sql, actor.workspaceId, actor, { event: `${entity}.exported`, targetType: entity, after: { rows: rows.length, filters: f } });
  return lines.join("\r\n");
}

// ───────── Activity for timeline APIs ─────────
export async function opportunityBoard(actor: Actor, pipelineId: string) {
  requirePerm(actor, "crm.view");
  await sameWorkspace(sql, actor, "pipelines", pipelineId);
  const r = await listOpportunities(actor, { pipelineId }, { page: 1, pageSize: 100 });
  const stages = await sql`select id, name, position, kind from stages where pipeline_id = ${pipelineId} order by position`;
  return { stages, opportunities: r.opportunities, total: r.total };
}
