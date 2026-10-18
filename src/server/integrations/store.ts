import "server-only";
import { sql, type Db } from "../db";
import { decryptJson, encryptJson } from "../crypto";

export type Provider = "twilio" | "stripe" | "google" | "telegram" | "safepay";

export interface Connection {
  id: string;
  workspace_id: string;
  provider: Provider;
  user_id: string | null;
  status: "not_connected" | "connected" | "error" | "needs_reconnect";
  config: Record<string, unknown>;
  secrets_enc: string | null;
  last_success_at: Date | null;
  last_error: string | null;
}

/** Per-workspace (and optionally per-user) connection; secrets stay server-side (I5.2, I5.3). */
export async function getConnection(db: Db, workspaceId: string, provider: Provider, userId: string | null = null) {
  const [c] = await db<Connection[]>`
    select * from integration_connections where workspace_id = ${workspaceId} and provider = ${provider}
      and user_id is not distinct from ${userId}`;
  return c ?? null;
}

export async function getConnectionById(id: string) {
  const [c] = await sql<Connection[]>`select * from integration_connections where id = ${id}`;
  return c ?? null;
}

export function secretsOf<T = Record<string, string>>(c: Connection | null): T | null {
  return c?.secrets_enc ? decryptJson<T>(c.secrets_enc) : null;
}

export async function upsertConnection(
  db: Db,
  workspaceId: string,
  provider: Provider,
  userId: string | null,
  data: { status: Connection["status"]; config?: Record<string, unknown>; secrets?: Record<string, unknown> | null },
) {
  const enc = data.secrets === undefined ? undefined : data.secrets === null ? null : encryptJson(data.secrets);
  const existing = await getConnection(db, workspaceId, provider, userId);
  if (existing) {
    const [c] = await db<Connection[]>`
      update integration_connections set status = ${data.status},
        config = ${db.json((data.config ?? existing.config) as never)},
        secrets_enc = ${enc === undefined ? existing.secrets_enc : enc},
        last_error = case when ${data.status} = 'connected' then null else last_error end,
        updated_at = now()
      where id = ${existing.id} returning *`;
    return c;
  }
  const [c] = await db<Connection[]>`
    insert into integration_connections (workspace_id, provider, user_id, status, config, secrets_enc)
    values (${workspaceId}, ${provider}, ${userId}, ${data.status}, ${db.json((data.config ?? {}) as never)}, ${enc ?? null})
    returning *`;
  return c;
}

/** Synchronisation history (I5.4): every inbound event and outbound call. */
export async function recordEvent(
  db: Db,
  e: { workspaceId: string | null; provider: Provider; direction: "inbound" | "outbound"; kind: string; status: "ok" | "error" | "rejected" | "duplicate" | "retrying"; reference?: string | null; summary?: string; error?: string | null },
) {
  await db`
    insert into integration_events (workspace_id, provider, direction, kind, status, reference, summary, error)
    values (${e.workspaceId}, ${e.provider}, ${e.direction}, ${e.kind}, ${e.status}, ${e.reference ?? null}, ${e.summary ?? null}, ${e.error ?? null})`;
}

export async function markHealth(db: Db, connectionId: string, ok: boolean, error?: string, status?: Connection["status"]) {
  if (ok) {
    await db`update integration_connections set last_success_at = now(), status = case when status = 'error' then 'connected' else status end where id = ${connectionId}`;
  } else {
    await db`update integration_connections set last_error = ${error ?? "Unknown error"}, last_error_at = now(),
      status = ${status ?? "error"} where id = ${connectionId}`;
  }
}

/** Idempotency guard for webhooks: returns false if this provider event was already processed. */
export async function firstReceipt(db: Db, provider: Provider, eventId: string): Promise<boolean> {
  const rows = await db`insert into webhook_receipts (provider, event_id) values (${provider}, ${eventId}) on conflict do nothing returning 1`;
  return rows.length === 1;
}
