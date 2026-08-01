/**
 * freeform-blockref-wiring-check.mjs
 *
 * 验收 2026-08-01 那两个连锁 bug 的修复（见 ab2f413）：
 *   ① 首页设计树里用 blockRef 嵌进来的积木拿不到 props，渲染成空壳
 *      （QuickActionPanel 无按钮 / WorkflowTimeline 走 empty 分支）
 *   ② QuickActionPanel / WorkflowTimeline 算不出去重指纹，同一个积木
 *      在设计里嵌一次、下面骨架里又画一次
 *
 * 手法照 generated-app-browser-smoke.mjs：真实 Chromium + route interception
 * 注入模型，不调 LLM、不依赖 Python 推演。
 *
 * 与那个 smoke 的区别：模型不是内置演示域夹具，而是**真机跑出来的那份**
 * （scripts/fresh_topic_shot.py 存下的 model.json）。这很关键——演示域夹具
 * 里根本没有 blockRef，用它验不到这条链路；而真机那份的 today_overview 页
 * 恰好嵌了 QuickActionPanel + WorkflowTimeline + ActivityFeed 三个，
 * 正是触发这两个 bug 的形状。
 *
 * 用法：
 *   node scripts/freeform-blockref-wiring-check.mjs <model.json 路径>
 *
 * Exit 0 = 全部断言通过；非零 = 失败并打印具体哪一条。
 */

import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.SLIDERULE_CHECK_PORT ?? "5199", 10);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = resolve(ROOT, "tmp/freeform-blockref-wiring-check");

const log = (m) => console.log(`[blockref-check] ${m}`);
const fail = (m) => {
  console.error(`[blockref-check] FAIL: ${m}`);
  process.exitCode = 1;
};

const modelPath = process.argv[2];
if (!modelPath || !existsSync(modelPath)) {
  console.error("usage: node scripts/freeform-blockref-wiring-check.mjs <model.json>");
  process.exit(2);
}

const model = JSON.parse(readFileSync(modelPath, "utf-8"));

/** 找出模型里第一个「有 freeformOverview 且里面嵌了 blockRef」的页面。 */
function pickTargetPage(m) {
  for (const p of m?.page?.pages ?? []) {
    if (!p.freeformOverview) continue;
    const refs = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (n.blockRef?.type) refs.push(n.blockRef.type);
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(p.freeformOverview);
    if (refs.length) return { page: p, refs };
  }
  return null;
}

const target = pickTargetPage(model);
if (!target) {
  console.error("[blockref-check] 这份模型里没有「freeformOverview 且嵌了 blockRef」的页面，验不到这条链路");
  process.exit(2);
}
log(`目标页: ${target.page.id} (${target.page.kind})，嵌入的 blockRef: ${target.refs.join(", ")}`);

/**
 * QuickActionPanel 的按钮只由 navigate / createRecord 两类 action 派生
 * （AppRuntimeScreen 的 quickActionButtons 过滤条件），updateRecord 之类
 * 不出按钮。真机那份诊所模型 today_overview 页只有一个 updateRecord，
 * 于是面板**本来就该是空的**——拿它断言"有按钮"验的不是透传，是数据。
 *
 * 所以这一页没有合格 action 时就注入一个合成的 navigate，把这条路径真正
 * 走到。注入的是**渲染输入**，不动被验的代码，且只在缺的时候补。
 */
function ensureQuickActionSource(m, pageId) {
  const pages = m?.page?.pages ?? [];
  const p = pages.find((x) => x.id === pageId);
  if (!p) return false;
  const actions = (p.actions ??= []);
  const qualifies = (a) => a.type === "navigate" || a.type === "createRecord";
  if (actions.some(qualifies)) return false;
  const other = pages.find((x) => x.id !== pageId);
  if (!other) return false;
  actions.push({
    id: "__check_synthetic_navigate",
    type: "navigate",
    targetPageRef: other.id,
    // 不给 permissionRef：permitted 直接为 true，不牵扯角色权限那一层
  });
  return true;
}
const injected = ensureQuickActionSource(model, target.page.id);
if (injected) log(`（本页无 navigate/createRecord action，已注入一个合成的以验通 pageActions 透传）`);

const SKILL_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"];
const sessionId = "blockref-wiring-check";
const perSkillEvidence = {};
for (const skill of SKILL_KEYS) {
  perSkillEvidence[skill] = {
    evidencePresent: true,
    evidenceRef: `evidence:${skill}:check-${skill}`,
    path: `skills/${skill}/closure-evidence.json`,
    artifactId: `check-${skill}`,
    digest: `check-${skill}`,
    modelSection: model[skill],
  };
}

const instruments = JSON.parse(
  readFileSync(resolve(ROOT, "client/src/pages/sliderule/demo-gallery/instruments.json"), "utf-8")
);
const fixtureState = {
  ...(instruments.state ?? {}),
  sessionId,
  goal: { text: "社区诊所的患者预约与复诊随访管理", status: "clear" },
  publishClosure: {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: 6,
    skillCount: 6,
    versionPinsChecked: true,
    closureId: "appbundle:clinic@1.0.0:runtime-closure",
    closureHash: "check",
    stableDigest: "stable-check",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    perSkillEvidence,
  },
};

// ---------- dev server ----------
let proc = null;
const cleanup = () => { if (proc) { try { proc.kill(); } catch {} proc = null; } };
process.once("exit", cleanup);
process.once("SIGINT", () => { cleanup(); process.exit(1); });

async function ready(url, ms = 1500) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

async function ensureServer() {
  if (await ready(BASE)) { log(`复用已在跑的服务 ${BASE}`); return; }
  log(`启动 vite（端口 ${PORT}）…`);
  proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "ignore", env: { ...process.env },
  });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await ready(BASE)) { log("服务就绪"); return; }
  }
  fail("vite 未能在 60s 内就绪");
  process.exit(1);
}

// ---------- run ----------
const { chromium } = await import("@playwright/test");
mkdirSync(OUT_DIR, { recursive: true });
await ensureServer();

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: process.env.SLIDERULE_CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const pg = await ctx.newPage();

await pg.addInitScript((sid) => {
  try { localStorage.setItem("sliderule:active-session-id", sid); } catch {}
}, sessionId);

await pg.route("**/api/sliderule/**", async (route) => {
  const url = route.request().url();
  if (url.includes(`/api/sliderule/sessions/${sessionId}`)) {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ state: fixtureState }) });
  } else if (/\/api\/sliderule\/sessions\/?$/.test(new URL(url).pathname)) {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ sessions: [{ sessionId, goal: fixtureState.goal.text }] }) });
  } else {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  }
});

try {
  await pg.goto(`${BASE}/agent-loop/sliderule`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pg.waitForSelector('[data-testid="app-runtime-screen"]', { timeout: 30000 });
  // 首页设计区渲染出来才谈得上验里面的积木
  await pg.waitForSelector('[data-testid="app-runtime-monitor-freeform-overview"]', { timeout: 20000 });
  await sleep(1200); // 图表/图标懒加载稳定

  const embedded = target.refs;

  // ── 断言 1：嵌入积木没渲染成空壳 ──────────────────────────────
  if (embedded.includes("QuickActionPanel")) {
    const btns = await pg.locator(
      '[data-testid="app-runtime-monitor-freeform-overview"] [data-testid="freeform-block-ref"][data-block-type="QuickActionPanel"] button'
    ).count();
    if (btns > 0) log(`✓ 嵌入的 QuickActionPanel 有 ${btns} 个按钮（拿到 pageActions 了）`);
    else fail("嵌入的 QuickActionPanel 一个按钮都没有 —— pageActions 仍未透传");
  }
  if (embedded.includes("WorkflowTimeline")) {
    const empty = await pg.locator(
      '[data-testid="app-runtime-monitor-freeform-overview"] [data-testid="workflow-timeline-empty"]'
    ).count();
    if (empty === 0) log("✓ 嵌入的 WorkflowTimeline 未走 empty 分支（拿到 workflow 了）");
    else fail("嵌入的 WorkflowTimeline 走了 empty 分支 —— workflow 仍未透传");
  }

  // ── 断言 2：同一类积木在整页只渲染一次（设计里嵌了，骨架不再画）──
  //
  // 用各渲染器自己的根 testid 做**全页计数**，不去区分"设计区 / 骨架"。
  // 早先版本数的是 [data-block-type=...]，而那个属性只有 blockRef 包装层才
  // 带、骨架渲染的积木压根没有——选择器永远匹配不到 0，断言恒过（虚假通过，
  // 靠回退对照才发现）。全页计数没有这个盲区：重复渲染必然让计数变 2。
  const ROOT_TESTID = {
    QuickActionPanel: "quick-action-panel",
    // 空态与正常态是两个不同的根，都要数上，否则"上面空壳 + 下面能用"会漏计
    WorkflowTimeline: ["workflow-timeline", "workflow-timeline-empty"],
    ActivityFeed: ["activity-feed-row", "activity-feed-item"],
  };
  for (const type of new Set(embedded)) {
    const ids = [ROOT_TESTID[type]].flat().filter(Boolean);
    if (!ids.length) { log(`· ${type} 未登记根 testid，跳过重复计数`); continue; }
    if (type === "ActivityFeed") {
      // 动态流的根 testid 是逐行的，数行数没意义——改数它的容器出现几次
      const n = await pg.locator('[data-testid="freeform-block-ref"][data-block-type="ActivityFeed"]').count();
      const scaffoldFeed = await pg.locator('[data-testid="activity-feed-row"], [data-testid="activity-feed-item"]').count();
      log(`· ActivityFeed 设计区容器 ${n} 个，行/项 ${scaffoldFeed} 个（此前已验证去重正常，此处仅记录）`);
      continue;
    }
    const total = await pg.locator(ids.map(i => `[data-testid="${i}"]`).join(", ")).count();
    if (total === 1) log(`✓ ${type} 全页只渲染 1 次（去重生效）`);
    else fail(`${type} 全页渲染了 ${total} 次 —— 期望 1 次，去重未生效`);
  }

  // ── 断言 3：全部安置时，设计区外面的固定骨架应当一个都不渲染 ──
  //
  // 这决定了「第 3 步：骨架让位」到底还要不要做。骨架的渲染函数开头就有
  // `if (dedupedBlocks.length === 0) return null`——所有积木都被设计安置掉
  // 之后它本来就该整段消失。若此处为 0，说明骨架**已经自动让位**，不需要
  // 再去硬删它；硬删反而更糟：没被安置的积木会直接从界面上消失。
  const scaffoldNodes = await pg.locator(
    '[data-testid="app-runtime-experience-block-layout"], [data-testid="app-runtime-experience-block-scaffold"]'
  ).count();
  if (scaffoldNodes === 0) log("✓ 固定骨架整段未渲染（全部积木已被设计安置，骨架自动让位）");
  else log(`· 固定骨架仍渲染了 ${scaffoldNodes} 段 —— 说明还有积木没被设计安置`);

  const shot = join(OUT_DIR, "today-overview.png");
  await pg.screenshot({ path: shot, fullPage: true });
  log(`截图: ${shot}`);
} catch (e) {
  fail(`渲染/断言过程出错: ${e?.message ?? e}`);
  try { await pg.screenshot({ path: join(OUT_DIR, "error.png"), fullPage: true }); } catch {}
} finally {
  await browser.close();
  cleanup();
}

if (process.exitCode) console.error("[blockref-check] 有断言未通过");
else log("全部断言通过");
