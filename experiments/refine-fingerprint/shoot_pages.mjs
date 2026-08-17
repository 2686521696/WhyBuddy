// 把落盘的整页 HTML 渲染成截图，用来**看用户真正看到的东西**。
//
// ⚠ 为什么要有这个：这一整轮的判据都落在模型 JSON 的 id 上，那是中间表征。
//   本仓纪律五的原话是「判据要落在用户真正看到的东西上，量渲染后的 DOM，
//   不量源码」。要给人看效果的时候才发现页面根本没留下来，只能重跑一轮——
//   所以顺手把 two_round_drive 的落盘和这个渲染脚本都补上。
//
// ⚠ 浏览器用 executablePath 显式指定：容器里装的是 chromium-1194，而仓里
//   @playwright/test 期望 1228，不指就报 "Executable doesn't exist"。
//   **不要去 playwright install**（环境说明明确禁止，会重下一整套）。
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [, , runDir, outDir] = process.argv;
if (!runDir || !outDir) {
  console.error('用法: node shoot_pages.mjs <轮次目录> <输出目录>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// ⚠ 生成的页面靠 https://cdn.tailwindcss.com 提供样式（163 个 class 全是
//   Tailwind 的，内联 CSS 只有 476 字符）。浏览器取不到 CDN 的话，截出来的是
//   **裸奔的页面**——图标撑成巨幅、版式全塌。
//   拿那种图当「效果」看，就是判据落在一个坏掉的观测上：页面没问题，是尺子坏了。
//   所以浏览器必须跟 curl 走同一个出站代理。
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: CHROME,
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
if (!proxy) console.warn('⚠ 没有 HTTPS_PROXY，页面样式很可能加载不到，截图不可信');
for (const tag of ['round1', 'round2']) {
  const dir = join(runDir, `pages_${tag}`);
  if (!existsSync(dir)) {
    console.log(`跳过 ${tag}：${dir} 不存在`);
    continue;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  for (const f of files) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // file:// 而不是 setContent：页面里的相对资源、脚本执行时机都更接近真实。
    await page.setContent(readFileSync(join(dir, f), 'utf8'), {
      waitUntil: 'networkidle',
    });
    // 绑定是运行时克隆行的（bind 把重复行收成模板，运行时再克隆回来），
    // 不等一下截到的是模板态，行数会比真实少——本仓在「按钮数少了 18%」
    // 那次就是这么被骗过一回。
    await page.waitForTimeout(1200);
    const out = join(outDir, `${tag}-${basename(f, '.html')}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${out}`);
    await page.close();
  }
}
await browser.close();
