/**
 * model-browser-shot.mjs
 *
 * 把一份**完整的五系统模型**（fresh_topic_shot.py 的产物）灌进真实前端，
 * 逐页截图。跟 freeform-trend-browser-shot.mjs 的区别是那个只换总览设计、
 * 其余吃 builtin fixture；这个整份模型都是新生成的。
 *
 * 用法：
 *   node scripts/model-browser-shot.mjs <model.json> <outDir>
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

const log = m => process.stdout.write(`[model-shot] ${m}\n`);
const fail = m => {
  process.stderr.write(`[model-shot] FAIL: ${m}\n`);
  process.exit(1);
};

const modelPath = process.argv[2];
const outDir = process.argv[3] ?? resolve(ROOT, "tmp", "model-shot");
if (!modelPath) fail("usage: node scripts/model-browser-shot.mjs <model.json> [outDir]");
mkdirSync(outDir, { recursive: true });
const model = JSON.parse(readFileSync(modelPath, "utf-8"));

function buildFixture() {
  const instruments = JSON.parse(
    readFileSync(resolve(ROOT, "client/src/pages/sliderule/demo-gallery/instruments.json"), "utf-8")
  );
  const SKILL_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];
  const sessionId = "model-shot-session";
  const perSkillEvidence = {};
  for (const skill of SKILL_KEYS) {
    perSkillEvidence[skill] = {
      evidencePresent: true,
      evidenceRef: `evidence:${skill}:llm-linkage-${skill}`,
      path: `skills/${skill}/closure-evidence.json`,
      artifactId: `llm-linkage-${skill}`,
      digest: `shot-${skill}`,
      modelSection: model[skill],
    };
  }
  const goal = model.appbundle?.appIdentity?.name || "生成的应用";
  return {
    sessionId,
    goal,
    fixtureState: {
      ...(instruments.state ?? {}),
      sessionId,
      goal: { text: goal, status: "clear" },
      publishClosure: {
        blocked: false,
        blockerCount: 0,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        closureId: "appbundle:model-shot@1.0.0:runtime-closure",
        closureHash: "model-shot",
        stableDigest: "stable-model-shot",
        tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
        perSkillEvidence,
      },
    },
  };
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  const { sessionId, goal, fixtureState } = buildFixture();
  log(`goal: ${goal}`);

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
        body: JSON.stringify({ sessions: [{ sessionId, goal }] }),
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
  await page.waitForTimeout(2000);

  // 逐页截：菜单项就是真实落地的页面列表
  const pages = (model.page?.pages ?? []).map(p => ({ id: p.id, name: p.name, kind: p.kind }));
  for (const p of pages) {
    const menu = page.locator(`[data-testid="app-runtime-menu-${p.id}"]`);
    if ((await menu.count()) === 0) {
      log(`skip ${p.id} — 菜单里没有这一项`);
      continue;
    }
    await menu.first().click();
    await page.waitForTimeout(2500);
    const stage = page.locator('[data-testid="app-runtime-screen"]').first();
    const file = join(outDir, `page-${p.id}.png`);
    await stage.screenshot({ path: file });
    const hasFreeform = (await page.locator('[data-testid="freeform-insight"]').count()) > 0;
    const trends = await page.locator('[data-testid="dataref-trend-delta"]').count();
    log(`page ${p.id} (${p.kind}) → ${file}  freeform=${hasFreeform} trend=${trends}`);
  }

  const full = join(outDir, "app-full.png");
  await page.screenshot({ path: full, fullPage: true });
  log(`full page: ${full}`);

  await browser.close();
  cleanup();
  log("done");
}

main().catch(e => fail(e?.stack || e));
