/**
 * 停在假设卡上刷新页面，还接不接得回来。
 *
 * ## 这一支为什么存在
 *
 * 2026-09-10 我报过一条「刷新会丢掉假设卡」——**是假的**，而且连着错了三次，
 * 三次都是判据自己的毛病，不是产品的。留这支脚本就是为了下次不用嘴猜。
 *
 *   ① 探针自己拼 `?session=<sid>` 新开一个 context 去"刷新"。
 *      真机 URL 根本没有 session 参数（就是 `/agent-loop/sliderule`），
 *      于是它打开的是**另一条会话**，量到 present:false。
 *      那不是刷新，是新开一局（本仓 §一之二：判据必须喂真机那一发的原样操作）。
 *
 *   ② 改成真 `page.reload()` 之后，直接找「确认继续」，在一张 1/2 的卡上
 *      拿到 submit:false，就报「卡回来了也点不动」。而**刷新前同样是 false**——
 *      多题卡上「确认继续」只在最后一题出现，前面是「下一题」。
 *      判据没先证明这个条件在没坏的时候不成立（本仓 §三）。
 *
 *   ③ 点了 testid `sliderule-new-session`——全仓不存在这个 testid，
 *      `.catch(() => {})` 把点空吞掉，等于压根没新建会话。
 *      真按钮是 `sidebar-session-new`。
 *
 * 修完之后量到的真相（真机，健身房会员卡与私教排课）：
 *
 *     刷新前  present:true painted:true covered:null  1/1 · 已停住，选完再继续
 *     reload
 *     刷新后  +5s 完全一样，submit 也在
 *     点确认  +10s 卡收走、钟 3:pending → +50s 页面框 1 → 页面落库 3 份
 *
 * 接得回来靠的是 E25 续播：hydrate 之后打 `/runs/active`，还在跑就
 * `requestRehearsal({runId})` 从事件日志第 0 条补播——`spec_assumption` 和
 * `run_pause_started` 都在那条日志里，卡是**重建**出来的，不是从 state 里捞的。
 * 所以别去给 hydrate 加一段「从 specFirstPages.spec.assumptions 摊卡」：
 * 那会跟续播重复摊一遍。
 *
 * ## 跑法
 *
 *   SLIDERULE_SMOKE_EMAIL=… SLIDERULE_SMOKE_PASSWORD=… \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=… node scripts/sliderule-reload-resume-e2e.mjs
 *
 * 可选：E2E_TOPIC 换话题、E2E_SHOT_DIR 换截图目录、E2E_BASE 换地址。
 * 判据落在人眼看得见的东西上（卡在不在、被没被盖住、点完推演走没走），
 * 不查内部状态——本仓 §五。
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOT_DIR || ".manus-logs/reload-shots";
const TOPIC =
  process.env.E2E_TOPIC ||
  "做一个健身房的会员卡与私教排课系统：会员办卡、私教排课、到店签到，前台首页看今天的课表和到店人数";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[reload]", ...a);
let failures = 0;
const check = (ok, what) => {
  if (!ok) failures += 1;
  log(`${ok ? "✅" : "❌"} ${what}`);
};

const b = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();

/** 在不在 DOM 里 ≠ 人看得见。三样一起量：盒子、视口、那块地方最上层是谁。 */
const measure = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="sliderule-assumptions"]');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = document.elementFromPoint(
      Math.round(r.left + r.width / 2),
      Math.round(r.top + Math.min(r.height / 2, 20))
    );
    return {
      present: true,
      painted:
        cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0,
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 && r.height > 0,
      covered:
        top && !el.contains(top)
          ? `${top.tagName}[${top.getAttribute("data-testid") || ""}]`
          : null,
      pager: (
        document.querySelector('[data-testid="sliderule-assumption-pager"]')
          ?.textContent || ""
      ).trim(),
    };
  });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const status = await page.evaluate(
    async ([email, password]) =>
      (
        await fetch("/api/sliderule/account/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      ).status,
    [
      process.env.SLIDERULE_SMOKE_EMAIL || "",
      process.env.SLIDERULE_SMOKE_PASSWORD || "",
    ]
  );
  log("登录 ->", status);

  await page.goto(BASE + "/agent-loop/sliderule", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', {
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  // 上一轮留在屏幕上的卡会把输入框锁死，先打发走再新建。
  for (const sel of [
    '[data-testid="sliderule-scope-revise"]',
    '[data-testid="sliderule-clarification-close"]',
  ]) {
    if (await page.locator(sel).count()) {
      await page.locator(sel).first().click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  const fresh = page.locator('[data-testid="sidebar-session-new"]').first();
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByText("想推演成什么应用").count()) break;
    if (await fresh.count()) await fresh.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const TA = '[data-testid="sliderule-composer-input"]';
  await page.waitForSelector(`${TA}:not([disabled])`, { timeout: 90000 });
  const box = page.locator(TA).first();
  await box.click();
  await box.fill("");
  await box.pressSequentially(TOPIC, { delay: 6 });
  await page.waitForTimeout(900);
  await page.waitForSelector('[data-testid="sliderule-composer-send"]:not([disabled])', {
    timeout: 60000,
  });
  await page.locator('[data-testid="sliderule-composer-send"]').first().click();
  log("发出去了，等假设卡…");

  await page.waitForSelector('[data-testid="sliderule-assumptions"]', {
    timeout: 240000,
  });
  await page.waitForTimeout(1500);
  const before = await measure();
  log("刷新前:", JSON.stringify(before));
  await page.screenshot({ path: `${OUT}/1-刷新前.png` });
  check(before.present && before.painted && !before.covered, "刷新前卡是看得见的");
  check(/已停住/.test(before.pager), "工厂真的停住了（不是卡摆着而已）");

  log("—— reload ——");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', {
    timeout: 60000,
  });
  let after = { present: false };
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(5000);
    after = await measure();
    log(`刷新后 +${(i + 1) * 5}s:`, JSON.stringify(after));
    if (after.present && after.painted && !after.covered) break;
  }
  await page.screenshot({ path: `${OUT}/2-刷新后.png` });
  check(after.present, "刷新之后假设卡回来了");
  check(Boolean(after.painted && after.inViewport && !after.covered), "而且人看得见");
  check(/已停住/.test(after.pager), "还认得出工厂停在那儿");

  // 卡回来了 ≠ 卡还能用：真点一次，看推演有没有往下走。
  // ⚠ 多题卡的「确认继续」只在最后一题，前面是「下一题」。
  const next = page.locator('[data-testid="sliderule-assumption-next"]');
  for (let i = 0; i < 8 && (await next.count()) && (await next.isVisible()); i += 1) {
    await next.click();
    await page.waitForTimeout(400);
  }
  const submit = page.locator('[data-testid="sliderule-assumption-submit"]');
  if (!(await submit.count())) {
    check(false, "翻到最后一题也没有「确认继续」");
  } else {
    log("刷新后点「确认继续」…");
    await submit.first().click();
    let moved = false;
    let interrupted = false;
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(10000);
      const st = await page.evaluate(() => ({
        clock: [
          ...document.querySelectorAll('[data-testid^="sliderule-rehearsal-step-"]'),
        ]
          .map(e => `${e.getAttribute("data-step")}:${e.getAttribute("data-status")}`)
          .join(","),
        pages: document.querySelectorAll(
          '[data-testid^="sliderule-artboard"], iframe'
        ).length,
        interrupted: document.body.innerText.includes("推演中断"),
      }));
      log(`  +${(i + 1) * 10}s 钟=${st.clock || "—"} 页面框=${st.pages}`);
      if (st.interrupted) { interrupted = true; break; }
      if (st.pages > 0) { moved = true; break; }
    }
    await page.screenshot({ path: `${OUT}/3-点完之后.png` });
    check(!interrupted, "点完没弹「推演中断」");
    check(moved, "点完推演继续往下走，页面真的出来了");
  }
} catch (e) {
  failures += 1;
  log("!! 挂了:", String(e).slice(0, 240));
  await page.screenshot({ path: `${OUT}/x-挂了.png` }).catch(() => {});
} finally {
  await b.close();
}
log(failures ? `\n${failures} 条没过` : "\n全过");
process.exit(failures ? 1 : 0);
