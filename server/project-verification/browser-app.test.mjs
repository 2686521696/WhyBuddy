// 普通网页套件（react-vite-app@1）：真 Chrome、本机 HTTP 夹具、产线 runner。
//
// ⚠ 2026-09-25 隔离真机 sr-20260925025649-74E9KCWHAB（记账网页）：通用模板的
//   工程只能跑计数器套件，而计数器是模板 demo——模型把 App 换成记账页之后
//   那套必然红，普通网页没有任何一条能通过的独立证据。第一条用例先证明
//   「同一页记账页，计数器套件确实过不了」，再证明新套件能过。
//   其余用例是反向：白屏、字全藏着、刷新后塌掉，都不许算渲染出内容（§5）。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { APP_ASSERTION_IDS, APP_SUITE_VERSION, runVerification } from "./browser-runner.mjs";

const revision = "prv-" + "b".repeat(32);
const token = "one_use_secret_" + "y".repeat(24);
const chrome = process.env.SLIDERULE_CHROMIUM_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(existsSync);
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => server.close(resolve));

// 记账页：没有计数器，有标题、表单和一行账目。
const LEDGER = `<h1>记账本</h1><form><label>金额<input name="amount"></label>
  <button type="button">记一笔</button></form><ul><li>午饭 -32.00</li></ul>`;
const PAGES = {
  ledger: `<div id="root">${LEDGER}</div>`,
  blank: `<div id="root"></div>`,
  hidden: `<div id="root"><div style="display:none">${LEDGER}</div></div>`,
  // 首次渲染，刷新后白屏（比如读坏了自己写进 localStorage 的数据）。
  "reload-crash": `<div id="root"></div><script>
    const root = document.getElementById("root");
    if (sessionStorage.getItem("seen")) root.innerHTML = "";
    else { sessionStorage.setItem("seen", "1"); root.innerHTML = ${JSON.stringify(LEDGER)}; }
  </script>`,
};

async function fixture(mode, execute) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/_whybuddy/authorize") {
      response.writeHead(303, { location: "/", "set-cookie": "WhyBuddyPreview=private-grant; HttpOnly; SameSite=Strict; Path=/" });
      response.end(); return;
    }
    if (!request.headers.cookie?.includes("WhyBuddyPreview=private-grant")) { response.writeHead(403); response.end(); return; }
    if (url.pathname === "/__whybuddy_revision.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ revision })); return;
    }
    if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${PAGES[mode]}</body></html>`);
  });
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = suiteVersion => ({ verificationId: "verify-app", revision, suiteVersion,
    scope: { origin, projectId: "project-app", runtimeId: "runtime-app" },
    entryUrl: origin + "/_whybuddy/authorize?ticket=" + token });
  try { await execute(input); } finally { await close(server); }
}

const run = input => runVerification(input, { allowLoopback: true, assertionTimeoutMs: 800,
  timeoutMs: 20000, launchOptions: chrome ? { executablePath: chrome } : {} });
const status = (result, id) => result.assertions.find(item => item.id === id)?.status;

test("记账页：计数器套件过不了，普通网页套件能过", async () => {
  await fixture("ledger", async input => {
    const counter = await run(input("react-vite-counter@1"));
    assert.equal(counter.status, "failed", "前提不成立：计数器套件竟然能验记账页");
    const app = await run(input(APP_SUITE_VERSION));
    assert.equal(app.status, "passed", app.errorCode);
    assert.equal(app.suiteVersion, APP_SUITE_VERSION);
    assert.deepEqual(app.assertions.map(item => item.id), APP_ASSERTION_IDS);
    assert.deepEqual(Object.keys(app.artifacts), ["app.png"]);
    assert.equal(app.revisionBefore, revision);
    assert.equal(app.revisionAfter, revision);
    // 收据里不许出现页面文字，也不许带票。
    assert.equal(JSON.stringify(app).includes("记账本"), false);
    assert.equal(JSON.stringify(app).includes(token), false);
  });
});

for (const [mode, failed] of [["blank", "content_visible"], ["hidden", "content_visible"],
  ["reload-crash", "reload_renders"]]) {
  test(`反向：${mode} 不算渲染出内容`, async () => {
    await fixture(mode, async input => {
      const result = await run(input(APP_SUITE_VERSION));
      assert.equal(result.status, "failed");
      assert.equal(status(result, failed), "failed");
      // 名单报满：没跑到的也要占位，不许装成一套更短的判据。
      assert.deepEqual(result.assertions.map(item => item.id).sort(), [...APP_ASSERTION_IDS].sort());
    });
  });
}
