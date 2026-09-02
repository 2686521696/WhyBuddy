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

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOT_DIR || ".manus-logs/e2e-shots";
const TOPIC =
  process.env.E2E_TOPIC ||
  "做一个社区诊所的预约与排班系统：医生排班、患者线上预约、到诊登记，管理员首页能看今天的预约量和空闲号源";
const CLARIFY =
  process.env.E2E_CLARIFY_ANSWER ||
  "总部统一配发标准清单，门店按清单逐项打勾";
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

  /* ⚠ 上一趟留在屏幕上的卡会**把输入框锁死**：ComposerDock 的
     `disabled={Boolean(pendingScope) || Boolean(pendingAsk)}`。页面恢复
     上一个会话时这些卡会跟着回来，于是脚本卡在「element is not enabled」
     等到超时——看着像输入框坏了，其实是上一轮还压着。先把它们打发走。 */
  for (const sel of [
    '[data-testid="sliderule-scope-revise"]',
    '[data-testid="sliderule-clarification-close"]',
  ]) {
    const leftover = page.locator(sel);
    if (await leftover.count()) {
      log("清掉上一轮留下的卡:", sel);
      await leftover.first().click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  // 新建会话，别接着旧的跑（先清卡再点，否则点了也进不去）。
  // ⚠ 2026-09-01：getByText("新建会话") 会点到帮助文案；真按钮是
  //   sidebar-session-new。点错就会留在 sliderule-v51-product 上，
  //   上一趟还在「推演中」，范围卡「开始推演」disabled，脚本干等 30s。
  const fresh = page.locator('[data-testid="sidebar-session-new"]').first();
  if (await fresh.count()) {
    await fresh.click();
    await page.waitForTimeout(2500);
    await shot(page, "新建会话");
  }
  for (let i = 0; i < 4; i += 1) {
    const running = await page.evaluate(() =>
      /推演中/.test(document.body.innerText)
    );
    if (!running) break;
    log("上一轮还在推演中，再点新建会话");
    if (await fresh.count()) await fresh.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 60000 });
  await shot(page, "空态");

  const TA = '[data-testid="sliderule-composer-input"]';
  /* ⚠ 等它**可用**，不只是"在页面上"。上一轮的 run 还没落幕、或会话还在
     hydrate 时，输入框是 disabled 的——waitForSelector 照样能解析到它，
     然后 click 干等 30 秒超时，报的是「element is not enabled」，
     看着像脚本坏了，其实只是开早了。 */
  await page.waitForSelector(`${TA}:not([disabled])`, { timeout: 90000 });
  const box = page.locator(TA).first();
  await box.click();
  await box.fill("");
  await box.pressSequentially(TOPIC, { delay: 8 });
  /* 入站判定 debounce 500ms；判定在飞时发送键灰。等它亮再点。 */
  await page.waitForTimeout(800);
  await page.waitForSelector(
    '[data-testid="sliderule-composer-send"]:not([disabled])',
    { timeout: 60000 }
  );
  await shot(page, "输入需求");

  const turnPosted = page.waitForResponse(
    r => r.url().includes("/control-turn-stream") && r.request().method() === "POST",
    { timeout: 45000 }
  );
  await page.locator('[data-testid="sliderule-composer-send"]').first().click();
  let posted = await turnPosted.catch(() => null);
  if (!posted) {
    log("点击发送没有 POST control-turn-stream，改按 Enter");
    await box.click();
    await page.keyboard.press("Enter");
    posted = await page
      .waitForResponse(
        r =>
          r.url().includes("/control-turn-stream") &&
          r.request().method() === "POST",
        { timeout: 45000 }
      )
      .catch(() => null);
  }
  log("已发送", posted ? `控制面 ${posted.status()}` : "仍未见 control-turn-stream");
  await shot(page, "发送后");

  /*
   * 控制面：无范围卡不点火 —— 先出卡。
   *
   * ⚠ 2026-08-27：先出的**不一定**是范围卡。控制面现在会先问一轮澄清
   *   （A/B：问题从这句需求里长出来），真机上这一趟出的是
   *   「连锁药店的巡检项通常是怎么来的？」。旧脚本只等 scope-card，
   *   90 秒超时退出——看起来像"控制面那条链断了"，其实是它**正常工作**
   *   走了另一支。等两张卡里的任意一张，是澄清就答完再等范围卡。
   */
  await page.waitForSelector(
    '[data-testid="sliderule-scope-card"], [data-testid="sliderule-clarification-card"]',
    { timeout: 120000 }
  );
  /* ⚠ 澄清可能不止一轮：控制面答完一轮后**还可以再问一轮**（服务端上限 3）。
     只处理一轮的话，第二轮的卡挂在那儿，脚本对着 scope-card 干等 120 秒
     超时——2026-08-27 就是这么挂的，看着像"答完没反应"。所以 while，
     直到范围卡出来或者澄清卡不再出现。 */
  for (let round = 0; round < 3; round += 1) {
    if (await page.locator('[data-testid="sliderule-scope-card"]').count()) break;
    if (!(await page.locator('[data-testid="sliderule-clarification-card"]').count())) break;
    log(`先出的是澄清卡（第 ${round + 1} 轮，控制面按这句需求生成的问题），逐题作答…`);
    await shot(page, "澄清卡");
    for (let step = 0; step < 4; step += 1) {
      const other = page.locator('[data-testid="sliderule-clarification-other"]');
      const free = page.locator('[data-testid="sliderule-clarification-text"]');
      const q = await page
        .locator('[data-testid="sliderule-clarification-card"] h3, [data-testid="sliderule-clarification-card"]')
        .first()
        .textContent()
        .catch(() => "");
      log("  澄清题:", (q || "").trim().slice(0, 60).replace(/\s+/g, " "));
      if (await other.count()) await other.fill(CLARIFY);
      else if (await free.count()) await free.fill(CLARIFY);
      const next = page.locator('[data-testid="sliderule-clarification-next"]');
      if (await next.count()) {
        await next.click();
        await page.waitForTimeout(500);
        continue;
      }
      await page.click('[data-testid="sliderule-clarification-submit"]');
      break;
    }
    log("澄清已提交，等下一张卡…");
    await page
      .waitForSelector(
        '[data-testid="sliderule-scope-card"], [data-testid="sliderule-clarification-card"]',
        { timeout: 120000 }
      )
      .catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('[data-testid="sliderule-scope-card"]', { timeout: 120000 });
  await page.waitForTimeout(1200);
  const restate = await page
    .locator('[data-testid="sliderule-scope-restatement"]')
    .textContent()
    .catch(() => "");
  log("范围卡复述:", (restate || "").trim().slice(0, 80));
  await shot(page, "范围卡");

  await page.waitForSelector(
    '[data-testid="sliderule-scope-confirm"]:not([disabled])',
    { timeout: 90000 }
  );
  await page.click('[data-testid="sliderule-scope-confirm"]');
  log("点了「开始推演」，工厂点火…");
  const started = Date.now();

  let lastText = "";
  let done = false;
  let factoryDone = false;
  /*
   * 伴随式澄清（2026-08-27）：spec-first 第 2 步会把「我替你定了什么」
   * 推上流。它**不拦**推演，所以这里只观察 + 点一下，不改变主流程节奏。
   *
   * ⚠ 判据落在人眼看得见的东西上：面板出没出、点了「改成 X」之后那句话
   *   有没有真的出现在**排队条**里。不查内部状态——本仓第五条。
   */
  let sawAssumptions = false;
  let sawOrch = false;
  let lastStep = "";
  while (Date.now() - started < DEADLINE_MS) {
    await page.waitForTimeout(8000);
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
        clock: [...document.querySelectorAll('[data-testid^="sliderule-rehearsal-step-"]')]
          .map(e => `${e.getAttribute("data-step")}:${e.getAttribute("data-status")}`)
          .join(","),
        orchestrate: (document.body.innerText.match(/编排[^\n]{0,80}/) || [""])[0],
      };
    });
    const line = `${secs}s · 页面框 ${state.pages} · 当前步 ${state.step || "—"} · 钟 ${state.clock || "—"} · 闭环 ${state.badge || "—"}`;
    if (line !== lastText) { log(line); lastText = line; }
    if (!sawOrch && state.orchestrate) {
      sawOrch = true;
      log("左栏编排:", state.orchestrate);
      await shot(page, `编排-${secs}s`);
    }
    if (state.step && state.step !== lastStep) {
      lastStep = state.step;
      await shot(
        page,
        `步骤-${state.step.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").slice(0, 32)}-${secs}s`
      );
    } else if (secs % 40 < 9) {
      await shot(page, `推演-${secs}s`);
    }
    if (state.interrupted) { log("!! 出现「推演中断」"); await shot(page, `中断-${secs}s`); break; }

    if (!sawAssumptions && (await page.locator('[data-testid="sliderule-assumptions"]').count())) {
      sawAssumptions = true;
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="sliderule-assumption"]')].map(
          e => (e.textContent || "").trim().slice(0, 90)
        )
      );
      log(`伴随式澄清出现（${secs}s，第 2 步之后）：`);
      for (const r of rows) log("   ·", r);
      await shot(page, `假设面板-${secs}s`);

      const revise = page.locator('[data-testid="sliderule-assumption-revise"]').first();
      const clickAssumption = process.env.E2E_CLICK_ASSUMPTION === "1";
      if (clickAssumption && (await revise.count())) {
        const label = (await revise.textContent()) || "";
        await revise.click();
        await page.waitForTimeout(800);
        const queued = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="sliderule-queued-turn"]')].map(
            e => (e.textContent || "").trim()
          )
        );
        log(`点了「${label.trim()}」→ 排队条现在有 ${queued.length} 条：`, queued);
        await shot(page, `改一条进排队-${secs}s`);
        if (queued.length === 0) log("!! 点了个寂寞——那句话没进排队条");
      } else if (!clickAssumption) {
        log("本趟不点假设改写（E2E_CLICK_ASSUMPTION 未开），避免搅话题");
      } else {
        log("这一轮的假设没有备选做法（模型只是知会一声），跳过点击");
      }
    }
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
    if (finished && !factoryDone) {
      factoryDone = true;
      log(`工厂收工，用时 ${secs}s，等主 Agent 开口…`);
      await shot(page, `工厂收工-${secs}s`);
    }
    if (factoryDone) {
      const speech = await page
        .locator('[data-host-speech="true"]')
        .first()
        .innerText()
        .catch(() => "");
      const spoke =
        Boolean((speech || "").trim()) &&
        !speech.includes("我是面团的推演引擎") &&
        !speech.includes("当前模型摘要");
      const idleWithoutSpeech =
        !(await page.locator('[data-testid="sliderule-composer-stop"]').count()) &&
        !spoke;
      if (idleWithoutSpeech) {
        log("!! 工厂后作曲家已空闲但主 Agent 还没开口");
      }
      if (spoke) {
        log(`主 Agent 开口，用时 ${secs}s:`, (speech || "").trim().slice(0, 80));
        done = true;
        break;
      }
    }
  }
  await page.waitForTimeout(2000);
  await shot(page, done ? "完成" : "收尾");
  const body = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  fs.writeFileSync(`${OUT}/final-text.txt`, body, "utf8");
  log("伴随式澄清面板:", sawAssumptions ? "出现过" : "整轮没出现");
  log("页面错误:", errors.length ? errors.slice(0, 3) : "无");
} finally {
  await b.close();
}
