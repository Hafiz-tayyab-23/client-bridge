// Browser sweep: every screen at 1440px and 390px (no horizontal scroll, no page errors) plus CRM/dashboard flows.
// Usage: BASE=http://localhost:3000 SHOTS=<dir> node scripts/e2e-pages.mjs
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
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  globalThis.__p = p;
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/401|404|409|422|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(`${BASE}/signup`);
  await p.fill("#workspaceName", `Sweep ${run}`); await p.fill("#name", "Sara Sweep"); await p.fill("#email", `sweep-${run}@demo.test`); await p.fill("#password", "password123");
  await p.click("button[type=submit]"); await p.waitForURL(`${BASE}/`);

  console.log("F2.2 custom field via UI");
  await p.goto(`${BASE}/crm?tab=fields`);
  await p.getByRole("button", { name: "New field" }).click();
  await p.fill("#cf-label", "Budget band");
  await p.selectOption("#cf-ent", "contact");
  await p.selectOption("#cf-type", "dropdown");
  await p.fill("#cf-opts", "Low, Mid, High");
  await p.getByRole("button", { name: "Save field" }).click();
  await p.locator("td", { hasText: "Budget band" }).waitFor();
  check("dropdown field created", true);
  await p.getByRole("button", { name: "New field" }).click();
  await p.fill("#cf-label", "Roof area");
  await p.selectOption("#cf-ent", "opportunity");
  await p.selectOption("#cf-type", "number");
  await p.selectOption("#cf-pipe", { label: "Sales" });
  await p.getByRole("button", { name: "Save field" }).click();
  await p.locator("td", { hasText: "Roof area" }).waitFor();

  console.log("F2.4 stage-required field");
  await p.goto(`${BASE}/crm?tab=pipes`);
  await p.getByRole("button", { name: "Edit Proposal" }).click();
  await p.getByLabel("Roof area").check();
  await p.getByRole("button", { name: "Save stage" }).click();
  await p.getByText("requires Roof area").waitFor();
  check("Proposal requires Roof area", true);

  console.log("F2.1 contact with custom field appears immediately");
  await p.goto(`${BASE}/crm`);
  await p.getByRole("button", { name: "New contact" }).click();
  await p.fill("#c-name", "Hina Khan"); await p.fill("#c-email", `hina-${run}@demo.test`); await p.fill("#c-tags", "vip");
  await p.selectOption("#cf-budget_band", "High");
  await p.getByRole("button", { name: "Save contact" }).click();
  await p.waitForURL(/\/crm\/contacts\//);
  await p.getByText("Budget band").waitFor();
  check("contact page shows custom field value", await p.locator("dd", { hasText: "High" }).count() > 0);
  await p.getByRole("tab", { name: /Opportunities/ }).click();
  await p.getByRole("button", { name: "New opportunity" }).click();
  await p.fill("#o-title", "Rooftop 10kW"); await p.fill("#o-value", "12500");
  await p.getByRole("button", { name: "Save" }).click();
  await p.locator("td", { hasText: "Rooftop 10kW" }).waitFor();
  check("opportunity linked to contact", true);
  await p.screenshot({ path: `${SHOTS}/10-contact.png` });

  console.log("F2.5 board move blocked by required field");
  await p.goto(`${BASE}/crm?tab=opps`);
  const card = p.locator(".kc", { hasText: "Rooftop 10kW" });
  await card.waitFor();
  await card.locator("select").selectOption({ label: "Proposal" });
  await p.getByRole("dialog", { name: "Move blocked" }).waitFor();
  check("move blocked with clear message", /Roof area/.test(await p.getByRole("dialog").innerText()));
  await p.getByRole("button", { name: "Fill required fields" }).click();
  await p.fill("#cf-roof_area", "80");
  await p.getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(800);
  await card.locator("select").selectOption({ label: "Proposal" });
  await p.waitForTimeout(1500);
  check("move succeeds after filling", (await p.locator(".col", { hasText: "Proposal" }).locator(".kc", { hasText: "Rooftop 10kW" }).count()) === 1);
  await p.screenshot({ path: `${SHOTS}/11-board.png` });

  console.log("F2.6 filters + saved list");
  await p.goto(`${BASE}/crm`);
  await p.getByRole("button", { name: /Filters/ }).click();
  await p.fill("#f-tag", "vip");
  await p.fill("#f-from", "2026-01-01");
  await p.getByRole("button", { name: "Custom field condition" }).click();
  await p.fill("#cfv0", "High");
  await p.waitForTimeout(1200);
  check("3-criteria filter shows contact", (await p.locator("tbody tr", { hasText: "Hina Khan" }).count()) === 1);
  p.once("dialog", (d) => d.accept("VIP high budget"));
  await p.getByRole("button", { name: "Save as list" }).click();
  await p.getByRole("button", { name: "VIP high budget", exact: true }).waitFor();
  check("saved list chip appears", true);

  console.log("F5 dashboard + drill-down + preferences");
  await p.goto(`${BASE}/`);
  await p.getByText("Open pipeline value").waitFor();
  check("pipeline value shown from records", /\$12,500/.test(await p.locator("a.kpi", { hasText: "Open pipeline value" }).innerText()));
  await p.screenshot({ path: `${SHOTS}/12-dashboard.png`, fullPage: true });
  await p.getByRole("button", { name: "Customize" }).click();
  await p.getByRole("switch", { name: "Escalations (24h)" }).uncheck();
  await p.getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(800);
  await p.reload(); await p.getByText("Open pipeline value").waitFor();
  check("hidden figure remembered after reload", (await p.locator("a.kpi", { hasText: "Escalations" }).count()) === 0);
  await p.locator("a.kpi", { hasText: "Recovery queue items" }).click();
  await p.waitForURL(/state=recovery/);
  check("recovery figure drills into filtered list", true);

  console.log("F4 audit viewer");
  await p.goto(`${BASE}/audit`);
  await p.locator("tbody tr").first().waitFor();
  await p.selectOption("#aev", "stage.changed");
  await p.waitForTimeout(1000);
  const evs = await p.locator("td[data-l=Event]").allInnerTexts();
  check("audit filtered by event type", evs.length > 0 && evs.every((e) => e === "stage.changed"), evs.join(","));

  console.log("Q7 every screen, both widths");
  const pages = ["/", "/leads", "/crm", "/crm?tab=opps", "/crm?tab=pipes", "/crm?tab=fields", "/conversations", "/payments", "/calendar", "/team", "/integrations", "/audit", "/settings"];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await p.setViewportSize(vp);
    for (const path of pages) {
      await p.goto(`${BASE}${path}`); await p.waitForTimeout(900);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${vp.width}px ${path} no horizontal scroll`, over <= 1, `overflow ${over}px`);
    }
  }
  await p.goto(`${BASE}/integrations`); await p.waitForTimeout(1000); await p.screenshot({ path: `${SHOTS}/13-integrations-mobile.png`, fullPage: true });
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  fail++; console.log("  ✗ aborted:", e.message.split(String.fromCharCode(10))[0]);
  await globalThis.__p?.screenshot({ path: `${SHOTS}/fail-pages.png` }).catch(() => {});
  console.log("  errors:", errors.join(" | ") || "none");
} finally { await browser.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
