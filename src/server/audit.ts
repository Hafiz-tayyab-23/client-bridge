import "server-only";
import type { Db } from "./db";
import type { Actor } from "./permissions";

export interface AuditEntry {
  event: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit record (F4.1). `actor = null` means the system did it. */
export async function audit(db: Db, workspaceId: string, actor: Pick<Actor, "id" | "name" | "email"> | null, e: AuditEntry) {
  await db`
    insert into audit_log (workspace_id, actor_id, actor_label, event, target_type, target_id, before, after)
    values (${workspaceId}, ${actor?.id ?? null}, ${actor ? `${actor.name} <${actor.email}>` : "system"},
            ${e.event}, ${e.targetType}, ${e.targetId ?? null},
            ${e.before === undefined ? null : db.json(e.before as never)},
            ${e.after === undefined ? null : db.json(e.after as never)})`;
}

/** Activity timeline entry on a contact / opportunity / lead (F2.7). */
export async function activity(
  db: Db,
  workspaceId: string,
  actorId: string | null,
  a: { contactId?: string | null; opportunityId?: string | null; leadId?: string | null; type: string; summary: string; data?: unknown },
) {
  await db`
    insert into activities (workspace_id, contact_id, opportunity_id, lead_id, actor_id, type, summary, data)
    values (${workspaceId}, ${a.contactId ?? null}, ${a.opportunityId ?? null}, ${a.leadId ?? null}, ${actorId},
            ${a.type}, ${a.summary}, ${db.json((a.data ?? {}) as never)})`;
}
