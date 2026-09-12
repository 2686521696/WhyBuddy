// Full product UI: no Playwright route fixtures and no component-only shell.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const report = { status: "running", stage: "launch", checks: [], pageErrors: [],
  observations: { auth: "real account cookie", api: "real Vite proxy to Python", bootstrapStatuses: [], hmrConnected: false } };
const persist = () => writeFile(join(config.directory, "browser-report.json"), JSON.stringify(report, null, 2));
const check = async (name, value) => {
  report.checks.push({ name, passed: Boolean(value) });
  await persist();
  if (!value) throw new Error(name);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
try {
  const chrome = process.env.SLIDERULE_CHROMIUM_PATH || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
  browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(({ sessionId, workbench }) => {
    if (location.origin === workbench) localStorage.setItem("sliderule:active-session-id", sessionId);
  }, { sessionId: config.sessionId, workbench: config.workbench });
  const login = await context.request.post(config.workbench + "/api/sliderule/account/login",
    { data: { email: config.ownerEmail, password: config.password } });
  await check("real browser account transport logs in", login.status() === 200);
  const page = await context.newPage();
  page.on("pageerror", error => { report.pageErrors.push({ name: error.name }); });
  const csp = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) csp.push("blocked");
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === config.previewOrigin && url.pathname === "/_whybuddy/authorize")
      report.observations.bootstrapStatuses.push({ status: response.status(), cleanRedirect: response.headers().location === "/" });
  });
  page.on("websocket", socket => {
    const url = new URL(socket.url());
    if (url.origin.replace(/^ws/, "http") !== config.previewOrigin) return;
    socket.on("framereceived", frame => {
      try { if (JSON.parse(String(frame.payload)).type === "connected") report.observations.hmrConnected = true; } catch { /* non-HMR */ }
    });
  });
  const fixture = async path => {
    const response = await context.request.post(config.authority + "/_smoke/" + path,
      { headers: { Authorization: "Bearer " + config.fixtureKey } });
    if (!response.ok()) throw new Error("trusted_fixture_http_" + response.status());
    return response.json();
  };
  async function openPreview(heading) {
    await page.getByTestId("sandbox-preview-surface").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-preview-open"]')?.disabled === false,
      undefined, { timeout: 60000 });
    await page.getByTestId("project-preview-open").click();
    const locator = page.frameLocator('[data-testid="project-preview-frame"]');
    await locator.getByRole("heading", { name: heading, exact: true }).waitFor({ timeout: 60000 });
    return locator;
  }
  report.stage = "studio";
  await persist();
  await page.goto(config.workbench + "/agent-loop/sliderule", { waitUntil: "domcontentloaded", timeout: 90000 });
  const frame = await openPreview("New Project");
  await check("full Studio uses the real project surface", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);
  await frame.getByRole("button", { name: "Increment count" }).click();
  await check("full Studio iframe handles actual React interaction", await frame.getByLabel("Count", { exact: true }).textContent() === "1");
  const appFrame = page.frames().find(value => value.url() === config.previewOrigin + "/");
  await check("real ticket exchange redirects to clean isolated origin", Boolean(appFrame) &&
    report.observations.bootstrapStatuses.some(item => item.status === 303 && item.cleanRedirect));
  const isolation = await appFrame.evaluate(() => {
    let denied = false;
    try { void parent.document.body; } catch { denied = true; }
    return { denied, cookie: document.cookie.includes("WhyBuddyPreview"), referrer: document.referrer };
  });
  await check("generated app cannot access host DOM or HttpOnly grant", isolation.denied && !isolation.cookie && isolation.referrer === "");
  await page.screenshot({ path: join(config.directory, "studio-before.png"), fullPage: true });

  // A real second administrator must still fail the project ownership boundary.
  const other = await browser.newContext();
  const otherLogin = await other.request.post(config.authority + "/api/sliderule/account/login",
    { data: { email: config.strangerEmail, password: config.password } });
  await check("second real account logs in independently", otherLogin.ok());
  const deniedTicket = await other.request.post(config.authority + `/api/sliderule/project-operations/${config.operationId}/preview-ticket`);
  await check("other administrator cannot obtain owner project ticket", deniedTicket.status() === 404);
  await other.close();

  // Keep an unused ticket to prove source changes revoke it in actual SQL.
  const oldTicketReply = await context.request.post(config.workbench + `/api/sliderule/project-operations/${config.operationId}/preview-ticket`);
  await check("owner can obtain a one-use revision ticket", oldTicketReply.ok());
  const oldTicket = await oldTicketReply.json();
  report.stage = "source_sync";
  await persist();
  const patch = await fixture("patch");
  await check("fixture edit reaches actual queued project tool", patch.ok && patch.kind === "runtime.patch");
  const deadline = Date.now() + 90000;
  let current;
  while (Date.now() < deadline) {
    const response = await context.request.get(config.workbench + `/api/sliderule/projects/${config.projectId}/preview`);
    current = response.ok() ? await response.json() : null;
    if (current?.available && current.descriptor?.revision !== config.initialRevision) break;
    await delay(500);
  }
  await check("real descriptor announces a new ready source revision", current?.available && current.descriptor?.status === "ready" && current.descriptor?.revision !== config.initialRevision);
  const stale = await context.request.get(oldTicket.entryUrl, { maxRedirects: 0 });
  await check("source synchronization revokes unused old revision ticket", stale.status() === 403);
  await page.getByTestId("project-preview-frame").waitFor({ state: "detached", timeout: 20000 });
  await check("Studio removes old authorized iframe after revision changes", await page.getByTestId("project-preview-frame").count() === 0);
  const revisedFrame = await openPreview("Integrated source update");
  await revisedFrame.getByRole("button", { name: "Increment count" }).click();
  await check("new revision remains interactive through the real gateway", await revisedFrame.getByLabel("Count", { exact: true }).textContent() === "1");
  await page.screenshot({ path: join(config.directory, "studio-after.png"), fullPage: true });
  report.stage = "refresh";
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await openPreview("Integrated source update");
  await check("whole workbench refresh restores current project from Python", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);

  report.stage = "apps_workbench";
  await persist();
  await page.goto(config.workbench + "/agent-loop/workbench", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Projects are private session artifacts. The market is the default shelf;
  // enter the real owner shelf before looking for this isolated fixture.
  await page.getByRole("button", { name: "我的应用", exact: true }).click();
  const card = page.getByTestId("app-cell-" + config.sessionId);
  await card.waitFor({ timeout: 60000 });
  await card.getByText("工程", { exact: true }).waitFor({ timeout: 60000 });
  await check("full AppsWorkbench loads actual project session card", await card.getByText("工程", { exact: true }).isVisible());
  await page.screenshot({ path: join(config.directory, "apps-project.png"), fullPage: true });
  await card.click();
  await openPreview("Integrated source update");
  await check("AppsWorkbench project card reopens the same current runtime", await page.getByTestId("sandbox-preview-surface").getAttribute("data-project-id") === config.projectId);
  report.observations.cspViolations = csp.length;
  await check("product browser has no uncaught JavaScript errors", report.pageErrors.length === 0);
  await check("Vite HMR WebSocket connects through authorized product preview", report.observations.hmrConnected);
  report.status = "passed";
  await context.close();
} catch (error) {
  report.status = "failed";
  // Playwright error strings can contain one-use URLs. Save assertion text only
  // for our own errors; otherwise retain class and stage, plus a screenshot.
  report.error = error.name === "Error" && !error.message.includes("\n") && !error.message.includes("http")
    ? error.message : error.name;
  const page = browser?.contexts()?.[0]?.pages()?.[0];
  if (page) {
    report.visibleText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
    await page.screenshot({ path: join(config.directory, "failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  await browser?.close();
  await persist();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, report: join(config.directory, "browser-report.json") }));
}
process.exitCode = report.status === "passed" ? 0 : 1;
