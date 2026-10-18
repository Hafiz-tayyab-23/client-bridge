import "server-only";
import { sql, type Tx } from "../db";
import { getConnection, markHealth, recordEvent, secretsOf } from "../integrations/store";
import { sendTelegram } from "../integrations/telegram";
import type { Actor } from "../permissions";

const MAX_ATTEMPTS = 3;

/** In-app notification always; plus an external Telegram alert (outbox) when `external` (F3.9, I4). */
export async function notifyUser(
  tx: Tx,
  n: { workspaceId: string; userId: string; leadId?: string; kind: string; title: string; body: string; link?: string; external?: boolean },
) {
  await tx`insert into notifications (workspace_id, user_id, lead_id, channel, kind, title, body, link, status, sent_at)
           values (${n.workspaceId}, ${n.userId}, ${n.leadId ?? null}, 'in_app', ${n.kind}, ${n.title}, ${n.body}, ${n.link ?? null}, 'sent', now())`;
  if (!n.external) return;
  const [u] = await tx`select telegram_chat_id from users where id = ${n.userId}`;
  const conn = await getConnection(tx, n.workspaceId, "telegram");
  const skipReason = !conn || conn.status === "not_connected" ? "Telegram is not connected for this workspace"
    : !u?.telegram_chat_id ? "This employee has not set a Telegram chat ID" : null;
  await tx`insert into notifications (workspace_id, user_id, lead_id, channel, kind, title, body, link, status, last_error)
           values (${n.workspaceId}, ${n.userId}, ${n.leadId ?? null}, 'telegram', ${n.kind}, ${n.title}, ${n.body}, ${n.link ?? null},
                   ${skipReason ? "skipped" : "pending"}, ${skipReason})`;
}

/** Delivers pending external alerts; temporary failures retry with backoff, permanent ones fail visibly (I4.4, I5.5). */
export async function processOutbox(limit = 20) {
  let sent = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const done = await sql.begin(async (tx) => {
      const [n] = await tx`
        select n.*, u.telegram_chat_id from notifications n join users u on u.id = n.user_id
        where n.status = 'pending' and n.channel = 'telegram' and n.next_attempt_at <= now()
        order by n.created_at limit 1 for update of n skip locked`;
      if (!n) return null;
      const conn = await getConnection(tx, n.workspace_id, "telegram");
      const token = secretsOf<{ botToken: string }>(conn)?.botToken;
      if (!conn || !token || !n.telegram_chat_id) {
        await tx`update notifications set status = 'failed', last_error = 'Telegram not configured' where id = ${n.id}`;
        return "failed";
      }
      const base = process.env.APP_URL ?? "";
      const text = `${n.title}\n${n.body}${n.link ? `\nOpen: ${base}${n.link}` : ""}`;
      const r = await sendTelegram(token, n.telegram_chat_id, text);
      const attempts = n.attempts + 1;
      await recordEvent(tx, {
        workspaceId: n.workspace_id, provider: "telegram", direction: "outbound", kind: "alert.send",
        status: r.ok ? "ok" : r.permanent || attempts >= MAX_ATTEMPTS ? "error" : "retrying",
        reference: r.reference ?? n.id, summary: n.title, error: r.error,
      });
      if (r.ok) {
        await tx`update notifications set status = 'sent', sent_at = now(), attempts = ${attempts}, last_error = null where id = ${n.id}`;
        await markHealth(tx, conn.id, true);
        return "sent";
      }
      if (r.permanent || attempts >= MAX_ATTEMPTS) {
        await tx`update notifications set status = 'failed', attempts = ${attempts}, last_error = ${r.error ?? "failed"} where id = ${n.id}`;
      } else {
        await tx`update notifications set attempts = ${attempts}, last_error = ${r.error ?? "failed"},
                 next_attempt_at = now() + make_interval(secs => ${5 * 2 ** attempts}) where id = ${n.id}`;
      }
      await markHealth(tx, conn.id, false, r.error);
      return "failed";
    });
    if (done === null) break;
    if (done === "sent") sent++; else failed++;
  }
  return { sent, failed };
}

export async function listMyNotifications(actor: Actor, since?: string) {
  return sql`
    select id, kind, title, body, link, read_at, created_at from notifications
    where user_id = ${actor.id} and workspace_id = ${actor.workspaceId} and channel = 'in_app'
      ${since ? sql`and created_at > ${since}` : sql``}
    order by created_at desc limit 30`;
}

export async function markRead(actor: Actor) {
  await sql`update notifications set read_at = now() where user_id = ${actor.id} and channel = 'in_app' and read_at is null`;
}
