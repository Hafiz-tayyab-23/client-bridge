// Automatic Safepay status polling: bounded, claimed, never records without provider confirmation.
// Uses a fake secret key, so Safepay rejects the check and the payment must stay pending.
// Usage: BASE=http://localhost:3001 node scripts/smoke-safepay-poll.mjs  (reads .env)
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
const tick = () => Promise.all([1, 2, 3].map(() => fetch(`${BASE}/api/worker/tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` } }).then((r) => r.json())));

const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ workspaceName: `Poll ${run}`, name: "Pia", email: `pia-${run}@demo.test`, password: "password123" }) });
const { workspaceId, userId } = await res.json();
await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${workspaceId}, 'safepay', 'connected', ${enc({ apiKey: "sec_fake", secretKey: "fake-secret-for-poll-test", webhookSecret: "x".repeat(32) })})`;
const [pay] = await sql`insert into payments (workspace_id, requested_by, amount_cents, currency, status, provider, provider_session, next_provider_check_at)
  values (${workspaceId}, ${userId}, 10000, 'pkr', 'pending', 'safepay', ${`track_${run}`}, now()) returning id`;

await tick(); // three concurrent ticks: only one may claim the payment
let [p] = await sql`select status, provider_check_attempts a, next_provider_check_at n, confirmation_source s from payments where id = ${pay.id}`;
check("concurrent ticks claim the payment once (attempts = 1)", p.a === 1, p);
check("unconfirmed by Safepay → still pending, no confirmation source", p.status === "pending" && p.s === null, p);
check("next check backed off (~30 s, not every tick)", p.n && new Date(p.n) - Date.now() > 20000, p.n);
await new Promise((r) => setTimeout(r, 2500));
await tick();
[p] = await sql`select provider_check_attempts a from payments where id = ${pay.id}`;
check("not re-checked before backoff elapses", p.a === 1, p);
const evs = await sql`select status, summary from integration_events where workspace_id = ${workspaceId} and kind = 'reporter.auto_check'`;
check("each automatic check recorded in sync history", evs.length === 1 && /Attempt 1\/12/.test(evs[0].summary), evs);
await sql`update payments set created_at = now() - interval '4 hours', next_provider_check_at = now() where id = ${pay.id}`;
await new Promise((r) => setTimeout(r, 2500));
await tick();
[p] = await sql`select provider_check_attempts a from payments where id = ${pay.id}`;
check("old payment links are no longer polled (bounded)", p.a === 1, p);

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
