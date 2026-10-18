// Offline analysis of rejected Safepay webhook samples (encrypted in integration_events). Prints only which
// signing combination matches — never secrets or payloads. Usage: node scripts/analyze-safepay-signature.mjs --env=.env.cloud [--wait]
import dotenv from "dotenv";
import postgres from "postgres";
import { createDecipheriv, createHmac } from "node:crypto";

const arg = (k) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
dotenv.config({ path: (arg("env") ?? "--env=.env").split("=")[1], quiet: true });
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY.trim(), "base64");
const dec = (p) => { const [iv, tag, e] = p.split(".").map((x) => Buffer.from(x, "base64url")); const d = createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(e), d.final()]).toString()); };
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require", max: 1, onnotice: () => {} });

/** Raw substring of the top-level "data" value, exactly as sent. */
function rawData(raw) {
  const i = raw.search(/"data"\s*:/);
  if (i < 0) return null;
  let j = raw.indexOf(":", i) + 1;
  while (/\s/.test(raw[j])) j++;
  const open = raw[j], close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < raw.length; k++) {
    const c = raw[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === open) depth++; else if (c === close && --depth === 0) return raw.slice(j, k + 1);
  }
  return null;
}

let sample;
for (let i = 0; i < (arg("wait") ? 120 : 1); i++) {
  [sample] = await sql`select ie.summary, ie.workspace_id, to_char(ie.created_at at time zone 'Asia/Karachi','HH24:MI:SS') t from integration_events ie
    where ie.provider = 'safepay' and ie.kind = 'webhook.rejected_sample' order by ie.id desc limit 1`;
  if (sample) break;
  await new Promise((r) => setTimeout(r, 10000));
}
if (!sample) { console.log("No rejected sample yet."); await sql.end(); process.exit(1); }
const [conn] = await sql`select secrets_enc from integration_connections where workspace_id = ${sample.workspace_id} and provider = 'safepay'`;
await sql.end();
const { raw, sig } = dec(sample.summary.slice(4));
const s = dec(conn.secrets_enc);
const parsed = JSON.parse(raw);
console.log(`sample ${sample.t} | body ${raw.length} bytes | type=${parsed.type} version=${parsed.version} | sig length ${sig?.length} | top-level keys: ${Object.keys(parsed).join(",")}`);
console.log(`stored webhook secret: length ${s.webhookSecret?.length}, looks ${/^[0-9a-f]+$/i.test(s.webhookSecret) ? "hex" : /^[A-Za-z0-9+/=_-]+$/.test(s.webhookSecret) ? "base64-ish/alnum" : "other"}`);
const rd = rawData(raw);
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
const omit = (o, ks) => Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k)));
const payloads = {
  "raw body": raw, "raw data substring": rd, "JSON.stringify(data)": JSON.stringify(parsed.data), "JSON.stringify(payload)": JSON.stringify(parsed),
  "sorted data": JSON.stringify(sortKeys(parsed.data)), "sorted payload": JSON.stringify(sortKeys(parsed)),
  "payload w/o endpoint": JSON.stringify(omit(parsed, ["endpoint"])), "payload w/o endpoint,created_at": JSON.stringify(omit(parsed, ["endpoint", "created_at"])),
  "payload w/o delivery fields": JSON.stringify(omit(parsed, ["endpoint", "delivery_attempts", "next_attempt_at"])),
  "token": String(parsed.token), "data.tracker": String(parsed.data?.tracker), "token+data": String(parsed.token) + JSON.stringify(parsed.data),
  "pretty data": JSON.stringify(parsed.data, null, 2), "pretty payload": JSON.stringify(parsed, null, 2),
};
const keyForms = {};
for (const [name, k] of [["webhook secret", s.webhookSecret], ["api secret", s.secretKey], ["public key", s.apiKey]]) {
  if (!k) continue;
  keyForms[`${name} (utf8)`] = Buffer.from(k, "utf8");
  if (/^[0-9a-f]+$/i.test(k) && k.length % 2 === 0) keyForms[`${name} (hex-decoded)`] = Buffer.from(k, "hex");
  if (/^[A-Za-z0-9+/=_-]+$/.test(k)) keyForms[`${name} (base64-decoded)`] = Buffer.from(k, k.includes("-") || k.includes("_") ? "base64url" : "base64");
}
const hits = [];
for (const [pn, pv] of Object.entries(payloads)) for (const [kn, kv] of Object.entries(keyForms)) for (const algo of ["sha512", "sha256"]) {
  if (pv == null) continue;
  const d = createHmac(algo, kv).update(pv, "utf8").digest();
  if (sig === d.toString("hex") || sig?.toLowerCase() === d.toString("hex") || sig === d.toString("base64")) hits.push(`${algo} over ${pn} keyed with ${kn}`);
}
console.log(`raw data substring equals JSON.stringify(data): ${rd === JSON.stringify(parsed.data)} | data keys: ${Object.keys(parsed.data ?? {}).join(",")} | endpoint field type: ${typeof parsed.endpoint}`);
console.log(hits.length ? `MATCH: ${hits.join(" | ")}` : "NO MATCH with any stored key — the saved webhook secret is most likely not this endpoint's shared secret.");
