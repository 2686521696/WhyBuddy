/**
 * app-shell-tour.mjs
 *
 * 把一个**已存在的会话**在真实前端里逐页巡检：桌面档 + 手机档各截一遍。
 * 用于改完渲染层之后做视觉回归——跟 model-browser-shot.mjs 的区别是那个要
 * 先生成一份新模型（约 20 分钟），这个直接吃现成会话，几十秒出结果。
 *
 * 用法：
 *   node scripts/app-shell-tour.mjs <sessionId> [outDir]
 *
 * ─── 三条踩过的坑，都固化在下面的代码里 ───────────────────────────
 *
 * ① **切页要回读确认**。角色对某页无权限时，点侧栏 tab **不切页**，读到的
 *    还是上一页。照着截图会得出"这个页面根本没生效"的错误结论——真栽过两次
 *    （kanban/calendar 被误判成没实现）。所以每切一页都回读页名，对不上就
 *    如实记为"无权限"，绝不截图冒充。
 *
 * ② **设备切换器在 stage 外层**的工具条上。从 `sliderule-app-stage` 里面找
 *    `app-device-phone` 会一直等到超时（30s）也找不到，而且报错只说
 *    "timeout"，看不出是作用域错了。一律用 page 级定位。
 *
 * ③ **手机档的选择器跟桌面档不是一套**。桌面是 antd Select（浮层 +
 *    `.ant-select-item-option`），手机是 antd-mobile Picker（底部弹层 +
 *    滚轮 + 取消/确定）。照搬桌面的选择器去点，弹层会被撑开挡住整屏，
 *    截出来是一张**被弹层盖住的假图**。两档各走各的路径，见 pickRole()。
 */

import { mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.SLIDERULE_SMOKE_PORT ?? "3000", 10);
const BASE = `http://localhost:${PORT}`;

const log = m => process.stdout.write(`[shell-tour] ${m}\n`);
const fail = m => {
  process.stderr.write(`[shell-tour] FAIL: ${m}\n`);
  process.exit(1);
};

const sessionId = process.argv[2];
if (!sessionId) fail("缺少 sessionId：node scripts/app-shell-tour.mjs <sessionId> [outDir]");
const outDir = process.argv[3] ?? resolve(ROOT, "tmp", "shell-tour");
mkdirSync(outDir, { recursive: true });

/** 页面标题回读（坑①）：桌面看面包屑，手机看 NavBar 标题。 */
const currentPageTitle = (page, phone) =>
  page.evaluate(
    isPhone =>
      (isPhone
        ? document.querySelector('[data-testid="app-shell-phone"] [class*="nav-bar-title"]')
        : document.querySelector("nav[class*=breadcrumb]")
      )?.textContent?.trim() || "",
    phone
  );

/**
 * 切角色。两档实现完全不同（坑③）——桌面 Select 是浮层选项，
 * 手机 Picker 是滚轮 + 必须点「确定」才生效。
 */
async function pickRole(page, role, phone) {
  await page.locator('[data-testid="app-runtime-role"]').first().click();
  await page.waitForTimeout(700);
  if (!phone) {
    const ok = await page.evaluate(r => {
      const el = [...document.querySelectorAll("[class*=select-item-option]")].find(
        e => e.textContent.trim() === r
      );
      if (!el) return false;
      el.click();
      return true;
    }, role);
    await page.waitForTimeout(1500);
    return ok;
  }
  // 手机：Picker 弹层。滚轮把每个选项渲染两份（测量副本），取第一份即可；
  // 选完必须点「确定」，否则弹层留在屏上，后续截图全是被盖住的假图。
  const picked = await page.evaluate(r => {
    const root = document.querySelector('[data-testid="app-runtime-role-picker"]');
    if (!root) return false;
    const item = [...root.querySelectorAll('[class*="picker-view-column-item"]')].find(
      e => e.textContent.trim() === r
    );
    if (!item) return false;
    item.click();
    return true;
  }, role);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="app-runtime-role-picker"]');
    const btns = [...(root?.querySelectorAll('[class*="picker-header-button"]') ?? [])];
    btns[btns.length - 1]?.click(); // 最后一个是「确定」
  });
  await page.waitForTimeout(1500);
  return picked;
}

async function tour(page, { phone, roles, pages, prefix }) {
  const shot = phone
    ? page.locator('[data-testid="app-shell-phone"]').first()
    : page.locator('[data-testid="sliderule-app-stage"]').first();
  const done = new Set();
  let n = 0;

  for (const role of roles) {
    if (!(await pickRole(page, role, phone))) {
      log(`  【${role}】切不过去，跳过`);
      continue;
    }
    for (const p of pages) {
      if (done.has(p.id)) continue;
      const clicked = phone
        ? await page.evaluate(t => {
            const el = [
              ...document.querySelectorAll('[data-testid="app-shell-phone"] [class*="tab-bar-item"]'),
            ].find(e => e.textContent.trim() === t);
            el?.click();
            return Boolean(el);
          }, p.label)
        : await page
            .locator(`[data-testid="app-runtime-menu-${p.id}"]`)
            .first()
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false);
      if (!clicked) continue;
      await page.waitForTimeout(2000);

      const title = await currentPageTitle(page, phone);
      if (!title.includes(p.label)) {
        log(`  ✗ ${p.label}：仍停在「${title}」→ ${role} 无权限，不截图`);
        continue;
      }
      done.add(p.id);
      const file = join(outDir, `${prefix}-${String(++n).padStart(2, "0")}-${p.id}.png`);
      await shot.screenshot({ path: file }).catch(e => log(`  截图失败: ${e.message}`));
      log(`  ✓ ${p.label}`);
    }
    if (done.size === pages.length) break;
  }
  const missed = pages.filter(p => !done.has(p.id)).map(p => p.label);
  log(`${prefix}: 共截 ${n}/${pages.length} 页${missed.length ? `；未覆盖: ${missed.join(", ")}` : ""}`);
  return { shot: n, total: pages.length };
}

// SLIDERULE_CHROMIUM_PATH：给"装的浏览器版本跟 @playwright/test 对不上"的
// 环境用的逃生口（容器里常见：预装 chromium-1194，而依赖要 1228，自动解析会
// 去找一个不存在的路径，报错只说 executable doesn't exist）。不设就走默认解析，
// 行为与其它 *-browser-shot 脚本一致。
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: process.env.SLIDERULE_CHROMIUM_PATH || undefined,
});
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 })
).newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(id => {
    localStorage.setItem("sliderule:active-session-id", id);
    // 清掉持久化的运行时状态，让演示种子按**当前代码**重铺；不清的话看到的
    // 还是上一版生成器留下的行，等于没验证
    localStorage.removeItem(`sliderule:live-runtime:${id}`);
  }, sessionId);
  await page.goto(`${BASE}/agent-loop/sliderule`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="sliderule-app-stage"]', { timeout: 60000 });
  await page.waitForTimeout(4000);

  const pages = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="app-runtime-menu-"]')].map(e => ({
      id: e.getAttribute("data-testid").replace("app-runtime-menu-", ""),
      // 尾部数字要摘掉：侧栏菜单项挂了行数 Badge，textContent 会把它一起读进来
      // （「工坊运营总览12」），跟面包屑「工坊运营总览」永远对不上，于是那两页
      // 被一路误报成"无权限"——覆盖率悄悄少报，日志看着还挺正常。
      label: e.textContent.trim().replace(/\s*\d+$/, ""),
    }))
  );
  if (pages.length === 0) fail("没读到任何页面菜单——会话里可能还没有成形应用");

  const roles = await (async () => {
    await page.locator('[data-testid="app-runtime-role"]').first().click();
    await page.waitForTimeout(700);
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll("[class*=select-item-option]")]
        .map(e => e.textContent.trim())
        .filter(Boolean)
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    return [...new Set(opts)];
  })();
  log(`会话 ${sessionId}｜${pages.length} 页｜角色: ${roles.join(" / ")}`);

  log("── 桌面档 ──");
  const desktop = await tour(page, { phone: false, roles, pages, prefix: "desktop" });

  log("── 手机档 ──");
  // 坑②：设备切换器在 stage 外层，必须 page 级定位
  //
  // 2026-07-30：手机档按钮**可能压根不存在**了——明说 preferredDevice=desktop
  // 的应用不再设计手机版式，切换条也就不给那个入口（见 availableDeviceTiers）。
  // 这不是故障，是预期行为，所以这里区分"没有那一档"和"有但点不进去"：
  // 前者跳过并如实说明，后者仍然 fail。此前无条件 click 会在桌面档应用上
  // 直接超时挂掉，报错还只说找不到元素——正是坑①那类误导性失败。
  const phoneBtn = page.locator('[data-testid="app-device-phone"]');
  const hasPhoneTier = (await phoneBtn.count()) > 0;
  let mobile = { shot: 0 };
  if (!hasPhoneTier) {
    log("这个应用只有桌面档（切换条无手机入口），跳过手机档巡检");
  } else {
    await phoneBtn.first().click();
    await page.waitForTimeout(2500);
    if ((await page.locator('[data-testid="app-shell-phone"]').count()) === 0)
      fail("点了 app-device-phone 但没进手机壳");
    mobile = await tour(page, { phone: true, roles, pages, prefix: "mobile" });
  }

  log(`产物目录: ${outDir}`);
  if (desktop.shot === 0) fail("桌面档一张都没截到");
  if (hasPhoneTier && mobile.shot === 0) fail("有手机档但一张都没截到");
  log("PASS");
} finally {
  await browser.close();
}
