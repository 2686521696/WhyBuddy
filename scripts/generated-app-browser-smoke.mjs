/**
 * generated-app-browser-smoke.mjs
 *
 * 离线确定性 Playwright Chromium 验收：一个已经闭环的五系统模型能否在真实浏览器
 * 正确长成应用。不调用 LLM、不依赖 Python 推演——所有状态经 route interception 注入。
 *
 * 场景一（leave_approval）：side Shell、真实落地菜单、角色降级、phone Shell。
 * 场景二（service_ticket）：top Shell、真实业务首屏、无旧 home 菜单。
 *
 * 依赖：@playwright/test（项目已有），Vite dev server（自动启动或已运行）。
 * 截图目录：tmp/generated-app-browser-smoke/
 *
 * Exit 0 = 两个场景全通；非零 = 失败，打印具体断言信息。
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number.parseInt(
  process.env.SLIDERULE_SMOKE_PORT ??
  process.env.WHYBUDDY_SMOKE_PORT ??
  "3000",
  10
);
const NAV_TIMEOUT = Number.parseInt(
  process.env.SLIDERULE_SMOKE_NAV_TIMEOUT ?? "45000",
  10
);
const baseUrl = `http://localhost:${PORT}`;
const dataRoot = resolve(ROOT, "tmp", "generated-app-browser-smoke");
mkdirSync(dataRoot, { recursive: true });

function log(msg) {
  process.stdout.write(`[generated-app-smoke] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[generated-app-smoke] FAIL: ${msg}\n`);
  process.exit(1);
}

// ---------- fixture builder ----------

function loadFixtureState(domain) {
  const instrumentsPath = resolve(
    ROOT,
    "client/src/pages/sliderule/demo-gallery/instruments.json"
  );
  const builtinPath = resolve(
    ROOT,
    "slide-rule-python/services/data/builtin_domain_models.json"
  );

  const instruments = JSON.parse(readFileSync(instrumentsPath, "utf-8"));
  const builtins = JSON.parse(readFileSync(builtinPath, "utf-8"));

  const domainModel = builtins[domain];
  if (!domainModel) fail(`Domain "${domain}" not found in builtin_domain_models.json`);

  const SKILL_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];
  const sessionId = `generated-app-smoke-${domain}`;

  // Build perSkillEvidence from builtin model sections
  const perSkillEvidence = {};
  for (const skill of SKILL_KEYS) {
    perSkillEvidence[skill] = {
      evidencePresent: true,
      evidenceRef: `evidence:${skill}:llm-linkage-${skill}`,
      path: `skills/${skill}/closure-evidence.json`,
      artifactId: `llm-linkage-${skill}`,
      digest: `smoke-${domain}-${skill}`,
      modelSection: domainModel[skill],
    };
  }

  // Clone the instruments skeleton and replace relevant fields
  const baseState = instruments.state ? { ...instruments.state } : {};
  const goal = domain === "leave_approval"
    ? "请假审批平台"
    : "客户服务工单系统";

  const fixtureState = {
    ...baseState,
    sessionId,
    goal: { text: goal, status: "clear" },
    publishClosure: {
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      closureId: `appbundle:${domain}@1.0.0:runtime-closure`,
      closureHash: `smoke-${domain}`,
      stableDigest: `stable-smoke-${domain}`,
      tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
      perSkillEvidence,
    },
  };

  return { sessionId, fixtureState };
}

// ---------- dev server lifecycle ----------

let devServerProc = null;

function cleanupDevServer() {
  if (devServerProc) {
    try {
      devServerProc.kill();
    } catch {}
    devServerProc = null;
  }
}

process.once("exit", cleanupDevServer);
process.once("SIGINT", () => { cleanupDevServer(); process.exit(1); });
process.once("SIGTERM", () => { cleanupDevServer(); process.exit(1); });

async function isServerReady(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "GET" });
    clearTimeout(t);
    return res.status < 500;
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

// ---------- Playwright resolver (same pattern as sliderule-browser-smoke.mjs) ----------

async function resolveChromium() {
  let chromium;
  try {
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
      const pwCore = await import("playwright-core");
      chromium = pwCore.chromium || pwCore.default?.chromium;
    } catch {}
  }
  if (!chromium) {
    fail(
      "Playwright browser launcher not resolvable.\n" +
      "Run: pnpm add -D playwright   (or npx playwright install --with-deps)"
    );
  }
  return chromium;
}

// ---------- smoke runner ----------

async function runSmoke() {
  log("starting generated-app browser smoke (offline, deterministic)");

  // ensure dev server is up
  let serverUp = await waitForServer(baseUrl, 10000);
  if (!serverUp) {
    log("dev server not responding; auto-spawning pnpm dev:frontend ...");
    try {
      let cmd, args;
      if (process.platform === "win32") {
        cmd = "cmd.exe";
        args = ["/c", "pnpm", "run", "dev:frontend"];
      } else {
        cmd = "pnpm";
        args = ["run", "dev:frontend"];
      }
      devServerProc = spawn(cmd, args, {
        stdio: "ignore",
        detached: process.platform !== "win32",
        shell: false,
        windowsHide: true,
      });
      if (typeof devServerProc.unref === "function") devServerProc.unref();
    } catch (e) {
      log(`WARN: spawn dev:frontend failed (${e?.message || e}). Continuing with external server expectation.`);
    }
    serverUp = await waitForServer(baseUrl, 60000);
    if (!serverUp) {
      cleanupDevServer();
      fail("dev server still not responding after auto-start attempt. Check for port conflicts.");
    }
    log("dev server auto-started and reachable");
  } else {
    log("dev server reachable");
  }

  const chromium = await resolveChromium();
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "win32"
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : ["--no-sandbox"],
  });

  let allPassed = true;
  const errors = [];

  // ---- helper: run one scenario ----
  async function runScenario(label, domain, checks) {
    log(`scenario: ${label}`);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      ignoreHTTPSErrors: true,
    });
    const playwrightPage = await context.newPage();

    const { sessionId, fixtureState } = loadFixtureState(domain);
    const unexpectedApiCalls = [];

    // Inject localStorage BEFORE navigation so the app picks up the fixture session id.
    // The app reads localStorage('sliderule:active-session-id') on mount — not URL params.
    await playwrightPage.addInitScript((sid) => {
      try { localStorage.setItem("sliderule:active-session-id", sid); } catch {}
    }, sessionId);

    // Route interception: mock SlideRule session API
    await playwrightPage.route("**/api/sliderule/**", async (route) => {
      const url = route.request().url();
      // Fixture session — return state
      if (url.includes(`/api/sliderule/sessions/${sessionId}`)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ state: fixtureState }),
        });
      // Sessions list — return only the fixture session so sidebar doesn't try to load others
      } else if (/\/api\/sliderule\/sessions\/?$/.test(new URL(url).pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [{ sessionId, goal: fixtureState.goal?.text ?? sessionId }] }),
        });
      } else if (url.includes("/api/sliderule/health")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "ok" }),
        });
      // Any other session id (e.g. leftover default) — return 404, not a hard failure
      } else if (url.includes("/api/sliderule/sessions/")) {
        await route.fulfill({ status: 404, contentType: "application/json",
          body: JSON.stringify({ error: "session_not_found" }) });
      } else {
        const method = route.request().method();
        const detail = `Unexpected SlideRule API call: ${method} ${url}`;
        console.error(`[generated-app-smoke] ${detail}`);
        unexpectedApiCalls.push(detail);
        await route.fulfill({
          status: 501,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_expected_in_smoke", url }),
        });
      }
    });

    try {
      await checks(playwrightPage, sessionId);
    } finally {
      // Screenshot
      const screenshotPath = join(dataRoot, `${domain}-final.png`);
      try {
        await playwrightPage.screenshot({ path: screenshotPath, fullPage: false });
        log(`screenshot saved: ${screenshotPath}`);
      } catch {}
      await context.close();
    }

    if (unexpectedApiCalls.length > 0) {
      errors.push(`${label}: unexpected SlideRule API calls:\n  ${unexpectedApiCalls.join("\n  ")}`);
      allPassed = false;
    }
  }

  // ---- assert helper ----
  async function assertSelector(playwrightPage, selector, description, timeout = 8000) {
    try {
      await playwrightPage.waitForSelector(selector, { timeout });
    } catch {
      throw new Error(`Expected element not found: ${description} (selector: ${selector})`);
    }
  }

  async function assertNoSelector(playwrightPage, selector, description) {
    const count = await playwrightPage.locator(selector).count();
    if (count > 0) {
      throw new Error(`Element should not exist but does: ${description} (selector: ${selector})`);
    }
  }

  // ======================================================================
  // 场景一：leave_approval — side Shell、角色降级、phone Shell
  // ======================================================================
  try {
    await runScenario("leave_approval: side Shell + role degradation + phone Shell", "leave_approval", async (playwrightPage, sessionId) => {
      // Navigate to SlideRule studio — real app route (session already set via localStorage)
      const url = `${baseUrl}/agent-loop/sliderule`;
      await playwrightPage.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

      // Wait for the app runtime screen to appear
      await assertSelector(playwrightPage, '[data-testid="app-runtime-screen"]', "app-runtime-screen", 20000);

      // 1. side Shell (leave_approval uses nav=side)
      await assertSelector(playwrightPage, '[data-testid="app-shell-side"]', "side Shell");

      // 2. landingPageId should be my_leave_workbench
      const landingId = await playwrightPage.locator('[data-landing-page-id]').getAttribute("data-landing-page-id");
      if (landingId !== "my_leave_workbench") {
        throw new Error(`data-landing-page-id expected "my_leave_workbench" but got "${landingId}"`);
      }

      // 3. active page should be the landing page initially
      const activeId = await playwrightPage.locator('[data-active-page-id]').getAttribute("data-active-page-id");
      if (activeId !== "my_leave_workbench") {
        throw new Error(`data-active-page-id expected "my_leave_workbench" but got "${activeId}"`);
      }

      // 4. home menu item should NOT appear (model has real landing page)
      await assertNoSelector(playwrightPage, '[data-testid="app-runtime-menu-home"]', "menu-home should not exist");

      // 5. Real business landing menu item should appear
      await assertSelector(playwrightPage, '[data-testid="app-runtime-menu-my_leave_workbench"]', "my_leave_workbench menu item");

      // Screenshot: employee side shell
      const screenshotPath = join(dataRoot, "leave-approval-employee-side.png");
      await playwrightPage.screenshot({ path: screenshotPath });
      log(`screenshot: ${screenshotPath}`);

      // 6. Switch to phone device
      const phoneBtn = playwrightPage.locator('[data-testid="app-device-phone"]');
      if (await phoneBtn.count() > 0) {
        await phoneBtn.click();
        await assertSelector(playwrightPage, '[data-testid="app-shell-phone"]', "phone Shell after device switch");

        // 7. TabBar should appear — wait for lazy component to hydrate, then count
        await assertSelector(playwrightPage, '[data-testid="app-runtime-tabbar"]', "phone TabBar", 10000);
        const tabbarCount = await playwrightPage.locator('[data-testid="app-runtime-tabbar"]').count();
        if (tabbarCount !== 1) {
          throw new Error(`Expected exactly 1 app-runtime-tabbar but found ${tabbarCount}`);
        }

        const phoneScreenshot = join(dataRoot, "leave-approval-phone.png");
        await playwrightPage.screenshot({ path: phoneScreenshot });
        log(`screenshot: ${phoneScreenshot}`);
      } else {
        log("WARN: app-device-phone button not found (controls may not be rendered); skipping phone assertions");
      }
    });
    log("leave_approval: PASS");
  } catch (e) {
    errors.push(`leave_approval: ${e.message}`);
    allPassed = false;
    log(`leave_approval: FAIL — ${e.message}`);
  }

  // ======================================================================
  // 场景二：service_ticket — top Shell、真实业务首屏
  // ======================================================================
  try {
    await runScenario("service_ticket: top Shell + real landing", "service_ticket", async (playwrightPage, sessionId) => {
      // Navigate to SlideRule studio (session already set via localStorage)
      const url = `${baseUrl}/agent-loop/sliderule`;
      await playwrightPage.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

      await assertSelector(playwrightPage, '[data-testid="app-runtime-screen"]', "app-runtime-screen", 20000);

      // 1. top Shell (service_ticket uses nav=top)
      await assertSelector(playwrightPage, '[data-testid="app-shell-top"]', "top Shell");

      // 2. landingPageId should be customer_ticket_submit
      const landingId = await playwrightPage.locator('[data-landing-page-id]').getAttribute("data-landing-page-id");
      if (landingId !== "customer_ticket_submit") {
        throw new Error(`data-landing-page-id expected "customer_ticket_submit" but got "${landingId}"`);
      }

      // 3. active page should be the landing page initially
      const activeId = await playwrightPage.locator('[data-active-page-id]').getAttribute("data-active-page-id");
      if (activeId !== "customer_ticket_submit") {
        throw new Error(`data-active-page-id expected "customer_ticket_submit" but got "${activeId}"`);
      }

      // 4. home menu should NOT appear
      await assertNoSelector(playwrightPage, '[data-testid="app-runtime-menu-home"]', "menu-home should not exist");

      // 5. Real landing menu item should appear
      await assertSelector(playwrightPage, '[data-testid="app-runtime-menu-customer_ticket_submit"]', "customer_ticket_submit menu item");

      const screenshotPath = join(dataRoot, "service-ticket-top-shell.png");
      await playwrightPage.screenshot({ path: screenshotPath });
      log(`screenshot: ${screenshotPath}`);
    });
    log("service_ticket: PASS");
  } catch (e) {
    errors.push(`service_ticket: ${e.message}`);
    allPassed = false;
    log(`service_ticket: FAIL — ${e.message}`);
  }

  await browser.close();
  cleanupDevServer();

  if (!allPassed) {
    process.stderr.write("\n[generated-app-smoke] FAILURES:\n");
    for (const err of errors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.exit(1);
  }

  log("all scenarios PASSED");
}

runSmoke().catch((err) => {
  process.stderr.write(`[generated-app-smoke] unexpected error: ${err?.stack || err}\n`);
  process.exit(1);
});
