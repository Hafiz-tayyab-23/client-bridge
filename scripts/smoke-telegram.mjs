// Telegram (I1) webhook + messaging checks against a running server, with a deliberately invalid bot token
// (so outbound sends fail visibly). Usage: node scripts/smoke-telegram.mjs   (reads .env)
import dotenv from "dotenv";
import postgres from "postgres";
import { createCipheriv, randomBytes } from "node:crypto";

dotenv.config({ path: ".env", quiet: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (n, c, i) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, i === undefined ? "" : JSON.stringify(i).slice(0, 300)); } };
const enc = (v) => { const k = Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64"), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv); const e = Buffer.concat([c.update(JSON.stringify(v)), c.final()]); return [iv, c.getAuthTag(), e].map((b) => b.toString("base64url")).join("."); };

const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ workspaceName: `TG ${run}`, name: "Tina", email: `tina-${run}@demo.test`, password: "password123" }) });
const { workspaceId } = await res.json();
const cookie = res.headers.get("set-cookie").match(/sid=[^;]+/)[0];
const secret = "s" + randomBytes(12).toString("hex");
const [conn] = await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${workspaceId}, 'telegram', 'connected', ${enc({ botToken: "123456:invalid-token-for-tests-xxxxxxxxxxxxxxxxxx", webhookSecret: secret })}) returning id`;
const hook = (update, s = secret) => fetch(`${BASE}/api/webhooks/telegram/${conn.id}`, { method: "POST", headers: { "content-type": "application/json", ...(s ? { "x-telegram-bot-api-secret-token": s } : {}) }, body: JSON.stringify(update) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const api = (p, body) => fetch(BASE + p, { method: body ? "POST" : "GET", headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const chat = 700000000 + Math.floor(Math.random() * 1e6);
const msg = (id, text) => ({ update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, from: { first_name: "Ali", last_name: "Raza", username: "aliraza" }, text } });

let r = await hook(msg(1, "Hello"), "wrong");
check("wrong secret token rejected (401)", r.status === 401, r);
r = await hook(msg(1, "Hello"), null);
check("missing secret token rejected (401)", r.status === 401, r);
const [rej] = await sql`select count(*)::int n from integration_events where workspace_id = ${workspaceId} and status = 'rejected'`;
check("rejections recorded", rej.n === 2, rej);

r = await hook(msg(10, "Hi, I need a solar quote"));
check("unknown sender → contact + lead", r.status === 200 && r.data.leadId, r);
const [lead] = await sql`select source, owner_id from leads where id = ${r.data.leadId}`;
check("lead labelled source=message and owned", lead.source === "message" && lead.owner_id, lead);
r = await hook(msg(10, "Hi, I need a solar quote"));
check("duplicate update ignored", r.data.duplicate === true, r);
r = await hook(msg(11, "Any update?"));
check("known sender attaches to same contact (no new lead)", r.status === 200 && !r.data.leadId, r);
const [{ n: msgs }] = await sql`select count(*)::int n from messages m join conversations c on c.id = m.conversation_id where c.workspace_id = ${workspaceId}`;
check("two inbound messages stored once each", msgs === 2, msgs);

const list = await api("/api/conversations");
const conv = list.data.conversations?.[0];
check("conversation listed with assignee", conv && conv.assignee_name, list.data);
r = await api(`/api/conversations/${conv.id}/messages`, { text: "Thanks Ali, sending details now" });
check("send with bad token → stored as failed with reason", r.status === 201 && r.data.status === "failed" && r.data.error, r);
r = await api(`/api/messages/${r.data.id}/retry`, {});
check("retry available and still reports failure", r.status === 200 && r.data.status === "failed", r);

r = await hook(msg(12, "/stop"));
const [c] = await sql`select opted_out from contacts where workspace_id = ${workspaceId} and telegram_chat_id = ${String(chat)}`;
check("/stop opts the contact out", c.opted_out === true, c);
r = await api(`/api/conversations/${conv.id}/messages`, { text: "One more thing" });
check("sending to opted-out contact refused with reason (409)", r.status === 409 && /opted out/i.test(r.data.error?.message), r);
const th = await api(`/api/conversations/${conv.id}`);
check("thread shows failed message with error", th.data.messages.some((m) => m.status === "failed" && m.error_message), th.data.messages?.map((m) => m.status));
const tl = await sql`select type from activities where workspace_id = ${workspaceId} order by id`;
check("activity history has message + opt-out entries", ["message.received", "message.sent", "contact.opted_out"].every((t) => tl.some((x) => x.type === t)), tl.map((x) => x.type));

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
