/**
 * 真实话题端到端：登录 → 新建会话 → 发一句需求 → 范围卡确认 → 推演到闭环。
 *
 * 跟其它烟测的分工：那些验的是**某一条判据**，这支验的是"一句真需求进去，
 * 到底能不能端出东西来"——所以它不断言，只**按节点截图**并把左栏正在显示的
 * 步骤文字打出来。判据落在人眼看得见的东西上（页面框出没出、有没有
 * 「推演中断」），不量内部状态。
 *
 * ⚠ 控制面之后，发送**不再直接点火**：先出范围卡，点「开始推演」才进工厂。
 *   脚本必须等 sliderule-scope-card，等不到就是控制面那条链断了。
 *
 * 用法：
 *   SLIDERULE_SMOKE_EMAIL=… SLIDERULE_SMOKE_PASSWORD=… \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=… node scripts/sliderule-real-topic-e2e.mjs
 * 可选：E2E_TOPIC 换话题、E2E_SHOT_DIR 换截图目录、E2E_DEADLINE_MIN 换上限。
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = process.env.E2E_SHOT_DIR || ".manus-logs/e2e-shots";
const TOPIC =
  process.env.E2E_TOPIC ||
  "做一个社区诊所的预约与排班系统：医生排班、患者线上预约、到诊登记，管理员首页能看今天的预约量和空闲号源";
const DEADLINE_MS = Number(process.env.E2E_DEADLINE_MIN || 14) * 60 * 1000;
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
const shot = async (page, tag) => {
  const name = `${String(++n).padStart(2, "0")}-${tag}.png`;
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
  console.log(`[shot] ${name}`);
  return name;
};
const log = (...a) => console.log("[e2e]", ...a);

const b = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => {
  const t = m.text();
  if (/\[连接器\]|\[control|control_|推演|error/i.test(t)) console.log("  [console]", t.slice(0, 160));
});

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(
    async ([email, password]) => {
      const r = await fetch("/api/sliderule/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return r.status;
    },
    [
      process.env.SLIDERULE_SMOKE_EMAIL || process.env.E || "",
      process.env.SLIDERULE_SMOKE_PASSWORD || process.env.P || "",
    ]
  );
  log("登录 ->", status);

  await page.goto(BASE + "/agent-loop/sliderule", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 60000 });
  await page.waitForTimeout(4000);

  // 新建会话，别接着旧的跑
  const fresh = page.getByText("新建会话").first();
  if (await fresh.count()) {
    await fresh.click();
    await page.waitForTimeout(2500);
  }
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 60000 });
  await shot(page, "空态");

  const TA = '[data-testid="sliderule-composer-input"]';
  await page.click(TA);
  await page.fill(TA, TOPIC);
  await page.waitForTimeout(400);
  await shot(page, "输入需求");

  await page.click('[data-testid="sliderule-composer-send"]');
  log("已发送，等范围卡…");

  // 控制面：无范围卡不点火 —— 先出卡
  await page.waitForSelector('[data-testid="sliderule-scope-card"]', { timeout: 90000 });
  await page.waitForTimeout(1200);
  const restate = await page
    .locator('[data-testid="sliderule-scope-restatement"]')
    .textContent()
    .catch(() => "");
  log("范围卡复述:", (restate || "").trim().slice(0, 80));
  await shot(page, "范围卡");

  await page.click('[data-testid="sliderule-scope-confirm"]');
  log("点了「开始推演」，工厂点火…");
  const started = Date.now();

  let lastText = "";
  let done = false;
  while (Date.now() - started < DEADLINE_MS) {
    await page.waitForTimeout(20000);
    const secs = Math.round((Date.now() - started) / 1000);
    const state = await page.evaluate(() => {
      const pick = sel => document.querySelector(sel)?.textContent?.trim() || "";
      const steps = [...document.querySelectorAll('[data-testid^="sliderule-step"], .sr-step, [class*="step"]')]
        .map(e => (e.textContent || "").trim())
        .filter(Boolean);
      return {
        step: (() => {
          const cur = document.querySelector(
            '[data-testid^="sliderule-rehearsal-step-"][data-status="current"]'
          );
          return cur ? cur.textContent.trim() : "";
        })(),
        badge: pick('[data-testid="sliderule-publish-closure-badge"]'),
        last: steps.length ? steps[steps.length - 1].slice(0, 120) : "",
        pages: document.querySelectorAll('[data-testid^="sliderule-artboard"], iframe').length,
        closure: pick('[data-testid="sliderule-publish-closure"]').slice(0, 80),
        interrupted: document.body.innerText.includes("推演中断"),
      };
    });
    const line = `${secs}s · 页面框 ${state.pages} · 当前步 ${state.step || "—"} · 闭环 ${state.badge || "—"}`;
    if (line !== lastText) { log(line); lastText = line; }
    if (secs % 60 < 21) await shot(page, `推演-${secs}s`);
    if (state.interrupted) { log("!! 出现「推演中断」"); await shot(page, `中断-${secs}s`); break; }
    /*
     * ⚠ 完成判定**只看六步钟和闭环徽标**，不许 grep 整页文字。
     *
     *   2026-08-27 第一版写的是
     *   `/闭环|6\/6|已完成|交付/.test(document.body.innerText)`，
     *   结果 60s 就报「闭环出现」——匹配到的是**左侧会话列表里旧话题的标题**
     *   （「…全流程闭环系统」「…完整业务闭环」）。那会儿服务端才刚跑到
     *   structure，第 4 步。本仓第二条的原话：判据 grep 的词同时出现在别处，
     *   变异后照样绿；这里是连变异都不用，一开跑就是假绿灯。
     */
    const finished = await page.evaluate(() => {
      const step6 = document.querySelector(
        '[data-testid="sliderule-rehearsal-step-6"]'
      );
      const badge = document.querySelector(
        '[data-testid="sliderule-publish-closure-badge"]'
      );
      return (
        (step6?.getAttribute("data-status") === "done" || !!badge) &&
        document.querySelectorAll("iframe").length > 0
      );
    });
    if (finished) { done = true; log(`闭环出现，用时 ${secs}s`); break; }
  }
  await page.waitForTimeout(2000);
  await shot(page, done ? "完成" : "收尾");
  const body = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  fs.writeFileSync(`${OUT}/final-text.txt`, body, "utf8");
  log("页面错误:", errors.length ? errors.slice(0, 3) : "无");
} finally {
  await b.close();
}
