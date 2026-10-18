// Regression: typing in a dialog field must not move the cursor back to the first field
// (re-renders from typing and the 4 s realtime poll). Usage: BASE=... node scripts/e2e-focus.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3000";
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const check = (n, c, i) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n, i ?? ""); } };
const browser = await chromium.launch();
try {
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${BASE}/signup`);
  await p.fill("#workspaceName", `Focus ${run}`); await p.fill("#name", "Fay"); await p.fill("#email", `fay-${run}@demo.test`); await p.fill("#password", "password123");
  await p.click("button[type=submit]"); await p.waitForURL(`${BASE}/`);
  for (const [page, button, field, other] of [["/leads", "Add lead", "#nl-email", "#nl-name"], ["/crm", "New contact", "#c-phone", "#c-name"], ["/team", "Invite employee", "#inv-email", "#inv-name"]]) {
    await p.goto(BASE + page);
    await p.getByRole("button", { name: button }).click();
    await p.locator(field).click();
    await p.keyboard.type("abc", { delay: 80 });
    await p.waitForTimeout(5000); // spans at least one realtime poll re-render
    await p.keyboard.type("def", { delay: 80 });
    const focused = await p.evaluate(() => document.activeElement?.id);
    check(`${page} dialog: focus stays in ${field}`, focused === field.slice(1), `focused=${focused}`);
    check(`${page} dialog: typed text intact`, (await p.inputValue(field)) === "abcdef" && (await p.inputValue(other)) === "", `${await p.inputValue(field)} / first="${await p.inputValue(other)}"`);
    await p.keyboard.press("Escape");
  }
} catch (e) { fail++; console.log("  ✗ aborted:", e.message.split(String.fromCharCode(10))[0]); }
finally { await browser.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
