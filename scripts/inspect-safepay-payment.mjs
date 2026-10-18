// Diagnoses a Safepay payment: our record vs Safepay's reporter API, plus webhook reachability.
// No secrets are printed. Usage: node scripts/inspect-safepay-payment.mjs --env=.env.cloud [--payment=<id>]
import dotenv from "dotenv";
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
dotenv.config({ path: arg("env") ?? ".env", quiet: true });
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY.trim(), "base64");
const dec = (p) => { const [iv, tag, e] = p.split(".").map((x) => Buffer.from(x, "base64url")); const d = createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(e), d.final()]).toString()); };
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: local ? false : "require", max: 1, onnotice: () => {} });

const [p] = arg("payment")
  ? await sql`select * from payments where id = ${arg("payment")}`
  : await sql`select * from payments where provider = 'safepay' order by created_at desc limit 1`;
const [conn] = await sql`select id, secrets_enc from integration_connections where workspace_id = ${p.workspace_id} and provider = 'safepay'`;
const events = await sql`select kind, direction, status, left(coalesce(error, summary, ''), 160) d, to_char(created_at at time zone 'Asia/Karachi', 'HH24:MI:SS') t
  from integration_events where workspace_id = ${p.workspace_id} and provider = 'safepay' order by id desc limit 10`;
await sql.end();
const s = dec(conn.secrets_enc);
console.log(`OUR RECORD: payment ${p.id.slice(0, 8)} status=${p.status} amount=${p.amount_cents} ${p.currency.toUpperCase()} tracker=${p.provider_session?.slice(0, 12)}… created=${new Date(p.created_at).toISOString()}`);
console.log(`webhook secret stored: ${Boolean(s.webhookSecret)} | webhook URL: https://nascon-web-team-034.vercel.app/api/webhooks/safepay/${conn.id}`);

const rep = await fetch(`https://sandbox.api.getsafepay.com/reporter/api/v1/payments/${encodeURIComponent(p.provider_session)}`, {
  headers: { Accept: "application/json", "x-sfpy-merchant-secret": s.secretKey },
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const d = rep.json?.data ?? {};
const flat = (o, pre = "", depth = 0) => (!o || typeof o !== "object" || depth > 4 ? [] : Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === "object" ? flat(v, `${pre}${k}.`, depth + 1) : [`${pre}${k}=${/token|secret|tbt|client\.|fingerprint|email|phone/i.test(pre + k) ? "…" : JSON.stringify(v)}`]));
console.log(`\nSAFEPAY REPORTER: HTTP ${rep.status}`);
console.log(flat(d).filter((x) => /state|status|amount|currency|order_id\.value|created|updated|ended|intent|mode|payment_method|kind|result|code|message/i.test(x)).slice(0, 40).join("\n"));

const probe = await fetch(`https://nascon-web-team-034.vercel.app/api/webhooks/safepay/${conn.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "diagnostic.unsigned" }) });
console.log(`\nWEBHOOK REACHABILITY: unsigned POST → HTTP ${probe.status} (expect 400 = route live and rejecting unsigned requests)`);
console.log("\nRECENT SAFEPAY SYNC EVENTS:"); for (const e of events) console.log(` ${e.t} ${e.direction} ${e.kind} ${e.status} ${e.d}`);
