import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

import {
  collectSlideruleCommandSmokeEvidence,
  collectSliderulePageSmokeEvidence,
  collectSliderulePersistenceReplaySmokeEvidence,
  evaluateSlideruleCommandSmokeEvidence,
  evaluateSliderulePageSmokeEvidence,
  evaluateSliderulePersistenceReplaySmokeEvidence,
  evaluateSlideruleRuntimeSurfaceSmokeEvidence,
} from "../src/sliderulePageSmoke.js";

const args = new Set(process.argv.slice(2));
const requireLive = args.has("--require-live");
const submitCommand = args.has("--submit-command");
const requireRuntimeSurface = args.has("--require-runtime-surface");
const requirePersistenceReplay = args.has("--require-persistence-replay");
const baseUrl = (process.env.SLIDERULE_BROWSER_PROBE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const route = `${baseUrl}/agent-loop/sliderule`;

async function waitForServer(url, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status < 500) return true;
    } catch {
      // Keep polling until timeout.
    }
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
    } catch {
      // Try the next package shape.
    }
  }
  throw new Error("Playwright browser launcher not resolvable");
}

if (args.has("--help") || args.has("--list")) {
  console.log("sliderule-page-controls-smoke: Playwright smoke for /agent-loop/sliderule controls");
  console.log("  node agent-loop/scripts/sliderule-page-controls-smoke.mjs");
  console.log("  node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live");
  console.log("  node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command");
  console.log("  node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command --require-runtime-surface");
  console.log("  node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command --require-runtime-surface --require-persistence-replay");
  process.exit(0);
}

if (!(await waitForServer(baseUrl))) {
  const result = {
    ok: !requireLive,
    status: "degraded-skip",
    route,
    reason: `server not reachable at ${baseUrl}`,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  process.exit();
}

let browser;
try {
  const chromium = await resolveChromium();
  browser = await chromium.launch({
    headless: true,
    args: process.platform === "win32" ? ["--no-sandbox", "--disable-setuid-sandbox"] : ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('[data-testid="sliderule-root"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 10000 });

  const evidence = requirePersistenceReplay
    ? await collectSliderulePersistenceReplaySmokeEvidence(page)
    : submitCommand || requireRuntimeSurface
    ? await collectSlideruleCommandSmokeEvidence(page)
    : await collectSliderulePageSmokeEvidence(page);
  const result = {
    ...(requirePersistenceReplay
      ? evaluateSliderulePersistenceReplaySmokeEvidence(evidence)
      : requireRuntimeSurface
      ? evaluateSlideruleRuntimeSurfaceSmokeEvidence(evidence)
      : submitCommand
      ? evaluateSlideruleCommandSmokeEvidence(evidence)
      : evaluateSliderulePageSmokeEvidence(evidence)),
    route,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  await context.close();
} catch (error) {
  const result = {
    ok: false,
    status: "failed",
    route,
    reason: String(error?.message || error || "page smoke failed"),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
