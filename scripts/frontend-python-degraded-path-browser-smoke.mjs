import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number.parseInt(process.env.FRONTEND_PYTHON_DEGRADED_PORT ?? process.env.SLIDERULE_SMOKE_PORT ?? "3000", 10);
const baseUrl = `http://localhost:${PORT}`;
const dataRoot = resolve("tmp", "frontend-python-degraded-path-browser-smoke");

mkdirSync(dataRoot, { recursive: true });

function log(msg) {
  process.stdout.write(`[frontend-python-degraded-smoke] ${msg}\n`);
}

async function isServerReady(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "GET" });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function waitForServer(url, totalTimeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < totalTimeoutMs) {
    if (await isServerReady(url)) return true;
    await sleep(350);
  }
  return false;
}

let devServerProc = null;

function cleanupDevServer() {
  if (!devServerProc) return;
  try {
    devServerProc.kill(process.platform === "win32" ? undefined : "SIGTERM");
  } catch {}
  devServerProc = null;
}

process.once("exit", cleanupDevServer);
process.once("SIGINT", () => {
  cleanupDevServer();
  process.exit(1);
});
process.once("SIGTERM", () => {
  cleanupDevServer();
  process.exit(1);
});

async function resolveChromium() {
  for (const mod of ["@playwright/test", "playwright", "playwright-core"]) {
    try {
      const imported = await import(mod);
      const chromium = imported.chromium || imported.default?.chromium;
      if (chromium) return chromium;
    } catch {}
  }
  throw new Error("Playwright browser launcher not resolvable. Install playwright or run in the repo dev environment.");
}

async function ensureServer() {
  let ready = await waitForServer(baseUrl, 8000);
  if (ready) return;

  log("dev server not responding; auto-spawning `pnpm dev:frontend` for hermetic degraded smoke");
  const cmd = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = process.platform === "win32" ? ["/c", "pnpm", "run", "dev:frontend"] : ["run", "dev:frontend"];
  devServerProc = spawn(cmd, args, {
    stdio: "ignore",
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true,
  });
  devServerProc.unref?.();

  ready = await waitForServer(baseUrl, 60000);
  if (!ready) {
    cleanupDevServer();
    throw new Error("dev frontend did not become ready for degraded smoke");
  }
}

async function runSmoke() {
  log("starting Python degraded path browser smoke");
  await ensureServer();

  const chromium = await resolveChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  let degradedHealthIntercepted = false;

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.route("**/api/sliderule/health", async (route) => {
    degradedHealthIntercepted = true;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        degraded: true,
        status: "degraded",
        source: "python",
        reason: "forced degraded smoke",
        message: "Python backend forced degraded for browser smoke",
      }),
    });
  });

  await page.goto(`${baseUrl}/agent-loop/sliderule`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("text=Python backend", { timeout: 10000 });
  await page.waitForSelector("text=/degraded|503|fallback active|Retry/i", { timeout: 10000 });

  const bodyText = await page.locator("body").innerText({ timeout: 3000 });
  const screenshotPath = resolve(dataRoot, "degraded-path.png");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await browser.close();

  if (!degradedHealthIntercepted) {
    throw new Error("degraded smoke did not intercept /api/sliderule/health");
  }
  if (!/Python backend/i.test(bodyText) || !/degraded|503|Retry/i.test(bodyText)) {
    throw new Error("UI did not show visible Python degraded state");
  }
  const fatalErrors = consoleErrors.filter((line) => {
    if (/favicon|ResizeObserver|antd/i.test(line)) return false;
    if (/status of 503|Service Unavailable/i.test(line)) return false;
    if (/status of 404|Not Found/i.test(line)) return false;
    return true;
  });
  if (fatalErrors.length) {
    throw new Error(`fatal console errors during degraded smoke: ${fatalErrors.slice(0, 3).join(" | ")}`);
  }

  log(`PASS: visible degraded UI verified; screenshot=${screenshotPath}`);
}

runSmoke().catch((err) => {
  console.error("[frontend-python-degraded-smoke] FAILED:", err?.message || err);
  cleanupDevServer();
  process.exit(1);
});
