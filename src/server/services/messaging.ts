import "server-only";
import { z } from "zod";
import { sql, type Tx } from "../db";
import { randomToken, safeEqual } from "../crypto";
import { AppError, conflict, forbidden, notFound } from "../http";
import { activity, audit } from "../audit";
import { can, type Actor } from "../permissions";
import { firstReceipt, getConnection, getConnectionById, markHealth, recordEvent, secretsOf } from "../integrations/store";
import { sendTelegram } from "../integrations/telegram";
import { captureLead, recordLeadAction } from "./leads";
import { connectTelegram, TelegramConnectInput } from "./integrations";

type TgSecrets = { botToken: string; webhookSecret: string };

// ───────── Connect: store token, register webhook with a per-workspace secret token (I1.2) ─────────
export async function connectTelegramBot(actor: Actor, input: z.infer<typeof TelegramConnectInput>) {
  const secret = randomToken(24).replace(/[^A-Za-z0-9_-]/g, "");
  return connectTelegram(actor, input, secret, async (connectionId) => {
    const base = process.env.APP_URL ?? "";
    if (!base.startsWith("https://")) return "APP_URL is not public HTTPS, so Telegram cannot deliver messages to this server.";
    const res = await fetch(`https://api.telegram.org/bot${input.botToken}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ url: `${base}/api/webhooks/telegram/${connectionId}`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, description: (e as Error).message })) as { ok: boolean; description?: string };
    await recordEvent(sql, { workspaceId: actor.workspaceId, provider: "telegram", direction: "outbound", kind: "setWebhook", status: res.ok ? "ok" : "error", error: res.ok ? null : res.description });
    return res.ok ? "Webhook registered with Telegram." : `Telegram rejected the webhook: ${res.description}`;
  });
}

// ───────── Inbound webhook ─────────
interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean }; text?: string; contact?: { phone_number: string } };
}

export async function handleTelegramWebhook(connectionId: string, header: string | null, body: string) {
  const conn = await getConnectionById(connectionId);
  if (!conn || conn.provider !== "telegram") throw notFound();
  const secrets = secretsOf<TgSecrets>(conn);
  if (!secrets || !header || !safeEqual(header, secrets.webhookSecret)) {
    await recordEvent(sql, { workspaceId: conn.workspace_id, provider: "telegram", direction: "inbound", kind: "webhook", status: "rejected", error: header ? "Secret token mismatch" : "Missing X-Telegram-Bot-Api-Secret-Token" });
    throw new AppError(401, "invalid_signature", "Invalid webhook secret token.");
  }
  let update: TgUpdate;
  try { update = JSON.parse(body); } catch { throw new AppError(400, "bad_request", "Malformed update."); }
  const msg = update.message;
  const ws = conn.workspace_id;
  const replies: string[] = [];
  const result = await sql.begin(async (tx) => {
    if (!(await firstReceipt(tx, "telegram", `${connectionId}:${update.update_id}`))) {
      await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "inbound", kind: "message", status: "duplicate", reference: String(update.update_id), summary: "Duplicate delivery ignored" });
      return { duplicate: true };
    }
    if (!msg || msg.chat.type !== "private" || msg.from?.is_bot) {
      await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "inbound", kind: "update", status: "ok", reference: String(update.update_id), summary: "Ignored (not a private message)" });
      return { ignored: true };
    }
    const chatId = String(msg.chat.id);
    const text = (msg.text ?? (msg.contact ? `Shared phone: ${msg.contact.phone_number}` : "")).slice(0, 4000);
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || `Telegram ${chatId}`;
    // Employees use /start to learn their chat ID for escalation alerts (I4.3).
    const [employee] = await tx`select id from users where workspace_id = ${ws} and telegram_chat_id = ${chatId}`;
    if (text.startsWith("/start")) {
      replies.push(`Hello ${name}! Your Telegram chat ID is ${chatId}. Employees: enter it on the Team page to receive escalation alerts. Customers: just send your question here.`);
      await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "inbound", kind: "command.start", status: "ok", reference: String(update.update_id) });
      return { start: true };
    }
    if (employee) {
      await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "inbound", kind: "message", status: "ok", reference: String(update.update_id), summary: "From an employee chat; not a customer conversation" });
      return { employee: true };
    }
    // Contact matching by Telegram identity, then by shared phone (I1.5).
    const phone = msg.contact?.phone_number ? (msg.contact.phone_number.startsWith("+") ? msg.contact.phone_number : `+${msg.contact.phone_number}`) : null;
    let [contact] = await tx`select * from contacts where workspace_id = ${ws} and telegram_chat_id = ${chatId}`;
    if (!contact && phone) {
      [contact] = await tx`update contacts set telegram_chat_id = ${chatId} where workspace_id = ${ws} and phone = ${phone} and telegram_chat_id is null returning *`;
    }
    let leadId: string | null = null;
    if (!contact) {
      const r = await captureLead(ws, "message", { name, phone: phone ?? undefined, message: text, sourceDetail: `Telegram @${msg.from?.username ?? chatId}`, title: `${name} (Telegram)` }, null, tx);
      [contact] = await tx`update contacts set telegram_chat_id = ${chatId} where id = ${r.contactId} returning *`;
      leadId = r.leadId;
    } else if (phone && !contact.phone) {
      await tx`update contacts set phone = ${phone} where id = ${contact.id} and not exists (select 1 from contacts c2 where c2.workspace_id = ${ws} and c2.phone = ${phone})`;
    }
    if (text.trim().toLowerCase() === "/stop") {
      await tx`update contacts set opted_out = true, opted_out_at = now() where id = ${contact.id}`;
      await activity(tx, ws, null, { contactId: contact.id, type: "contact.opted_out", summary: "Customer sent /stop on Telegram; messaging disabled" });
      await audit(tx, ws, null, { event: "contact.opted_out", targetType: "contact", targetId: contact.id, after: { via: "telegram /stop" } });
      replies.push("You have been unsubscribed and will not receive further messages. Send /start to talk to us again.");
    } else if (text.startsWith("/start") === false && contact.opted_out && text.trim().toLowerCase() === "/resume") {
      await tx`update contacts set opted_out = false, opted_out_at = null where id = ${contact.id}`;
    }
    const [conv] = await tx`
      insert into conversations (workspace_id, contact_id, channel, assignee_id, last_message_at, last_inbound_at)
      values (${ws}, ${contact.id}, 'telegram', ${contact.owner_id}, now(), now())
      on conflict (workspace_id, contact_id, channel) do update set last_message_at = now(), last_inbound_at = now(), read_at = null,
        assignee_id = coalesce(conversations.assignee_id, excluded.assignee_id)
      returning id`;
    await tx`insert into messages (workspace_id, conversation_id, direction, body, provider_sid, status)
             values (${ws}, ${conv.id}, 'inbound', ${text || "(non-text message)"}, ${`tg:${chatId}:${msg.message_id}`}, 'received')
             on conflict (provider_sid) where provider_sid is not null do nothing`;
    await activity(tx, ws, null, { contactId: contact.id, leadId, type: "message.received", summary: `Telegram message: ${text.slice(0, 140)}` });
    await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "inbound", kind: "message", status: "ok", reference: `${chatId}:${msg.message_id}`, summary: leadId ? "New contact and lead created" : "Attached to existing contact" });
    if (contact.owner_id) {
      await tx`insert into notifications (workspace_id, user_id, channel, kind, title, body, link, status, sent_at)
               values (${ws}, ${contact.owner_id}, 'in_app', 'message.received', ${`New message from ${contact.name}`}, ${text.slice(0, 140)}, ${`/conversations?id=${conv.id}`}, 'sent', now())`;
    }
    await markHealth(tx, conn.id, true);
    return { conversationId: conv.id, leadId };
  });
  for (const r of replies) {
    const s = await sendTelegram(secrets.botToken, String(msg!.chat.id), r);
    await recordEvent(sql, { workspaceId: ws, provider: "telegram", direction: "outbound", kind: "auto_reply", status: s.ok ? "ok" : "error", error: s.error });
  }
  return result;
}

// ───────── Conversations ─────────
const mineOnly = (actor: Actor) => (can(actor, "crm.view") && can(actor, "crm.view_all") ? null : actor.id);

export async function listConversations(actor: Actor, q: { filter?: string; q?: string; contactId?: string }) {
  const mine = mineOnly(actor);
  return sql`
    select cv.id, cv.channel, cv.contact_id, c.name as contact_name, c.opted_out, c.telegram_chat_id is not null as known_telegram,
           cv.assignee_id, u.name as assignee_name, cv.last_message_at, cv.last_inbound_at, cv.read_at,
           (cv.last_inbound_at is not null and (cv.read_at is null or cv.read_at < cv.last_inbound_at)) as unread,
           lm.body as last_body, lm.direction as last_direction,
           exists (select 1 from messages m where m.conversation_id = cv.id and m.status = 'failed') as has_failed
    from conversations cv join contacts c on c.id = cv.contact_id left join users u on u.id = cv.assignee_id
    left join lateral (select body, direction from messages m where m.conversation_id = cv.id order by created_at desc limit 1) lm on true
    where cv.workspace_id = ${actor.workspaceId} ${mine ? sql`and (cv.assignee_id = ${mine} or c.owner_id = ${mine})` : sql``}
      ${q.contactId ? sql`and cv.contact_id = ${q.contactId}` : sql``}
      ${q.q ? sql`and c.name ilike ${"%" + q.q + "%"}` : sql``}
      ${q.filter === "failed" ? sql`and exists (select 1 from messages m where m.conversation_id = cv.id and m.status = 'failed')` : sql``}
      ${q.filter === "unassigned" ? sql`and cv.assignee_id is null` : sql``}
      ${q.filter === "optout" ? sql`and c.opted_out` : sql``}
      ${q.filter === "unread" ? sql`and cv.last_inbound_at is not null and (cv.read_at is null or cv.read_at < cv.last_inbound_at)` : sql``}
    order by cv.last_message_at desc limit 100`;
}

async function loadConversation(actor: Actor, id: string, db: Tx | typeof sql = sql) {
  const mine = mineOnly(actor);
  const [cv] = await db`
    select cv.*, c.name as contact_name, c.opted_out, c.opted_out_at, c.telegram_chat_id, c.owner_id as contact_owner, u.name as assignee_name
    from conversations cv join contacts c on c.id = cv.contact_id left join users u on u.id = cv.assignee_id
    where cv.id = ${id} and cv.workspace_id = ${actor.workspaceId} ${mine ? db`and (cv.assignee_id = ${mine} or c.owner_id = ${mine})` : db``}`;
  if (!cv) throw notFound("Conversation not found.");
  return cv;
}

export async function getThread(actor: Actor, id: string) {
  const cv = await loadConversation(actor, id);
  const messages = await sql`
    select m.id, m.direction, m.body, m.status, m.error_code, m.error_message, m.provider_sid, m.attempts, m.created_at, u.name as sender_name
    from messages m left join users u on u.id = m.sender_id where m.conversation_id = ${id} order by m.created_at limit 500`;
  await sql`update conversations set read_at = now() where id = ${id}`;
  return { conversation: cv, messages };
}

export const SendInput = z.object({ text: z.string().trim().min(1, "Type a message.").max(4000) });

async function deliver(ws: string, messageId: string) {
  const [m] = await sql`select m.*, c.telegram_chat_id, c.opted_out, c.id as contact_id from messages m join conversations cv on cv.id = m.conversation_id join contacts c on c.id = cv.contact_id where m.id = ${messageId}`;
  const conn = await getConnection(sql, ws, "telegram");
  const token = secretsOf<TgSecrets>(conn)?.botToken;
  let r: { ok: boolean; permanent?: boolean; error?: string; reference?: string };
  if (!conn || !token) r = { ok: false, permanent: true, error: "Telegram is not connected for this workspace. An admin can connect it on the Integrations page." };
  else if (!m.telegram_chat_id) r = { ok: false, permanent: true, error: "This contact has no Telegram chat. Telegram bots can only message people who have messaged the bot first." };
  else {
    r = await sendTelegram(token, m.telegram_chat_id, m.body);
    if (!r.ok && !r.permanent) { await new Promise((res) => setTimeout(res, 1500)); r = await sendTelegram(token, m.telegram_chat_id, m.body); }
  }
  await sql.begin(async (tx) => {
    await tx`update messages set status = ${r.ok ? "sent" : "failed"}, provider_sid = coalesce(${r.ok && r.reference ? `tg-out:${m.telegram_chat_id}:${r.reference}` : null}, provider_sid),
             error_message = ${r.ok ? null : r.error ?? "Send failed"}, attempts = attempts + 1, updated_at = now() where id = ${messageId}`;
    if (!r.ok && /blocked/i.test(r.error ?? "")) {
      await tx`update contacts set opted_out = true, opted_out_at = now() where id = ${m.contact_id}`;
      await activity(tx, ws, null, { contactId: m.contact_id, type: "contact.opted_out", summary: "Customer blocked the Telegram bot; messaging disabled" });
    }
    await recordEvent(tx, { workspaceId: ws, provider: "telegram", direction: "outbound", kind: "message.send", status: r.ok ? "ok" : "error", reference: r.reference ?? messageId, error: r.error });
    if (conn) await markHealth(tx, conn.id, r.ok, r.error);
  });
  return r;
}

/** I1.3 send; opted-out contacts are refused with a reason (I1.9); failures stay visible with retry (I1.7). */
export async function sendMessage(actor: Actor, conversationId: string, input: z.infer<typeof SendInput>) {
  const cv = await loadConversation(actor, conversationId);
  if (!can(actor, "crm.edit") && cv.assignee_id !== actor.id) throw forbidden("Only the assigned employee or an editor can reply.");
  if (cv.opted_out) throw conflict(`${cv.contact_name} opted out of messages${cv.opted_out_at ? ` on ${new Date(cv.opted_out_at).toLocaleDateString()}` : ""}. Sending is blocked.`);
  const [m] = await sql.begin(async (tx) => {
    const rows = await tx`insert into messages (workspace_id, conversation_id, direction, body, status, sender_id) values (${actor.workspaceId}, ${conversationId}, 'outbound', ${input.text}, 'sending', ${actor.id}) returning id`;
    await tx`update conversations set last_message_at = now(), assignee_id = coalesce(assignee_id, ${actor.id}) where id = ${conversationId}`;
    await activity(tx, actor.workspaceId, actor.id, { contactId: cv.contact_id, type: "message.sent", summary: `Telegram reply: ${input.text.slice(0, 140)}` });
    await recordLeadAction(tx, actor, cv.contact_id, "message");
    return rows;
  });
  const r = await deliver(actor.workspaceId, m.id);
  return { id: m.id, status: r.ok ? "sent" : "failed", error: r.error ?? null };
}

export async function retryMessage(actor: Actor, messageId: string) {
  const [m] = await sql`select m.id, m.conversation_id, m.status from messages m where m.id = ${messageId} and m.workspace_id = ${actor.workspaceId}`;
  if (!m) throw notFound("Message not found.");
  const cv = await loadConversation(actor, m.conversation_id);
  if (m.status !== "failed") throw conflict("Only failed messages can be retried.");
  if (cv.opted_out) throw conflict(`${cv.contact_name} opted out of messages. Sending is blocked.`);
  const r = await deliver(actor.workspaceId, m.id);
  return { id: m.id, status: r.ok ? "sent" : "failed", error: r.error ?? null };
}

/** Start a conversation from the CRM for a contact who has a Telegram chat. */
export async function openConversation(actor: Actor, contactId: string) {
  const mine = mineOnly(actor);
  const [c] = await sql`select id, owner_id, telegram_chat_id from contacts where id = ${contactId} and workspace_id = ${actor.workspaceId} ${mine ? sql`and owner_id = ${mine}` : sql``}`;
  if (!c) throw notFound("Contact not found.");
  const [cv] = await sql`insert into conversations (workspace_id, contact_id, channel, assignee_id) values (${actor.workspaceId}, ${contactId}, 'telegram', ${c.owner_id ?? actor.id})
    on conflict (workspace_id, contact_id, channel) do update set channel = excluded.channel returning id`;
  return { id: cv.id, canMessage: Boolean(c.telegram_chat_id) };
}
