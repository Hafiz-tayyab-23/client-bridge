// Browser journey: signup → invite → rules → web-form lead → countdown → server escalation → acknowledge → recovery rule.
// Usage: BASE=http://localhost:3000 SHOTS=<dir> node scripts/e2e-browser.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./.e2e-shots";
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (n, c, i) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, i === undefined ? "" : String(i).slice(0, 300)); } };
const browser = await chromium.launch();
const errors = [];
const ctx = async (viewport = { width: 1440, height: 900 }) => {
  const c = await browser.newContext({ viewport });
  c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return c;
};

try {
  const ownerCtx = await ctx();
  const owner = await ownerCtx.newPage();
  owner.on("pageerror", (e) => errors.push(e.message));
  console.log("F1.1 signup / session");
  await owner.goto(`${BASE}/signup`);
  await owner.fill("#workspaceName", `Browser Co ${run}`);
  await owner.fill("#name", "Olivia Owner");
  await owner.fill("#email", `olivia-${run}@demo.test`);
  await owner.fill("#password", "password123");
  await owner.click("button[type=submit]");
  await owner.waitForURL(`${BASE}/`);
  check("signup lands in app shell", await owner.locator(".side .brand").isVisible());
  await owner.reload();
  check("session persists after refresh", await owner.locator(".me b").innerText() === "Olivia Owner");
  check("owner sees Integrations + Audit nav", (await owner.locator(".nav a", { hasText: "Audit Log" }).count()) === 1 && (await owner.locator(".nav a", { hasText: "Integrations" }).count()) === 1);
  await owner.screenshot({ path: `${SHOTS}/01-dashboard.png` });

  console.log("F1.2 invite");
  await owner.goto(`${BASE}/team`);
  await owner.getByRole("button", { name: "Invite employee" }).click();
  await owner.fill("#inv-name", "Sam Sales");
  await owner.fill("#inv-email", `sam-${run}@demo.test`);
  await owner.getByRole("button", { name: "Create invitation" }).click();
  const link = await owner.locator("input[aria-label='Invitation link']").inputValue();
  check("invite link shown", link.includes("/invite?token="), link);
  await owner.getByRole("button", { name: "Done" }).click();
  const samCtx = await ctx();
  const sam = await samCtx.newPage();
  await sam.goto(link);
  await sam.fill("#password", "password123");
  await sam.click("button[type=submit]");
  await sam.waitForURL(`${BASE}/`);
  check("invitee signed in as user", (await sam.locator(".me small").innerText()).toLowerCase() === "user");
  check("Sales role hides Audit/Integrations nav", (await sam.locator(".nav a", { hasText: "Audit Log" }).count()) === 0 && (await sam.locator(".nav a", { hasText: "Integrations" }).count()) === 0);

  console.log("F3.3/F3.5 rules");
  await owner.goto(`${BASE}/settings`);
  await owner.waitForSelector("#ackw");
  await owner.fill("#ackw", "8");
  await owner.fill("#lw0", "60");
  await owner.selectOption("#lt1", "manager").catch(() => {});
  await owner.fill("#lw1", "8").catch(() => {});
  const ownerOpt = await owner.locator("#mg option", { hasText: "Olivia Owner" }).getAttribute("value");
  await owner.selectOption("#mg", ownerOpt);
  await owner.getByRole("button", { name: "Save changes" }).click();
  await owner.locator(".toast", { hasText: "Settings saved" }).waitFor({ timeout: 8000 });
  check("rules saved to server", true);

  console.log("F3.1/F3.4 web form lead → owner + countdown");
  const pubCtx = await ctx({ width: 390, height: 844 });
  const pub = await pubCtx.newPage();
  const wsId = await owner.evaluate(() => fetch("/api/auth/me").then((r) => r.json()).then((d) => d.workspace.id));
  await pub.goto(`${BASE}/f/${wsId}`);
  await pub.fill("#name", "Rachel Green");
  await pub.fill("#email", `rachel-${run}@demo.test`);
  await pub.fill("#message", "Need a quote");
  await pub.click("button[type=submit]");
  await pub.getByText("we received your request").waitFor();
  check("public form accepted", true);
  await pub.screenshot({ path: `${SHOTS}/02-public-form-mobile.png` });

  await owner.goto(`${BASE}/leads`);
  const row = owner.locator("tbody tr", { hasText: "Rachel Green" });
  await row.waitFor({ timeout: 10000 });
  const owner1 = await row.locator("td[data-l=Owner]").innerText();
  check("lead has exactly one owner", /Olivia Owner|Sam Sales/.test(owner1), owner1);
  check("countdown visible", /left/.test(await row.locator("td[data-l='Time remaining']").innerText()));
  await row.click();
  await owner.locator("aside[aria-label='Lead details']").waitFor();
  await owner.screenshot({ path: `${SHOTS}/03-leads-desktop.png` });

  console.log("F3.5/F3.8 server escalation (no client action)");
  await owner.waitForTimeout(13000);
  const hist = await owner.locator("aside[aria-label='Lead details'] .tl").innerText();
  const owner2 = await row.locator("td[data-l=Owner]").innerText();
  check("ownership moved to the other employee", owner2.split("\n")[0] !== owner1.split("\n")[0], `${owner1} → ${owner2}`);
  check("history shows escalation by server", /escalation \(level 1\)/.test(hist), hist);
  await owner.screenshot({ path: `${SHOTS}/04-escalated.png` });

  console.log("F3.4 acknowledge by new owner");
  const newOwnerPage = owner2.includes("Sam") ? sam : owner;
  globalThis.__dbg = newOwnerPage;
  await newOwnerPage.goto(`${BASE}/leads`);
  const r2 = newOwnerPage.locator("tbody tr", { hasText: "Rachel Green" });
  await r2.getByRole("button", { name: "Acknowledge" }).click();
  await newOwnerPage.locator(".toast", { hasText: "acknowledged" }).waitFor({ timeout: 8000 });
  await newOwnerPage.waitForTimeout(1500);
  check("status Acknowledged", /Acknowledged/.test(await r2.locator("td[data-l=Status]").innerText()));

  console.log("F3.7 recovery rule");
  const counts = await owner.evaluate(() => fetch("/api/leads/summary").then((r) => r.json()));
  check("escalated-once + acknowledged lead is NOT in recovery", counts.counts.recovery === 0, JSON.stringify(counts));

  console.log("F1.6 isolation in browser");
  const leadId = await owner.evaluate(() => fetch("/api/leads?state=all").then((r) => r.json()).then((d) => d.leads[0].id));
  const otherCtx = await ctx();
  const other = await otherCtx.newPage();
  await other.goto(`${BASE}/signup`);
  await other.fill("#workspaceName", `Other ${run}`); await other.fill("#name", "Ozzy"); await other.fill("#email", `ozzy-${run}@demo.test`); await other.fill("#password", "password123");
  await other.click("button[type=submit]"); await other.waitForURL(`${BASE}/`);
  await other.goto(`${BASE}/leads?id=${leadId}`);
  await other.locator("aside .err").waitFor({ timeout: 8000 });
  check("other workspace sees 'Lead not found'", /not found/i.test(await other.locator("aside .err").innerText()));

  console.log("Q7 responsive (390px)");
  const mob = await ctx({ width: 390, height: 844 });
  const m = await mob.newPage();
  await m.goto(`${BASE}/login`);
  await m.fill("#email", `olivia-${run}@demo.test`); await m.fill("#password", "password123"); await m.click("button[type=submit]");
  await m.waitForURL(`${BASE}/`);
  for (const p of ["/", "/leads", "/team", "/settings"]) {
    await m.goto(`${BASE}${p}`); await m.waitForTimeout(1200);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no horizontal scroll at 390px on ${p}`, over <= 1, `overflow ${over}px`);
  }
  await m.goto(`${BASE}/leads`); await m.waitForTimeout(1200);
  await m.screenshot({ path: `${SHOTS}/05-leads-mobile.png`, fullPage: true });
  await m.click(".menu-btn");
  check("mobile nav opens", await m.locator(".side.open").isVisible());

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fail++; console.log("  ✗ journey aborted:", e.message.split(String.fromCharCode(10))[0]);
  if (globalThis.__dbg) { await globalThis.__dbg.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {}); console.log("  url:", globalThis.__dbg.url()); }
  console.log("  page errors:", errors.join(" | ") || "none");
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
