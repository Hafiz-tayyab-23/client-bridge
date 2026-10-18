// Webhook-logic checks for Stripe (I2.2–I2.6) using locally signed events.
// Does NOT call Stripe; the real Checkout flow needs a test key (see README).
// Usage: node scripts/smoke-stripe.mjs   (reads .env for DATABASE_URL and APP_ENCRYPTION_KEY)
import dotenv from "dotenv";
import postgres from "postgres";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";

dotenv.config({ path: ".env", quiet: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (n, c, i) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, i === undefined ? "" : JSON.stringify(i).slice(0, 300)); } };

function encryptJson(v) {
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(v), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
async function signup(name) {
  const res = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ workspaceName: name, name, email: `${name.toLowerCase().replace(/\W/g, "")}-${run}@demo.test`, password: "password123" }) });
  return { ...(await res.json()), cookie: res.headers.get("set-cookie").match(/sid=[^;]+/)[0] };
}

const A = await signup(`Pay A ${run}`), B = await signup(`Pay B ${run}`);
const whsec = "whsec_test" + randomBytes(16).toString("hex");
const [connA] = await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${A.workspaceId}, 'stripe', 'connected', ${encryptJson({ secretKey: "sk_test_local", webhookSecret: whsec })}) returning id`;
const [pipe] = await sql`select p.id, s.id as stage_id from pipelines p join stages s on s.pipeline_id = p.id where p.workspace_id = ${A.workspaceId} order by s.position limit 1`;
const [opp] = await sql`insert into opportunities (workspace_id, pipeline_id, stage_id, title, value_cents, owner_id) values (${A.workspaceId}, ${pipe.id}, ${pipe.stage_id}, 'Solar kit', 50000, ${A.userId}) returning id`;
const [pay] = await sql`insert into payments (workspace_id, opportunity_id, requested_by, amount_cents, currency, status, provider_session) values (${A.workspaceId}, ${opp.id}, ${A.userId}, 50000, 'usd', 'pending', ${"cs_test_" + run}) returning id`;

const send = (event, { secret = whsec, ts = Math.floor(Date.now() / 1000), conn = connA.id, tamper = false } = {}) => {
  const body = JSON.stringify(event);
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return fetch(`${BASE}/api/webhooks/stripe/${conn}`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` }, body: tamper ? body.replace("50000", "1") : body })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
};
const ev = (id, type, object) => ({ id, type, livemode: false, data: { object } });
const status = async () => (await sql`select status, refunded_cents, paid_at from payments where id = ${pay.id}`)[0];

const completed = ev(`evt_c_${run}`, "checkout.session.completed", { id: `cs_test_${run}`, payment_status: "paid", payment_intent: `pi_${run}`, amount_total: 50000, metadata: { payment_id: pay.id } });
let r = await send(completed, { secret: "whsec_wrong" });
check("forged signature rejected (400)", r.status === 400, r);
r = await send(completed, { tamper: true });
check("altered body rejected (400)", r.status === 400, r);
r = await send(completed, { ts: Math.floor(Date.now() / 1000) - 3600 });
check("stale timestamp rejected (replay)", r.status === 400, r);
check("no change before verification", (await status()).status === "pending");
const [rej] = await sql`select count(*)::int as n from integration_events where workspace_id = ${A.workspaceId} and status = 'rejected'`;
check("rejections recorded in sync history", rej.n >= 3, rej);

r = await send(completed);
check("verified completion → paid", r.status === 200 && (await status()).status === "paid", r);
r = await send(completed);
check("duplicate event processed once", r.data.duplicate === true, r);
const [acts] = await sql`select count(*)::int as n from activities where opportunity_id = ${opp.id} and type = 'payment.paid'`;
check("single payment.paid activity", acts.n === 1, acts);

r = await send(ev(`evt_x_${run}`, "checkout.session.expired", { id: `cs_test_${run}`, metadata: { payment_id: pay.id } }));
check("late expiry does not downgrade paid", (await status()).status === "paid", await status());

r = await send(ev(`evt_r1_${run}`, "charge.refunded", { id: `ch_${run}`, payment_intent: `pi_${run}`, amount_refunded: 20000, metadata: {} }));
let s = await status();
check("partial refund reflected", s.status === "partially_refunded" && Number(s.refunded_cents) === 20000, s);
const [rev] = await sql`select coalesce(sum(amount_cents - refunded_cents),0)::int as c from payments where workspace_id = ${A.workspaceId} and status in ('paid','partially_refunded','refunded')`;
check("collected = payments − refunds (300.00)", rev.c === 30000, rev);
r = await send(ev(`evt_r2_${run}`, "charge.refunded", { id: `ch_${run}`, payment_intent: `pi_${run}`, amount_refunded: 50000, metadata: {} }));
check("full refund reflected", (await status()).status === "refunded");

const [pay2] = await sql`insert into payments (workspace_id, opportunity_id, requested_by, amount_cents, currency, status) values (${A.workspaceId}, ${opp.id}, ${A.userId}, 1000, 'usd', 'pending') returning id`;
r = await send(ev(`evt_f_${run}`, "payment_intent.payment_failed", { id: `pi_f_${run}`, metadata: { payment_id: pay2.id }, last_payment_error: { message: "Your card was declined." } }));
const [p2] = await sql`select status from payments where id = ${pay2.id}`;
check("failed payment shown as failed", p2.status === "failed", p2);

// Cross-workspace: an event for A's payment arriving on B's endpoint (signed with B's secret) must not touch A.
const whsecB = "whsec_test" + randomBytes(16).toString("hex");
const [connB] = await sql`insert into integration_connections (workspace_id, provider, status, secrets_enc) values (${B.workspaceId}, 'stripe', 'connected', ${encryptJson({ secretKey: "sk_test_b", webhookSecret: whsecB })}) returning id`;
r = await send(ev(`evt_cross_${run}`, "checkout.session.expired", { id: "cs_x", metadata: { payment_id: pay2.id } }), { secret: whsecB, conn: connB.id });
check("B's endpoint cannot change A's payment", r.data.matched === false && (await sql`select status from payments where id = ${pay2.id}`)[0].status === "failed", r);
r = await send(completed, { conn: connB.id });
check("A's secret does not verify on B's endpoint", r.status === 400, r);

const res = await fetch(`${BASE}/api/payments`, { headers: { cookie: A.cookie } }).then((x) => x.json());
check("payments list shows opportunity + requester", res.payments?.some((p) => p.opportunity_title === "Solar kit" && p.requested_by_name), res);

console.log(`\n${pass} passed, ${fail} failed`);
await sql.end();
process.exit(fail ? 1 : 0);
