// Live Safepay SANDBOX verification of amount units (no secrets printed).
// Reads the workspace's encrypted Safepay keys from the database, creates a real session for PKR 1,234.50,
// reads Safepay's own record of it, and opens the hosted checkout to see which amount it displays.
// Usage: node scripts/verify-safepay-sandbox.mjs --env=.env.cloud [--workspace=<name>]
import dotenv from "dotenv";
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
import { chromium } from "playwright";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
dotenv.config({ path: arg("env") ?? ".env", quiet: true });
const API = "https://sandbox.api.getsafepay.com";
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY.trim(), "base64");
const dec = (p) => { const [iv, tag, e] = p.split(".").map((x) => Buffer.from(x, "base64url")); const d = createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(e), d.final()]).toString()); };
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: local ? false : "require", max: 1, onnotice: () => {} });

const [conn] = await sql`select ic.secrets_enc, w.name from integration_connections ic join workspaces w on w.id = ic.workspace_id
  where ic.provider = 'safepay' and ic.status = 'connected' ${arg("workspace") ? sql`and w.name = ${arg("workspace")}` : sql``} order by ic.updated_at desc limit 1`;
await sql.end();
if (!conn) { console.log("No connected Safepay workspace found. Connect it on Integrations first."); process.exit(1); }
const s = dec(conn.secrets_enc);
console.log(`workspace: ${conn.name} | apiKey ${s.apiKey.slice(0, 4)}…(${s.apiKey.length}) | secret set: ${Boolean(s.secretKey)} | webhook secret set: ${Boolean(s.webhookSecret)}`);
const call = (method, path, body) => fetch(API + path, { method, headers: { "Content-Type": "application/json", Accept: "application/json", "x-sfpy-merchant-secret": s.secretKey }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const shape = (o, p = "", d = 0) => (!o || typeof o !== "object" || d > 3 ? [] : Object.entries(o).flatMap(([k, v]) => [`${p}${k}${typeof v !== "object" || v === null ? `=${typeof v === "string" && /secret|token|tbt/i.test(k) ? "…" : JSON.stringify(v)?.slice(0, 40)}` : ""}`, ...shape(v, `${p}${k}.`, d + 1)]));

const requestedMinor = 123450; // PKR 1,234.50 if "lowest denomination" means paisa
const created = await call("POST", "/order/payments/v3/", { merchant_api_key: s.apiKey, intent: "CYBERSOURCE", mode: "payment", currency: "PKR", amount: requestedMinor, metadata: { order_id: "probe-amount-units" } });
console.log("create session:", created.status);
const tracker = created.json?.data?.tracker?.token;
if (!tracker) { console.log("create response fields:", shape(created.json).join(" | ")); process.exit(1); }
console.log("create response (non-secret fields):", shape(created.json?.data?.tracker ?? created.json?.data).filter((x) => /amount|currency|state|token/.test(x)).join(" | "));
const rep = await call("GET", `/reporter/api/v1/payments/${tracker}`);
console.log("reporter:", rep.status, "|", shape(rep.json).filter((x) => /amount|currency|state|status|token/i.test(x)).slice(0, 15).join(" | "));
const tbt = await call("POST", "/client/passport/v1/token", {});
const url = `https://sandbox.api.getsafepay.com/embedded/?${new URLSearchParams({ environment: "sandbox", tracker, tbt: tbt.json?.data ?? "", source: "hosted", redirect_url: "https://nascon-web-team-034.vercel.app/pay/done", cancel_url: "https://nascon-web-team-034.vercel.app/pay/done?cancelled=1", order_id: "probe" })}`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
const amounts = [...new Set(text.match(/(PKR|Rs\.?|₨)\s?[\d,]+(\.\d+)?|[\d,]+(\.\d+)?\s?(PKR)/gi) ?? [])];
console.log("checkout page amounts shown:", amounts.join(" | ") || "(none found)");
await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/safepay-checkout.png` : "./safepay-checkout.png" });
await browser.close();
console.log(`interpretation: requested ${requestedMinor} minor units → expect checkout to show 1,234.50 if units are paisa, or 123,450 if units are rupees.`);
