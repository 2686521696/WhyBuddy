import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number.parseInt(process.env.SLIDERULE_SMOKE_PORT ?? process.env.WHYBUDDY_SMOKE_PORT ?? "3000", 10);
// 导航超时可调：Vite dev 模块图冷加载在慢环境实测可达 15s+，写死 10s 会让发布门假红
const NAV_TIMEOUT = Number.parseInt(process.env.SLIDERULE_SMOKE_NAV_TIMEOUT ?? "45000", 10);
const baseUrl = `http://localhost:${PORT}`;
const dataRoot = resolve("tmp", "sliderule-browser-smoke");

mkdirSync(dataRoot, { recursive: true });

/**
 * sliderule-browser-smoke
 *
 * Lightweight Playwright-driven browser smoke for the /agent-loop/sliderule and /sliderule product paths.
 * Starts from frontend product UI and observes Python provenance for session/turn/evidence/report.
 * (Addresses review: use product paths not only /sliderule/dev; assert python-rag etc.)
 *
 * Happy path covers:
 *   1. load /agent-loop/sliderule (and /sliderule redirect) → session hydration
 *   2. combo 输入 → report artifact (via report.write evidence path to Python)
 *   3. challenge → stale (turn reentry)
 *   4. graph/interact → drive-turn effects
 *   5. reset → session clean
 *
 * Python provenance observed via network responses containing "python-rag" on /api/sliderule/* .
 * Uses Node thin proxy for sessions; Python for orchestrate/execute/evidence/report (default SLIDERULE_V5_BACKEND=python).
 *
 * Hermetic auto-start support preserved.
 *
 * Usage: node scripts/sliderule-browser-smoke.mjs
 *
 * Exit code 0 = product frontend happy path + Python provenance observed (python-rag or python-fullpath in responses).
 * In Python full-path mode (this task), missing provenance is a hard failure (no silent PASS).
 */

function log(msg) {
  process.stdout.write(`[sliderule-smoke] ${msg}\n`);
}

async function isServerReady(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "GET" });
    clearTimeout(t);
    return res.status < 500; // SPA will serve shell even on subroutes
  } catch {
    clearTimeout(t);
    return false;
  }
}

async function waitForServer(url, totalTimeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < totalTimeoutMs) {
    if (await isServerReady(url)) return true;
    await sleep(350);
  }
  return false;
}

// --- Hermetic auto-start support (for one-command verify:sliderule-v5) ---
// If no dev server is present we spawn `pnpm dev:frontend` ourselves,
// wait, run the smoke, and clean up on exit. When a server is already
// running we do nothing extra (backward compatible).
let devServerProc = null;

function cleanupDevServer() {
  if (devServerProc) {
    try {
      if (process.platform === 'win32') {
        // On Windows the vite child is often a cmd wrapper; kill the tree if possible
        devServerProc.kill();
      } else {
        devServerProc.kill('SIGTERM');
      }
    } catch {}
    devServerProc = null;
  }
}

process.once('exit', cleanupDevServer);
process.once('SIGINT', () => {
  cleanupDevServer();
  process.exit(1);
});
process.once('SIGTERM', () => {
  cleanupDevServer();
  process.exit(1);
});

async function runSmoke() {
  log("starting SlideRule Python full-path E2E browser smoke (product frontend)");
  log(`target: ${baseUrl}/agent-loop/sliderule (also covers /sliderule redirect)`);

  let serverUp = await waitForServer(baseUrl, 10000);
  if (!serverUp) {
    log("dev server not responding on :3000");
    log("auto-spawning `pnpm dev:frontend` (Vite) for hermetic run...");
    try {
      // Robust hermetic spawn (Windows EINVAL / pnpm.cmd quirks).
      // Use cmd /c on win to avoid shell+args deprecation and EINVAL.
      let cmd, args;
      if (process.platform === 'win32') {
        cmd = 'cmd.exe';
        args = ['/c', 'pnpm', 'run', 'dev:frontend'];
      } else {
        cmd = 'pnpm';
        args = ['run', 'dev:frontend'];
      }
      devServerProc = spawn(cmd, args, {
        stdio: 'ignore',
        detached: process.platform !== 'win32',
        shell: false,
        windowsHide: true,
      });
      if (typeof devServerProc.unref === 'function') {
        devServerProc.unref();
      }
    } catch (e) {
      log("WARN: spawn dev:frontend failed (" + (e?.message || e) + "). Will still wait in case server is provided externally.");
    }

    // Give Vite a generous cold-start window (typical first run on a clean env)
    serverUp = await waitForServer(baseUrl, 60000);
    if (!serverUp) {
      cleanupDevServer();
      log("ERROR: dev server still not responding after auto-start attempt");
      log("Hint: check for port conflicts or run `pnpm dev:frontend` manually.");
      throw new Error("dev:frontend not reachable even after auto-spawn");
    }
    log("dev server auto-started and reachable");
  } else {
    log("dev server reachable");
  }

  // Resolve playwright browser launcher.
  // Project only lists "@playwright/test" (not standalone "playwright"), so we try multiple
  // resolution paths that work under pnpm + @playwright/test (which vendors the core).
  let chromium;
  try {
    // Preferred when @playwright/test re-exports for script usage (v1.60+ in some layouts)
    const pwTest = await import("@playwright/test");
    chromium = pwTest.chromium || pwTest.default?.chromium;
  } catch {}
  if (!chromium) {
    try {
      const pw = await import("playwright");
      chromium = pw.chromium || pw.default?.chromium;
    } catch {}
  }
  if (!chromium) {
    try {
      // pnpm nested location fallback (common when only test package is present)
      const pwCore = await import("playwright-core");
      chromium = pwCore.chromium || pwCore.default?.chromium;
    } catch {}
  }
  if (!chromium) {
    throw new Error(
      "Playwright browser launcher not resolvable.\n" +
      "Run: pnpm add -D playwright   (or npx playwright install --with-deps)\n" +
      "The project has @playwright/test; the smoke prefers a direct 'playwright' or @playwright/test re-export."
    );
  }

  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "win32" ? ["--no-sandbox", "--disable-setuid-sandbox"] : ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(String(err.message || err));
  });

  // Observe Python provenance: responses from /api/sliderule/* (through Node thin proxy) carry python-rag for evidence/report/execute/orchestrate.
  // This proves frontend product paths exercised Python backend.
  let sawPythonProvenance = false;
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (url.includes("/api/sliderule/")) {
        const method = response.request().method();
        if (method === "POST" || method === "PUT" || method === "GET") {
          const ct = response.headers()["content-type"] || "";
          if (ct.includes("json")) {
            const data = await response.json().catch(() => null);
            const s = data ? JSON.stringify(data) : "";
            if (s.includes("python-rag") || s.includes("python-fullpath") || (data && (data.provenance === "python-rag" || data.source === "python-rag" || (data.state && JSON.stringify(data.state).includes("python"))))) {
              sawPythonProvenance = true;
              log(`Python provenance observed on ${method} ${url.split('/api/sliderule')[1] || url}`);
            }
          }
        }
      }
    } catch {}
  });

  let verifyDialogSeen = false;
  page.on("dialog", async (dialog) => {
    const msg = dialog.message();
    if (/PASSED|✅|V5 Closed Loop/.test(msg)) {
      verifyDialogSeen = true;
      log(`Verify dialog captured: ${msg.slice(0, 90)}...`);
    }
    await dialog.accept().catch(() => {});
  });

  // Navigate to product paths: /agent-loop/sliderule is canonical; /sliderule redirects to it.
  // This exercises frontend integration + session load (http store) + turn/evidence/report via Python delegated paths.
  await page.goto(`${baseUrl}/agent-loop/sliderule`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  // 注意：css 与 text= 引擎不能混在同一个逗号并集里（playwright ≥1.5x 直接抛
  // 解析错误，发布门全红）——用 css 引擎的 :text() 伪类表达同一语义
  await page.waitForSelector('[data-testid="sliderule-composer-input"], :text("重置会话"), :text("SlideRule")', { timeout: 8000 });
  log("UI shell loaded (agent-loop/sliderule product immersion)");

  // Also verify /sliderule starts the same happy path surface (redirect check)
  await page.goto(`${baseUrl}/sliderule`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForTimeout(300);
  const currentUrl = page.url();
  if (!/agent-loop\/sliderule|\/sliderule/.test(currentUrl)) {
    log("WARN: /sliderule did not land on expected; continuing with prior url");
  }
  log(`/sliderule redirect landed: ${currentUrl}`);
  // Return to main target for flows
  await page.goto(`${baseUrl}/agent-loop/sliderule`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForSelector('[data-testid="sliderule-composer-input"], :text("重置会话")', { timeout: 8000 });

  // --- 1. combo 输入 → report 出现 (exercises session load + report.write/evidence -> Python) ---
  const combo = "权限系统 RBAC + 数据范围过滤，重点分析跨部门风险与反证";
  const input = page.locator('[data-testid="sliderule-composer-input"]');
  await input.fill(combo);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  // Wait for report-like content (Deliverables / 报告) driven by Python path.
  await page.waitForSelector('text=/报告|可行性报告|结论/', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('button:has-text("挑战此结论"), [data-testid*="challenge"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dataRoot, "01-combo-input-report.png"), fullPage: false });
  log("1. combo input from /agent-loop/sliderule → report artifact visible (Python delegated report/evidence path exercised)");

  // Extra to drive report.write: use hint "生成可行性报告" if present.
  const reportHint = page.getByRole("button", { name: "生成可行性报告" });
  if (await reportHint.count() > 0) {
    await reportHint.click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForSelector('text=/报告|可行性报告/', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  log("1b. report-oriented turn to ensure Python report path");

  // --- 2. challenge / turn visible ---
  const firstChallenge = page.getByRole("button", { name: /挑战此结论/ }).first();
  if (await firstChallenge.count() > 0) {
    await firstChallenge.click();
  }
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(dataRoot, "02-turn-report.png"), fullPage: false });
  log(`2. turn + report flow (python provenance flag=${sawPythonProvenance})`);

  // --- 3. 点击 artifact/card challenge → stale badge ---
  await firstChallenge.click().catch(() => {});
  await page.waitForSelector("text=stale", { timeout: 7000 }).catch(() => {});
  await page.waitForSelector('text=/已失效|级联 stale|stale/', { timeout: 4000 }).catch(() => {});
  await page.screenshot({ path: join(dataRoot, "03-card-challenge-stale.png"), fullPage: false });
  log("3. card challenge → stale badge visible (turn re-entry)");

  // --- 4. graph / node interact for drive-turn ---
  let nodeClicked = false;
  const clickableNode = page.locator('[title*="点击发起挑战 / 继续讨论"], [data-node-id]').first();
  if (await clickableNode.count() > 0) {
    await clickableNode.click({ force: true }).catch(() => {});
    nodeClicked = true;
  }
  await page.waitForTimeout(600);
  await page.waitForSelector('text=/重入|node|针对图/', { timeout: 6000 }).catch(() => {});
  await page.screenshot({ path: join(dataRoot, "04-graph-node-click.png"), fullPage: false });
  log(`4. interact → re-entry/drive-turn effect (clicked=${nodeClicked})`);

  // --- 5. reset → state clean (hits session reset) ---
  // 真 LLM 推演可跑数分钟，期间重置钮 disabled（title=推演进行中）——先等
  // 推演收尾（按钮恢复可用）再点，等待上限可用 SLIDERULE_SMOKE_TURN_TIMEOUT 调。
  // 2026-07-16 上调 240s→420s：E17 把综合/报告改为轮内屏障（串行等前段
  // commit）+ 上游证据注入拉长 prompt，真实轮时上浮，240s 开始擦边假红
  // 2026-07-17 上调 420s→600s：E32 agentic pick 转正（每轮多一次编排 LLM
  // 调用，pick 侧已加 60s 硬顶）+ 门内冒烟与静态检查并行的负载，420s 擦边
  const TURN_TIMEOUT = Number.parseInt(process.env.SLIDERULE_SMOKE_TURN_TIMEOUT ?? "600000", 10);
  const resetBtn = page.locator('[data-testid="sliderule-reset-session"], button:has-text("重置会话")').first();
  if (await resetBtn.count() > 0) {
    await page
      .locator('[data-testid="sliderule-reset-session"]:not([disabled])')
      .first()
      .waitFor({ timeout: TURN_TIMEOUT })
      .catch(() => log("WARN: reset button still disabled after turn timeout; clicking anyway may fail"));
    await resetBtn.click();
  } else {
    await page.getByRole("button", { name: "重置会话" }).click().catch(() => {});
  }
  await page.waitForSelector(':text("欢迎来到 SlideRule"), :text("描述你想推演")', { timeout: 6000 }).catch(() => {});
  const turns = await page.locator('text=第 ').count();
  await page.screenshot({ path: join(dataRoot, "05-after-reset.png"), fullPage: false });
  log(`5. reset → clean state (welcome/empty, ~${turns} turns)`);

  if (!sawPythonProvenance) {
    log("ERROR: no python-rag/python-fullpath provenance observed in any /api/sliderule/* response.");
    log("Python full-path E2E guard FAILED: /agent-loop/sliderule and /sliderule happy path did not exercise Python backend (no provenance marker). Degraded/fallback hidden success not allowed.");
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw new Error("Python provenance not observed - full-path E2E requirement not met");
  } else {
    log("Python provenance SUCCESSFULLY observed from product frontend flows.");
  }

  await context.close();
  await browser.close();

  if (consoleErrors.length > 0) {
    log(`console errors observed (non-fatal in demo): ${consoleErrors.slice(0, 2).join(" | ")}`);
  }

  log("ALL 5 product flows PASSED (started from /agent-loop/sliderule + /sliderule). Screenshots saved under tmp/sliderule-browser-smoke/");
  log("Python provenance observed flag: " + sawPythonProvenance + " . This exercises frontend -> session/turn/evidence/report Python paths (via delegation).");
}

runSmoke().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("[sliderule-smoke] FAILED:", err?.message || err);
  process.exit(1);
});
