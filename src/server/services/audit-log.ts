import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { requirePerm, type Actor } from "../permissions";

// Read-only by design (F4.3): no service or route edits or deletes audit entries.
export const AuditQuery = z.object({
  event: z.string().trim().max(60).optional(),
  actorId: z.string().uuid().optional(),
  system: z.enum(["1"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  targetId: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listAudit(actor: Actor, q: z.infer<typeof AuditQuery>) {
  requirePerm(actor, "audit.view");
  const where = sql`
    workspace_id = ${actor.workspaceId}
    ${q.event ? sql`and event like ${q.event.replace(/[%_]/g, "") + "%"}` : sql``}
    ${q.actorId ? sql`and actor_id = ${q.actorId}` : sql``}
    ${q.system ? sql`and actor_id is null` : sql``}
    ${q.from ? sql`and created_at >= ${q.from}::date` : sql``}
    ${q.to ? sql`and created_at < ${q.to}::date + 1` : sql``}
    ${q.targetId ? sql`and target_id = ${q.targetId}` : sql``}`;
  const [{ total }] = await sql`select count(*)::int as total from audit_log where ${where}`;
  const entries = await sql`
    select id, actor_id, actor_label, event, target_type, target_id, before, after, created_at
    from audit_log where ${where} order by id desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`;
  const events = await sql`select distinct event from audit_log where workspace_id = ${actor.workspaceId} order by event`;
  return { total, page: q.page, pageSize: q.pageSize, entries, eventTypes: events.map((e) => e.event) };
}
