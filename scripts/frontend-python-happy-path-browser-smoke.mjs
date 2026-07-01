import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Shared smoke harness (foundation task 08): exercises frontend paths and FAILS unless
// responses carry explicit Python provenance signals from slide-rule-python.
// This prevents silent success when a frontend flow is backed only by Node-only backend APIs.
// Python health + /api/sliderule/* submit responses must include "slide-rule-python" / "python-*" markers.
// Node side remains thin proxy only for PYTHON_FIRST_COMPAT surfaces; harness asserts the source.

const PORT = Number.parseInt(
  process.env.FRONTEND_PYTHON_HAPPY_PORT ?? process.env.SLIDERULE_SMOKE_PORT ?? "3000",
  10,
);
const baseUrl = `http://localhost:${PORT}`;
const appUrl = `${baseUrl}/agent-loop/sliderule`;
const dataRoot = resolve("tmp", "frontend-python-happy-path-browser-smoke");

mkdirSync(dataRoot, { recursive: true });

function log(message) {
  process.stdout.write(`[frontend-python-happy-smoke] ${message}\n`);
}

async function isServerReady(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return response.status < 500;
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

function hasPythonProvenance(value) {
  if (!value || typeof value !== "object") return false;
  const lower = (s) => String(s || "").toLowerCase();
  const backend = lower(value.backend);
  const source = lower(value.source);
  const provenance = lower(value.provenance);
  const text = JSON.stringify(value || {}).toLowerCase();
  // Explicit Python source signals only (backend/source/provenance fields).
  // Reject generic strings such as "v5 full" (see review: not a Python provenance marker;
  // Node-only responses must not pass even if they contain v5 text).
  return (
    backend.includes("slide-rule-python") ||
    backend === "python" ||
    source === "python" ||
    provenance.includes("python-") ||
    provenance.includes("slide-rule-python") ||
    text.includes("slide-rule-python") ||
    text.includes("python-rag") ||
    text.includes("python-fullpath") ||
    text.includes("python-llm")
  );
}

// Negative guard (per review finding): prove that Node-only / non-Python responses fail the provenance check.
// This ensures the harness will throw on frontend success backed by Node-only APIs.
const _nodeOnlySample = { status: "ok", backend: "express", source: "node", note: "v5 full compat" };
if (hasPythonProvenance(_nodeOnlySample)) {
  throw new Error("hasPythonProvenance must reject Node-only responses (even with 'v5 full')");
}
const _nonPythonSample = { status: "ok", backend: "node-compat", provenance: "legacy" };
if (hasPythonProvenance(_nonPythonSample)) {
  throw new Error("hasPythonProvenance must reject non-Python backends");
}

async function runSmoke() {
  log("starting frontend Python happy path browser smoke (Playwright)");
  log(`target: ${appUrl} (requires dev:all with Python service on 9700)`);

  if (!(await waitForServer(baseUrl, 8000))) {
    log("ERROR: no server responding on :3000. Start the full stack with `pnpm run dev:all`.");
    throw new Error("smoke requires dev:all with Python service; aborting to avoid false positive");
  }

  const chromium = await resolveChromium();
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "win32" ? ["--no-sandbox", "--disable-setuid-sandbox"] : ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const apiResponses = [];
  let submitResponse = null;
  let sawPythonProvenance = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(String(error.message || error));
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/sliderule/")) return;

    const entry = {
      url,
      method: response.request().method(),
      status: response.status(),
    };
    apiResponses.push(entry);

    if (entry.method !== "POST" && entry.method !== "PUT") return;
    if (entry.status >= 500) return;

    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json")) return;

    const json = await response.json().catch(() => null);
    if (!submitResponse) submitResponse = json;
    if (hasPythonProvenance(json)) sawPythonProvenance = true;
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 10000 });
  log("1. app shell loaded");

  const health = await page.evaluate(async () => {
    const response = await fetch("/api/sliderule/health");
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  });
  if (health.status !== 200 || !hasPythonProvenance(health.body)) {
    throw new Error(`Python health did not return healthy provenance: ${JSON.stringify(health).slice(0, 200)}`);
  }
  log("2. Python health is reachable through the frontend proxy");

  const input = page.locator('[data-testid="sliderule-composer-input"]');
  await input.fill("Build a simple RBAC permission system example for Python-first happy path verification.");
  const waitForPythonSubmit = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes("/api/sliderule/") && response.request().method() === "POST" && response.status() < 500;
  }, { timeout: 30000 }).catch(() => null);
  await input.press("Enter");
  const matched = await waitForPythonSubmit;
  await page.waitForTimeout(1200);
  log(`3. UI submit observed=${Boolean(matched)} apiResponses=${apiResponses.length} pythonProvenance=${sawPythonProvenance}`);

  await page.screenshot({ path: join(dataRoot, "happy-path-result.png"), fullPage: false }).catch(() => {});
  await context.close();
  await browser.close();

  const fatalErrors = consoleErrors.filter((line) => {
    if (/favicon|ResizeObserver|antd/i.test(line)) return false;
    if (/status of 401|Unauthorized/i.test(line)) return false;
    if (/status of 404|Not Found/i.test(line)) return false;
    return /uncaught|fatal|ReferenceError|TypeError|SyntaxError/i.test(line);
  });
  if (fatalErrors.length) {
    throw new Error(`fatal console errors during python happy path: ${fatalErrors.slice(0, 3).join(" | ")}`);
  }
  if (!matched) {
    throw new Error("UI submit did not produce a /api/sliderule POST response");
  }
  if (!sawPythonProvenance && !hasPythonProvenance(submitResponse)) {
    throw new Error("UI submit did not return Python-backed /api/sliderule provenance");
  }

  log("ALL happy path steps PASSED (load + Python health + UI submit + Python-backed result + no fatal errors).");
  log("Screenshots under tmp/frontend-python-happy-path-browser-smoke/");
}

runSmoke().catch((error) => {
  console.error("[frontend-python-happy-smoke] FAILED:", error?.message || error);
  process.exit(1);
});
