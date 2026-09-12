// Trusted, fixed-suite runner. Generated projects never supply executable code.
// Public Playwright APIs, reviewed against microsoft/playwright (Apache-2.0):
// packages/playwright/src/matchers/{matchers,toBeTruthy}.ts and
// packages/playwright-core/src/{server/frames,client/browserContext,client/tracing}.ts.
// MCP backend/verify.ts addAction records code; it is not our evidence gate.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";

export const RUNNER_VERSION = "whybuddy-browser-v1:pw1.61.1";
export const SUITE_VERSION = "react-vite-counter@1";
export const TASK_SUITE_VERSION = "react-vite-tasks@1";
export const TASK_ASSERTION_IDS = ["setup_admin", "writer_login", "task_create", "task_edit", "task_filter",
  "task_refresh", "reader_create", "reader_login", "reader_ui_readonly", "reader_api_forbidden",
  "anonymous_api_forbidden", "no_page_errors", "no_failed_requests"];
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
      !identifier(input.verificationId) || !identifier(input.revision) || ![SUITE_VERSION, TASK_SUITE_VERSION].includes(input.suiteVersion) ||
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
    revision: identifier(input?.revision) ? input.revision : "invalid", suiteVersion: input?.suiteVersion === TASK_SUITE_VERSION ? TASK_SUITE_VERSION : SUITE_VERSION,
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
    if (input.suiteVersion === TASK_SUITE_VERSION) {
      await runTaskSuite({ page, context, verify, assertion, screenshot, origin });
    } else {
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
    }
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

async function runTaskSuite({ page, context, verify, assertion, screenshot, origin }) {
  // Credentials are generated by the trusted runner for this isolated empty
  // verification database. They are never input from a project or in receipts.
  const writer = { username: "writer_browser", password: "Writer!" + randomBytes(20).toString("hex") };
  const reader = { username: "reader_browser", password: "Reader!" + randomBytes(20).toString("hex") };
  const title = "浏览器验收任务", edited = "浏览器验收任务已编辑";
  let taskId;
  const login = async account => {
    await page.getByLabel("用户名", { exact: true }).fill(account.username);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await verify(page.getByLabel("当前用户", { exact: true })).toHaveText(account.username);
  };
  const api = async (path, options = {}) => {
    const response = await context.request.fetch(origin + path, { maxRedirects: 0, timeout: 5000, ...options });
    try { return { status: response.status(), body: await response.json() }; } finally { await response.dispose(); }
  };
  await assertion("setup_admin", async () => {
    await verify(page.getByRole("heading", { name: "创建管理员", exact: true })).toBeVisible();
    await page.getByLabel("用户名", { exact: true }).fill(writer.username);
    await page.getByLabel("密码", { exact: true }).fill(writer.password);
    await page.getByRole("button", { name: "创建并登录", exact: true }).click();
    await verify(page.getByRole("heading", { name: "任务清单", exact: true })).toBeVisible();
  });
  await assertion("writer_login", async () => {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await login(writer);
    const session = await api("/api/auth/session");
    expect(session.status).toBe(200); expect(session.body.user.role).toBe("writer");
  });
  await assertion("task_create", async () => {
    await page.getByLabel("任务标题", { exact: true }).fill(title);
    await page.getByRole("button", { name: "新增任务", exact: true }).click();
    await verify(page.getByRole("article", { name: title, exact: true })).toBeVisible();
    const saved = await api("/api/tasks");
    expect(saved.status).toBe(200);
    const task = saved.body.tasks.find(item => item.title === title);
    expect(task?.status).toBe("open");
    if (!/^[0-9a-f-]{36}$/.test(task?.id || "")) throw failure("project_browser_task_identity_invalid");
    taskId = task.id;
  });
  await screenshot("tasks-created.png");
  await assertion("task_edit", async () => {
    await page.getByRole("button", { name: "编辑任务 " + title, exact: true }).click();
    await page.getByLabel("编辑标题", { exact: true }).fill(edited);
    await page.getByLabel("编辑状态", { exact: true }).selectOption("done");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await verify(page.getByRole("article", { name: edited, exact: true })).toContainText("已完成");
    const saved = await api("/api/tasks");
    const task = saved.body.tasks.find(item => item.id === taskId);
    expect(task?.title).toBe(edited); expect(task?.status).toBe("done");
  });
  await assertion("task_filter", async () => {
    await page.getByLabel("筛选状态", { exact: true }).selectOption("open");
    await verify(page.getByRole("article", { name: edited, exact: true })).toHaveCount(0);
    await page.getByLabel("筛选状态", { exact: true }).selectOption("done");
    await verify(page.getByRole("article", { name: edited, exact: true })).toBeVisible();
    await page.getByLabel("搜索任务", { exact: true }).fill("不存在的任务");
    await verify(page.getByRole("article", { name: edited, exact: true })).toHaveCount(0);
    await page.getByLabel("搜索任务", { exact: true }).fill(edited);
    await verify(page.getByRole("article", { name: edited, exact: true })).toBeVisible();
  });
  await assertion("task_refresh", async () => {
    await page.reload({ waitUntil: "load" });
    await verify(page.getByRole("article", { name: edited, exact: true })).toContainText("已完成");
    const saved = await api("/api/tasks");
    expect(saved.body.tasks.find(item => item.id === taskId)?.title).toBe(edited);
  });
  await assertion("reader_create", async () => {
    await page.getByText("新增只读成员", { exact: true }).click();
    await page.getByLabel("只读用户名", { exact: true }).fill(reader.username);
    await page.getByLabel("只读密码", { exact: true }).fill(reader.password);
    await page.getByRole("button", { name: "创建只读成员", exact: true }).click();
    await verify(page.getByRole("status")).toHaveText("只读成员已创建");
  });
  await assertion("reader_login", async () => {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await login(reader);
    const session = await api("/api/auth/session");
    expect(session.body.user.role).toBe("reader");
    await verify(page.getByRole("article", { name: edited, exact: true })).toBeVisible();
  });
  await assertion("reader_ui_readonly", async () => {
    await verify(page.getByRole("button", { name: "新增任务", exact: true })).toHaveCount(0);
    await verify(page.getByRole("button", { name: /^编辑任务 / })).toHaveCount(0);
    await verify(page.getByText("新增只读成员", { exact: true })).toHaveCount(0);
    await page.getByLabel("筛选状态", { exact: true }).selectOption("done");
    await verify(page.getByRole("article", { name: edited, exact: true })).toBeVisible();
  });
  await assertion("reader_api_forbidden", async () => {
    expect((await api("/api/tasks", { method: "POST", data: { title: "unauthorized task", role: "writer" } })).status).toBe(403);
    expect((await api("/api/tasks/" + taskId, { method: "PATCH", data: { title: "unauthorized change", status: "open" } })).status).toBe(403);
    expect((await api("/api/users", { method: "POST", data: { username: "injected", password: "InvalidUser!2026", role: "writer" } })).status).toBe(403);
    const saved = await api("/api/tasks");
    expect(saved.body.tasks).toHaveLength(1); expect(saved.body.tasks[0].title).toBe(edited);
  });
  await screenshot("tasks-reader.png");
  await assertion("anonymous_api_forbidden", async () => {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await verify(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
    expect((await api("/api/tasks")).status).toBe(401);
    expect((await api("/api/tasks", { method: "POST", data: { title: "unauthorized task" } })).status).toBe(401);
  });
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
