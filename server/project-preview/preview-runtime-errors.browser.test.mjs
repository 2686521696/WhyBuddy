// 预览里应用自己抛的错回到工作台：真 Chrome、真模板 index.html、真注入的桥（跟网关同一个 toString() 注入）。
//
// ⚠ 2026-10-08：桥（/_whybuddy/editor.js）排在 /src/main.tsx 后面、还要先过网关鉴权才回来——首屏渲染
//   就炸的错早于它的监听器。模板 index.html 头里那段内联脚本先排队，桥装好后补报（Sentry Loader 的做法）。
//   第一条判据先证明「没有那段内联脚本，首屏的错真的收不到」，第二条才证明修好了。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { installPreviewSelectionBridge } from "../../shared/project-preview-selection.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATE_INDEX = readFileSync(`${root}project-templates/react-vite/index.html`, "utf8");
const chrome = [process.env.SLIDERULE_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find(path => path && existsSync(path));
const SCOPE = { projectId: "prj-1", runtimeId: "rt-1", revision: "r-1" };
// 真机常见的首屏崩法：数据还没到就 .map；外加一个没人接的接口失败。
// 再加两种桥装好之后才发生的：每 300ms 抛同一个错（渲染循环那种，只许报一次）、点了「保存」才失败的接口。
const CRASHING_APP = `Promise.reject(new Error("加载预算失败：/api/budget 404"));
let ticks = 0;
setTimeout(() => {                     // 桥 400ms 后才装好：这个错只可能走桥自己的监听器
  const timer = setInterval(() => { if (++ticks === 3) clearInterval(timer); throw new RangeError("每秒重算预算时越界"); }, 150);
}, 700);
setTimeout(() => Promise.reject(new Error("保存失败：/api/budget 500")), 900);
const data = {};
data.items.map(item => item);`;

function listen(handler) {
  const server = createServer(handler);
  return new Promise(done => server.listen(0, "127.0.0.1", () => done(server)));
}

async function scenario(indexHtml) {
  let workbenchOrigin = "";
  const app = await listen((request, response) => {
    const path = request.url.split("?", 1)[0];
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(indexHtml);
    } else if (path === "/src/main.tsx") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(CRASHING_APP);
    } else if (path === "/_whybuddy/editor.js") {
      // 网关先过一趟鉴权才回脚本：给它一段真实的延迟。
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(`(${installPreviewSelectionBridge.toString()})(${JSON.stringify({ workbenchOrigin, ...SCOPE })});`);
      }, 400);
    } else { response.writeHead(404); response.end(); }
  });
  const appOrigin = `http://127.0.0.1:${app.address().port}`;
  const workbench = await listen((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><iframe id="preview" src="${appOrigin}/"></iframe><script>
      window.received = [];
      addEventListener("message", event => {
        if (event.origin === ${JSON.stringify(appOrigin)}) received.push({ ...event.data, at: performance.now() });
      });
      const frame = document.getElementById("preview");
      const init = () => frame.contentWindow.postMessage({ type: "whybuddy:select:init", schemaVersion: 1,
        ...${JSON.stringify(SCOPE)}, channelId: "channel-1", enabled: false }, ${JSON.stringify(appOrigin)});
      frame.addEventListener("load", init);   // 跟 connectPreviewSelection 一样：框 load 时发握手
    </script>`);
  });
  workbenchOrigin = `http://127.0.0.1:${workbench.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    await page.goto(workbenchOrigin + "/");
    await page.waitForFunction(() => window.received.some(item => item.type === "whybuddy:select:ready"), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    return await page.evaluate(() => window.received);
  } finally {
    await browser.close();
    app.close(); workbench.close();
  }
}

const errorsIn = received => received.filter(item => item.type === "whybuddy:runtime:error");

test("precondition: without the early queue, the first-render crash is lost", { skip: !chrome && "no Chrome" }, async () => {
  const withoutQueue = TEMPLATE_INDEX.replace(/<script>\/\* WhyBuddy[\s\S]*?<\/script>/, "");
  assert.notEqual(withoutQueue, TEMPLATE_INDEX, "模板里得有那段内联脚本");
  const errors = errorsIn(await scenario(withoutQueue));
  assert.equal(errors.some(item => item.error.message.includes("reading 'map'")), false,
    "前提不成立：桥自己就接得住首屏的错，那段内联脚本就是多余的");
});

test("the real template hands first-render crashes to the workbench, fenced to its scope", { skip: !chrome && "no Chrome" }, async () => {
  const received = await scenario(TEMPLATE_INDEX);
  const errors = errorsIn(received);
  const crash = errors.find(item => item.error.kind === "uncaught_exception");
  assert.ok(crash, JSON.stringify(errors));
  assert.match(crash.error.message, /reading 'map'/);
  assert.match(crash.error.stack, /TypeError/);
  const rejection = errors.find(item => item.error.kind === "unhandled_rejection");
  assert.equal(rejection?.error.message, "加载预算失败：/api/budget 404");
  // 早期的错在握手那一刻就交出去，不等下一个错来「顺带」——一个只在首屏崩一次的应用没有下一个错。
  const ready = received.find(item => item.type === "whybuddy:select:ready");
  assert.ok(crash.at - ready.at < 200, `首屏的错握手后 ${Math.round(crash.at - ready.at)}ms 才到`);
  for (const item of errors)                                              // 跟点选同一套围栏：只认这一版、这一条通道
    assert.deepEqual([item.schemaVersion, item.projectId, item.runtimeId, item.revision, item.channelId],
      [1, SCOPE.projectId, SCOPE.runtimeId, SCOPE.revision, "channel-1"]);
  // 桥装好之后的错走桥自己的监听器（早期队列那时已经读完了）
  assert.ok(errors.some(item => item.error.message === "保存失败：/api/budget 500"), JSON.stringify(errors));
  assert.equal(errors.filter(item => item.error.message === "每秒重算预算时越界").length, 1, "同一个错只报一次");
  assert.equal(errors.length, 4);
});
