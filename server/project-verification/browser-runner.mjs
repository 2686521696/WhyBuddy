// Trusted, fixed-suite runner. Generated projects never supply executable code.
// Public Playwright APIs, reviewed against microsoft/playwright (Apache-2.0):
// packages/playwright/src/matchers/{matchers,toBeTruthy}.ts and
// packages/playwright-core/src/{server/frames,client/browserContext,client/tracing}.ts.
// MCP backend/verify.ts addAction records code; it is not our evidence gate.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

export const RUNNER_VERSION = "whybuddy-browser-v1:pw1.61.1";
export const SUITE_VERSION = "react-vite-counter@1";
export const ASSERTION_IDS = ["heading_visible", "counter_initial", "counter_increment",
  "counter_second_increment", "reload_reset", "no_page_errors", "no_failed_requests"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const require = createRequire(import.meta.url);
const allowedKeys = new Set(["verificationId", "revision", "suiteVersion", "scope", "entryUrl"]);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const failure = code => Object.assign(new Error(code), { safeCode: code });
const bound = (promise, ms) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(failure("project_browser_cleanup_pending")), ms);
  timer.unref();
  promise.finally(() => clearTimeout(timer)).catch(() => {});
})]);

export function validateInput(input, { allowLoopback = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !allowedKeys.has(key)) ||
      !identifier(input.verificationId) || !identifier(input.revision) || input.suiteVersion !== SUITE_VERSION ||
      !input.scope || Object.keys(input.scope).sort().join() !== "origin,projectId,runtimeId" ||
      !identifier(input.scope.projectId) || !identifier(input.scope.runtimeId) || typeof input.entryUrl !== "string" || input.entryUrl.length > 8192)
    throw failure("project_browser_input_invalid");
  let entry, origin;
  try { entry = new URL(input.entryUrl); origin = new URL(input.scope.origin); }
  catch { throw failure("project_browser_input_invalid"); }
  const loopback = allowLoopback && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (origin.origin !== input.scope.origin || origin.username || origin.password ||
      (origin.protocol !== "https:" && !(loopback && origin.protocol === "http:")) ||
      entry.origin !== origin.origin || entry.username || entry.password || entry.hash ||
      entry.pathname !== "/_whybuddy/authorize" || [...entry.searchParams.keys()].join() !== "ticket" ||
      !/^[A-Za-z0-9_-]{16,4096}$/.test(entry.searchParams.get("ticket") || ""))
    throw failure("project_browser_input_invalid");
  return input;
}

export async function runVerification(input, options = {}) {
  const report = { verificationId: identifier(input?.verificationId) ? input.verificationId : "invalid",
    revision: identifier(input?.revision) ? input.revision : "invalid", suiteVersion: SUITE_VERSION,
    runnerVersion: RUNNER_VERSION, status: "blocked", errorCode: null,
    assertions: [], artifacts: {}, cleanupConfirmed: false, revisionBefore: null, revisionAfter: null };
  let browser, context, page, timer, timedOut = false, observing = true;
  let pageErrors = 0, consoleErrors = 0, failedRequests = 0, blockedNavigation = false;
  const timeoutMs = options.timeoutMs ?? 60000;
  try {
    validateInput(input, options);
    if (require("@playwright/test/package.json").version !== "1.61.1") throw failure("project_browser_unavailable");
    const origin = input.scope.origin;
    const inScope = raw => { try { return new URL(raw).origin === origin; } catch { return false; } };
    browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...options.launchOptions });
    timer = setTimeout(() => { timedOut = true; browser.close().catch(() => {}); }, timeoutMs);
    context = await browser.newContext({ viewport: { width: 1280, height: 800 },
      serviceWorkers: "block", acceptDownloads: false, ignoreHTTPSErrors: false });
    context.setDefaultTimeout(options.assertionTimeoutMs ?? 5000);
    const verify = expect.configure({ timeout: options.assertionTimeoutMs ?? 5000 });
    context.setDefaultNavigationTimeout(15000);
    context.on("page", candidate => {
      if (!page) { page = candidate; return; }
      blockedNavigation = true;
      candidate.close().catch(() => {});
    });
    await context.route("**/*", async route => {
      const request = route.request();
      if (!inScope(request.url()) || request.redirectedFrom() ||
          (request.isNavigationRequest() && request.frame().page() !== page)) {
        blockedNavigation = true;
        await route.abort("blockedbyclient");
        return;
      }
      // Real Chrome regression: route.continue() follows a redirect without
      // invoking this handler again, so an external server was actually hit.
      // Fetch the real allowed upstream without redirects, then deliver that
      // response. No fixture response or generated assertion code is injected.
      let response;
      try {
        response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
        if (response.status() >= 300 && response.status() < 400 && response.status() !== 304) {
          blockedNavigation = true;
          await route.abort("blockedbyclient");
        } else await route.fulfill({ response });
      } catch { await route.abort("failed").catch(() => {}); }
      finally { await response?.dispose(); }
    });
    await context.routeWebSocket(/.*/, socket => {
      const httpUrl = socket.url().replace(/^ws:/, "http:").replace(/^wss:/, "https:");
      if (!inScope(httpUrl)) { blockedNavigation = true; socket.close(); }
      else socket.connectToServer();
    });

    // Exchange the one-use ticket without following redirects; never trace or
    // print its URL or the HttpOnly grant. APIRequestContext shares the cookie jar.
    const bootstrap = await context.request.get(input.entryUrl, { maxRedirects: 0, timeout: 15000 });
    if (bootstrap.status() !== 303 || bootstrap.headers().location !== "/") throw failure("project_browser_auth_failed");
    await bootstrap.dispose();
    const marker = async () => {
      const response = await context.request.get(origin + "/__whybuddy_revision.json", { maxRedirects: 0, timeout: 5000 });
      try {
        const body = await response.body();
        if (response.status() !== 200 || body.length > 4096) throw failure("project_browser_revision_mismatch");
        let value;
        try { value = JSON.parse(body.toString("utf8")); } catch { throw failure("project_browser_revision_mismatch"); }
        if (value.revision !== input.revision) throw failure("project_browser_revision_mismatch");
        return value.revision;
      } finally { await response.dispose(); }
    };
    report.revisionBefore = await marker();
    page = await context.newPage();
    page.on("pageerror", () => { if (observing) pageErrors++; });
    page.on("console", message => { if (observing && message.type() === "error") consoleErrors++; });
    page.on("requestfailed", () => { if (observing) failedRequests++; });
    page.on("response", response => { if (observing && response.status() >= 400) failedRequests++; });
    page.on("dialog", dialog => { blockedNavigation = true; dialog.dismiss().catch(() => {}); });
    const document = await page.goto(origin + "/", { waitUntil: "load" });
    if (!document || document.status() !== 200 || page.url() !== origin + "/") throw failure("project_browser_navigation_blocked");
    const assertion = async (id, execute, expected) => {
      try { await execute(); report.assertions.push({ id, status: "passed" }); }
      catch {
        const failed = { id, status: "failed" };
        if (expected !== undefined) {
          failed.expected = expected;
          failed.actual = "unexpected_value";
          try {
            const value = await count.evaluate(element => (element.textContent || "").slice(0, 18),
              undefined, { timeout: 1000 });
            // Recheck in trusted Node, even if the page changes its own JS
            // prototypes. Arbitrary DOM text and URLs never enter the receipt.
            if (typeof value === "string" && /^-?[0-9]{1,16}$/.test(value)) failed.actual = value;
          } catch { /* A missing/ambiguous counter is the same bounded sentinel. */ }
        }
        report.assertions.push(failed);
      }
    };
    const screenshot = async name => {
      const bytes = await page.screenshot({ type: "png", fullPage: false, timeout: 5000 });
      if (bytes.length > MAX_IMAGE_BYTES) throw failure("project_browser_artifact_too_large");
      report.artifacts[name] = bytes.toString("base64");
    };
    const count = page.getByLabel("Count", { exact: true });
    const increment = page.getByRole("button", { name: "Increment count", exact: true });
    await assertion("heading_visible", async () => {
      const heading = page.getByRole("heading", { level: 1 });
      await verify(heading).toHaveCount(1);
      await verify(heading).toBeVisible();
      await verify(heading).toHaveText(/\S/);
    });
    await assertion("counter_initial", () => verify(count).toHaveText("0"), "0");
    await screenshot("before.png");
    await assertion("counter_increment", async () => { await increment.click(); await verify(count).toHaveText("1"); }, "1");
    await assertion("counter_second_increment", async () => { await increment.click(); await verify(count).toHaveText("2"); }, "2");
    await screenshot("after.png");
    await assertion("reload_reset", async () => {
      await page.reload({ waitUntil: "load" });
      await verify(count).toHaveText("0");
    }, "0");
    report.revisionAfter = await marker();
    await assertion("no_page_errors", () => expect(pageErrors + consoleErrors).toBe(0));
    await assertion("no_failed_requests", () => expect(failedRequests).toBe(0));
    if (blockedNavigation) throw failure("project_browser_navigation_blocked");
    report.status = report.assertions.every(item => item.status === "passed") ? "passed" : "failed";
    report.errorCode = report.status === "failed" ? "project_browser_assertion_failed" : null;
  } catch (error) {
    report.status = report.assertions.some(item => item.status === "failed") ? "failed" : "blocked";
    report.errorCode = timedOut ? "project_browser_timeout" :
      blockedNavigation ? "project_browser_navigation_blocked" : error.safeCode || "project_browser_unavailable";
  } finally {
    observing = false;
    if (timer) clearTimeout(timer);
    let clean = true;
    if (context) try { await bound(context.close({ reason: "verification_complete" }), 3000); } catch { clean = false; }
    if (browser) try { await bound(browser.close(), 3000); } catch { clean = false; }
    report.cleanupConfirmed = clean;
    if (!clean) { report.status = "blocked"; report.errorCode = "project_browser_cleanup_pending"; }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    const raw = await readFile(process.argv[2]);
    if (raw.length > 16384) throw failure("project_browser_input_invalid");
    const localTest = process.argv.includes("--local-test");
    result = await runVerification(JSON.parse(raw), { allowLoopback: localTest,
      ...(localTest && process.env.SLIDERULE_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.SLIDERULE_CHROMIUM_PATH } } : {}) });
  } catch {
    result = { status: "blocked", errorCode: "project_browser_input_invalid", runnerVersion: RUNNER_VERSION,
      assertions: [], artifacts: {}, cleanupConfirmed: true };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}
