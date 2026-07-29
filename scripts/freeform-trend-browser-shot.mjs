/**
 * freeform-trend-browser-shot.mjs
 *
 * 把一份**真实生成**的 freeformOverview 塞进 service_ticket fixture，用真浏览器
 * 打开总览页并截图——验的是 KPI 卡的第二、三层（环比文案 + 迷你走势线）在真实
 * 渲染路径上确实长出来了。
 *
 * 为什么非得走浏览器：环比和走势线都是**渲染端现算**的，Python 侧只声明了
 * 「拿哪个日期字段分桶」。生成侧数得出 4 处 trendFieldRef，不等于页面上真出现
 * 了 4 条走势线——中间隔着种子数据、日期解析、ECharts 懒加载。这条路径上一次
 * 就栽过（enumOptionsOf 类型全绿、真跑没效果）。
 *
 * 用法：
 *   node scripts/freeform-trend-browser-shot.mjs <generated-overview.json>
 *
 * 截图目录：tmp/freeform-trend-shot/
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.SLIDERULE_SMOKE_PORT ?? "3000", 10);
const baseUrl = `http://localhost:${PORT}`;
const outDir = resolve(ROOT, "tmp", "freeform-trend-shot");
mkdirSync(outDir, { recursive: true });

const DOMAIN = "service_ticket";
const DASHBOARD_PAGE_ID = "service_dashboard";

const log = m => process.stdout.write(`[trend-shot] ${m}\n`);
const fail = m => {
  process.stderr.write(`[trend-shot] FAIL: ${m}\n`);
  process.exit(1);
};

const overviewPath = process.argv[2];
if (!overviewPath) fail("usage: node scripts/freeform-trend-browser-shot.mjs <overview.json>");
const overview = JSON.parse(readFileSync(overviewPath, "utf-8"));

function buildFixture() {
  const instruments = JSON.parse(
    readFileSync(resolve(ROOT, "client/src/pages/sliderule/demo-gallery/instruments.json"), "utf-8")
  );
  const builtins = JSON.parse(
    readFileSync(resolve(ROOT, "slide-rule-python/services/data/builtin_domain_models.json"), "utf-8")
  );
  const domainModel = JSON.parse(JSON.stringify(builtins[DOMAIN]));

  // 换掉总览页的 freeformOverview，其余（数据模型/权限/流程）全用真实 builtin，
  // 这样跑出来的就是真实应用，不是给这次验证特制的假页面。
  const page = domainModel.page.pages.find(p => p.id === DASHBOARD_PAGE_ID);
  if (!page) fail(`page ${DASHBOARD_PAGE_ID} not found in ${DOMAIN}`);
  page.freeformOverview = overview;

  const SKILL_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];
  const sessionId = `freeform-trend-shot-${DOMAIN}`;
  const perSkillEvidence = {};
  for (const skill of SKILL_KEYS) {
    perSkillEvidence[skill] = {
      evidencePresent: true,
      evidenceRef: `evidence:${skill}:llm-linkage-${skill}`,
      path: `skills/${skill}/closure-evidence.json`,
      artifactId: `llm-linkage-${skill}`,
      digest: `shot-${DOMAIN}-${skill}`,
      modelSection: domainModel[skill],
    };
  }
  const fixtureState = {
    ...(instruments.state ?? {}),
    sessionId,
    goal: { text: "客户服务工单系统", status: "clear" },
    publishClosure: {
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      closureId: `appbundle:${DOMAIN}@1.0.0:runtime-closure`,
      closureHash: `shot-${DOMAIN}`,
      stableDigest: `stable-shot-${DOMAIN}`,
      tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
      perSkillEvidence,
    },
  };
  return { sessionId, fixtureState };
}

let devServerProc = null;
const cleanup = () => {
  if (devServerProc) {
    try {
      devServerProc.kill();
    } catch {}
    devServerProc = null;
  }
};
process.once("exit", cleanup);

async function isServerReady(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 1500);
  try {
    const res = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function waitForServer(url, totalMs) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await isServerReady(url)) return true;
    await sleep(350);
  }
  return false;
}

async function resolveChromium() {
  for (const mod of ["@playwright/test", "playwright", "playwright-core"]) {
    try {
      const m = await import(mod);
      const c = m.chromium || m.default?.chromium;
      if (c) return c;
    } catch {}
  }
  return fail("Playwright not resolvable");
}

async function main() {
  if (!(await waitForServer(baseUrl, 8000))) {
    log("dev server not up; spawning pnpm dev:frontend ...");
    devServerProc = spawn("pnpm", ["run", "dev:frontend"], {
      stdio: "ignore",
      detached: true,
      cwd: ROOT,
    });
    devServerProc.unref?.();
    if (!(await waitForServer(baseUrl, 90000))) fail("dev server never came up");
  }
  log("dev server reachable");

  const chromium = await resolveChromium();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const { sessionId, fixtureState } = buildFixture();

  await page.addInitScript(sid => {
    try {
      localStorage.setItem("sliderule:active-session-id", sid);
    } catch {}
  }, sessionId);

  await page.route("**/api/sliderule/**", async route => {
    const url = route.request().url();
    if (url.includes(`/api/sliderule/sessions/${sessionId}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: fixtureState }),
      });
    } else if (/\/api\/sliderule\/sessions\/?$/.test(new URL(url).pathname)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [{ sessionId, goal: "客户服务工单系统" }] }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
    }
  });

  await page.goto(baseUrl + "/sliderule", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="app-runtime-screen"]', { timeout: 30000 });
  log("app runtime mounted");

  // 跳到总览页——freeformOverview 挂在 service_dashboard 上
  const menu = page.locator(`[data-testid="app-runtime-menu-${DASHBOARD_PAGE_ID}"]`);
  if ((await menu.count()) === 0) fail(`menu item for ${DASHBOARD_PAGE_ID} not found`);
  await menu.first().click();
  await page.waitForSelector('[data-testid="freeform-insight"]', { timeout: 20000 });
  // ECharts 懒加载 + 首帧渲染
  await page.waitForTimeout(2500);

  const trendCount = await page.locator('[data-testid="dataref-trend-delta"]').count();
  const sparkCount = await page.locator('[data-testid="dataref-sparkline"] canvas').count();
  const labels = await page.locator('[data-testid="dataref-trend-delta"]').allInnerTexts();
  log(`环比徽标 ${trendCount} 个，走势线 canvas ${sparkCount} 个`);
  for (const l of labels) log(`  ${l.replace(/\s+/g, " ")}`);

  const shot = join(outDir, "overview-with-trend.png");
  await page.screenshot({ path: shot, fullPage: true });
  log(`screenshot: ${shot}`);

  // 舞台把应用缩到 ~49% 显示，整页截图里三层结构糊成一片。再单独截一张
  // freeform 区域的元素图——要看的是"环比小字和走势线到底长什么样"。
  const closeup = join(outDir, "overview-closeup.png");
  await page.locator('[data-testid="freeform-insight"]').first().screenshot({ path: closeup });
  log(`closeup: ${closeup}`);

  await browser.close();
  cleanup();

  if (trendCount === 0) fail("没有渲染出任何环比徽标——生成侧声明了但渲染端没接上");
  if (sparkCount === 0) fail("没有渲染出任何走势线 canvas");
  log("PASS");
}

main().catch(e => fail(e?.stack || e));
