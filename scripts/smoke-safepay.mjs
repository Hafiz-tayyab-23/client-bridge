// Safepay webhook-logic checks with locally signed events (HMAC-SHA512). Does NOT call Safepay.
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
const [conn] = await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${workspaceId}, 'safepay', 'connected', ${enc({ apiKey: "sec_test", secretKey: "x".repeat(20), webhookSecret: secret })}) returning id`;
const tracker = `track_${run}`;
const [pay] = await sql`insert into payments (workspace_id, requested_by, amount_cents, currency, status, provider, provider_session) values (${workspaceId}, ${userId}, 500000, 'pkr', 'pending', 'safepay', ${tracker}) returning id`;
const send = (ev, { key = secret, mode = "data" } = {}) => {
  const body = JSON.stringify(ev);
  const signed = mode === "data" ? JSON.stringify(ev.data) : body;
  const sig = createHmac("sha512", key).update(signed).digest("hex");
  return fetch(`${BASE}/api/webhooks/safepay/${conn.id}`, { method: "POST", headers: { "content-type": "application/json", "x-sfpy-signature": sig }, body }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
};
const ev = (token, type, extra = {}) => ({ token, type, version: "2.0.0", data: { tracker, state: "TRACKER_ENDED", amount: 500000, currency: "PKR", ...extra } });
const st = async () => (await sql`select status, refunded_cents from payments where id = ${pay.id}`)[0];

let r = await send(ev(`evt_a_${run}`, "payment.succeeded"), { key: "wrong-secret-wrong-secret" });
check("forged signature rejected (400)", r.status === 400 && (await st()).status === "pending", r);
r = await send(ev(`evt_a_${run}`, "payment.succeeded"));
check("verified payment.succeeded (data-object signature) → paid", r.status === 200 && (await st()).status === "paid", r);
r = await send(ev(`evt_a_${run}`, "payment.succeeded"));
check("duplicate event token ignored", r.data.duplicate === true, r);
r = await send(ev(`evt_b_${run}`, "payment.refunded", { state: "TRACKER_PARTIAL_REFUND", amount: 200000 }), { mode: "payload" });
const s1 = await st();
check("payload-signature variant accepted; partial refund reflected", r.status === 200 && s1.status === "partially_refunded" && Number(s1.refunded_cents) === 200000, s1);
const [rev] = await sql`select coalesce(sum(amount_cents - refunded_cents),0)::int c from payments where workspace_id = ${workspaceId} and status in ('paid','partially_refunded','refunded')`;
check("collected revenue = 5000 − 2000 PKR", rev.c === 300000, rev);
r = await send({ token: `evt_c_${run}`, type: "payment.succeeded", data: { tracker: "track_unknown", state: "TRACKER_ENDED" } });
check("unknown tracker does not touch records", r.data.matched === false, r);
const [{ n }] = await sql`select count(*)::int n from integration_events where workspace_id = ${workspaceId} and provider = 'safepay'`;
check("every inbound event recorded in sync history", n >= 5, n);

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
