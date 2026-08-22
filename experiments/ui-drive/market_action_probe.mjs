// 量「应用市场点一个菜单动作，代价有多大」。
//
// 用法：UI_EMAIL=… UI_PASSWORD=… node market_action_probe.mjs [输出目录]
//
// 量三件用户真能感觉到的事：
//   ① 卡片有没有整片消失（setApps(null) → 列表清空 → 看起来就是整页刷新）
//   ② 已经滚出来的分页还在不在（61 个应用、PAGE_SIZE=12，滚了几页会不会被打回第一页）
//   ③ 打了几个网络请求（哪些跟这次操作根本无关）
//
// ⚠ 判据落在**渲染后的卡片数**上，不看代码里写没写 reload——本仓的教训是
//   「函数写对了 ≠ 它被调用了」，反过来也一样：没有 location.reload() 不代表
//   用户看到的不是整页刷新。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
const OUT = process.argv[2] || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const lr = await ctx.request.post('http://127.0.0.1:3000/api/sliderule/account/login',
  { data: { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD } });
console.log('登录', lr.status());
const p = await ctx.newPage();

const reqs = [];
p.on('request', r => reqs.push({ t: Date.now(), url: r.url() }));

await p.goto('http://127.0.0.1:3000/agent-loop/workbench', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
// 进「我的应用」
const mine = p.getByText(/^我的应用$/).first();
if (await mine.count()) { await mine.click(); await p.waitForTimeout(3000); }

// ⚠ 数每张卡都有的 `app-menu-`，别数 `app-visibility-`：后者只在**菜单打开时**
//   存在，菜单一开计数就掉到 1-2，看着像列表塌了。第一版就这么把「打开菜单」
//   误读成「清空过」。
const cardCount = () => p.evaluate(() =>
  document.querySelectorAll('[data-testid^="app-menu-"]').length);

// 滚几屏把后面的分页加载出来
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 4000); await p.waitForTimeout(1500); }
await p.waitForTimeout(2000);
const before = await cardCount();
console.log(`滚动加载后，页面上有 ${before} 张卡`);
if (OUT) await p.screenshot({ path: `${OUT}/00-动作前.png` });

// 找一个能点「设为私有 / 设为公开」的卡
const menuBtns = p.locator('[data-testid^="app-menu-"], button[aria-label*="更多"], button[title*="更多"]');
let opened = false;
const n = await menuBtns.count();
for (let i = 0; i < Math.min(n, 5); i++) {
  try {
    await menuBtns.nth(i).click({ timeout: 3000 });
    await p.waitForTimeout(600);
    if (await p.locator('[data-testid^="app-visibility-"]').first().count()) { opened = true; break; }
  } catch { /* 换下一个 */ }
}
if (!opened) {
  console.log('✗ 没找到能打开的卡片菜单（选择器要跟着 UI 走），当前卡数', before);
  await b.close(); process.exit(1);
}

reqs.length = 0;
const t0 = Date.now();
await p.locator('[data-testid^="app-visibility-"]').first().click();

// 逐帧看卡片数，抓「有没有清空过」
let minCards = before, blanked = false, backAt = 0;
for (let i = 0; i < 120; i++) {
  const c = await cardCount();
  minCards = Math.min(minCards, c);
  if (c === 0) blanked = true;
  if (blanked && c >= 12 && !backAt) backAt = Date.now() - t0;
  await p.waitForTimeout(150);
}
const after = await cardCount();
if (OUT) await p.screenshot({ path: `${OUT}/01-动作后.png` });

const api = reqs.filter(r => r.url.includes('/api/'));
console.log(`\n点一次「设为私有」的代价：`);
console.log(`  卡片数     ${before} → 最低 ${minCards} → ${after}   ${blanked ? '★ 整片清空过' : '没有清空'}`);
if (backAt) console.log(`  列表恢复   ${backAt}ms`);
console.log(`  网络请求   ${api.length} 个：`);
const byPath = {};
for (const r of api) { const u = new URL(r.url).pathname; byPath[u] = (byPath[u] || 0) + 1; }
for (const [u, c] of Object.entries(byPath)) console.log(`     ×${c}  ${u}`);
await b.close();
