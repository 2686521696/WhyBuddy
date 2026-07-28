import { chromium } from "@playwright/test";
const OUT = "/tmp/claude-0/-home-user-WhyBuddy/2f698fb1-160b-5fb3-8713-cf419152bf37/scratchpad/planc";
(await import("node:fs")).mkdirSync(OUT, { recursive: true });
const RT = '[data-testid="app-runtime-screen"]';
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await (await b.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", e => errs.push(String(e)));
await page.goto("http://localhost:3000/sliderule", { waitUntil: "networkidle" });
const box = page.locator('[data-testid="sliderule-composer-dock"] textarea').first();
await box.waitFor({ timeout: 60000 });
await box.fill("给社区健身房做一套会员与私教课管理：会员办卡续卡、私教排课与签到、每月统计新增会员数和课时消耗趋势，另外要一个总览页看经营情况。");
await page.waitForTimeout(1000);
await page.locator('[data-testid="sliderule-composer-dock"] button').last().click();
console.log("推演已发起，等应用出现…");
const t0 = Date.now();
try {
  await page.waitForSelector(RT, { timeout: 600000 });
  console.log(`应用出现，用时 ${Math.round((Date.now()-t0)/1000)}s`);
} catch { console.log("超时，未出应用"); await b.close(); process.exit(0); }
await page.waitForTimeout(10000);
await page.screenshot({ path: `${OUT}/1-landing.png` });
// 逐页看积木用在哪
const menuItems = await page.locator(`${RT} .agent-ant-menu-item, ${RT} [class*="menu-item"]`).allInnerTexts().catch(()=>[]);
console.log("菜单:", menuItems.map(t=>t.trim()).filter(Boolean).join(" / "));
for (const t of ["metric-grid","trend-chart","ranked-list","activity-feed","data-table","quick-action-panel","filter-bar","workflow-timeline","freeform-insight"]) {
  const n = await page.locator(`${RT} [data-testid="${t}"]`).count();
  if (n) console.log(`  落地页 ${t}: ${n}`);
}
console.log("errors:", errs.length ? errs.slice(0,3) : "none");
console.log("URL:", page.url());
await b.close();
