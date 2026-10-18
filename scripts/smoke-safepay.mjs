// Safepay webhook rejection paths with locally signed events (HMAC-SHA512 over the JSON payload).
// The "paid" path requires Safepay's reporter API to confirm the tracker, so it can only be proven
// against the real sandbox; here the fake secret key makes confirmation fail and nothing is recorded.
// Usage: node scripts/smoke-safepay.mjs   (reads .env)
import dotenv from "dotenv";
import postgres from "postgres";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";

dotenv.config({ path: ".env", quiet: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (n, c, i) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, i === undefined ? "" : JSON.stringify(i).slice(0, 300)); } };
const enc = (v) => { const k = Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64"), iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv); const e = Buffer.concat([c.update(JSON.stringify(v)), c.final()]); return [iv, c.getAuthTag(), e].map((b) => b.toString("base64url")).join("."); };

const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ workspaceName: `SP ${run}`, name: "Saad", email: `saad-${run}@demo.test`, password: "password123" }) });
const { workspaceId, userId } = await res.json();
const secret = "whsk_" + randomBytes(20).toString("hex");
const [conn] = await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${workspaceId}, 'safepay', 'connected', ${enc({ apiKey: "sec_test_fake", secretKey: "fake-secret-key-for-tests", webhookSecret: secret })}) returning id`;
const tracker = `track_${run}`;
const [pay] = await sql`insert into payments (workspace_id, requested_by, amount_cents, currency, status, provider, provider_session) values (${workspaceId}, ${userId}, 500000, 'pkr', 'pending', 'safepay', ${tracker}) returning id`;
const send = (ev, { key = secret, mode = "payload" } = {}) => {
  const body = JSON.stringify(ev);
  const sig = createHmac("sha512", key).update(mode === "payload" ? body : JSON.stringify(ev.data)).digest("hex");
  return fetch(`${BASE}/api/webhooks/safepay/${conn.id}`, { method: "POST", headers: { "content-type": "application/json", "x-sfpy-signature": sig }, body }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
};
const ev = (token, type, extra = {}) => ({ token, type, version: "2.0.0", data: { tracker, state: "TRACKER_ENDED", amount: 500000, currency: "PKR", metadata: { order_id: pay.id }, ...extra } });
const st = async () => (await sql`select status from payments where id = ${pay.id}`)[0].status;

let r = await send(ev(`evt_a_${run}`, "payment.succeeded"), { key: "wrong-secret-wrong-secret" });
check("forged signature rejected (400), nothing recorded", r.status === 400 && (await st()) === "pending", r);
r = await send(ev(`evt_b_${run}`, "payment.succeeded"), { mode: "data" });
check("undocumented data-only signature rejected (400)", r.status === 400 && (await st()) === "pending", r);
r = await send(ev(`evt_c_${run}`, "payment.succeeded", { amount: 1 }));
check("valid signature but wrong amount → not recorded", r.status === 200 && r.data.recorded === false && (await st()) === "pending", r);
r = await send(ev(`evt_d_${run}`, "payment.succeeded", { currency: "USD" }));
check("valid signature but wrong currency → not recorded", r.data.recorded === false && (await st()) === "pending", r);
r = await send(ev(`evt_e_${run}`, "payment.succeeded", { metadata: { order_id: "00000000-0000-0000-0000-000000000000" } }));
check("wrong payment reference → not recorded", r.data.recorded === false && (await st()) === "pending", r);
r = await send(ev(`evt_f_${run}`, "payment.succeeded"));
check("valid event but Safepay cannot confirm tracker (fake key) → not recorded", (r.data.recorded === false || r.status === 503) && (await st()) === "pending", r);
r = await send({ token: `evt_g_${run}`, type: "payment.succeeded", data: { tracker: "track_unknown", amount: 1, currency: "PKR" } });
check("unknown tracker ignored", r.data.matched === false, r);
const ev2 = await sql`select status, coalesce(error, summary) d from integration_events where workspace_id = ${workspaceId} and provider = 'safepay' order by id`;
check("every attempt recorded with reason", ev2.length >= 7 && ev2.filter((e) => e.status === "rejected").length === 2, ev2.map((e) => e.status));

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
