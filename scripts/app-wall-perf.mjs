/**
 * 「作品墙」密度压测驱动。
 *
 *   node scripts/app-wall-perf.mjs                      # 默认矩阵
 *   node scripts/app-wall-perf.mjs 4,8,14,20 dense,uniform
 *
 * 配套 /app-wall-perf.html（AppWallPerfHarness.tsx）。要先起 dev 栈。
 *
 * ## 为什么必须串行
 *
 * 性能测量是互斥的：同一台机器上并行跑两个浏览器，两边抢 CPU，测出来的挂载
 * 时长/长任务/掉帧全部偏高，而且偏多少不可知。所以这里**一个配置一个浏览器、
 * 一个接一个跑**，每轮之间还留一段静默时间让上一轮的 GC 落定。看着慢，但只有
 * 这样出来的数才敢拿去定版式密度。
 *
 * ## 量什么、为什么量这个
 *
 *   挂载墙钟     — 从模型就位到最后一张卡挂完。用户等的就是这段。
 *   CPU 时间     — 走 CDP Performance.getMetrics 的 TaskDuration。墙钟会被
 *                  网络和 GC 干扰，CPU 时间才是真实计算量。
 *   JS 堆        — 十几个 AppRuntimeScreen + 几十个 ECharts 实例最吃这个。
 *   canvas 数    — ECharts 每个实例一张 canvas，直接数就是图表实例数。
 *   长任务       — >50ms 的任务，主线程被堵住多久。掉帧的直接原因。
 *   滚动掉帧     — 真滚一遍，用 rAF 间隔算 FPS。作品墙是要滚的。
 *
 * ## 已知的读数纪律
 *
 *  · 每个配置跑 REPEATS 轮取中位数，单轮受 GC 抽风影响太大。
 *  · 浏览器用环境预装的 chromium（仓库钉的版本常与预装不一致，显式
 *    executablePath，别去跑 playwright install）。
 *  · dev 模式跑出来的数**比生产偏慢**（vite 不压缩、模块逐个请求、React 开发
 *    构建带额外校验）。所以这里的数字要当**上界**读：如果 dev 下已经够用，
 *    生产必然够用；如果 dev 下不行，还得再用 preview 构建复测一遍才能定罪。
 *    这一条务必写进结论，不然会拿一个偏悲观的数把设计稿否掉。
 */
import { chromium } from "@playwright/test";

const BASE = process.env.SLIDERULE_BASE || "http://localhost:3000";
const CHROMIUM = process.env.SLIDERULE_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const NS = (process.argv[2] || "4,8,14,20").split(",").map(Number);
const LAYOUTS = (process.argv[3] || "dense,uniform").split(",");
const REPEATS = Number(process.env.WALL_REPEATS || 3);
const MOUNT_BUDGET_MS = 90000;

const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function runOnce(n, layout) {
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: CHROMIUM });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");

    // 长任务观察器必须在页面脚本之前装好，否则错过挂载期那批
    await page.addInitScript(() => {
      window.__longTasks = [];
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.__longTasks.push(e.duration);
        }).observe({ entryTypes: ["longtask"] });
      } catch {
        /* 不支持就算了，别让观察器本身把页面弄挂 */
      }
    });

    const url = `${BASE}/app-wall-perf.html?n=${n}&layout=${layout}&lazy=0`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (await page.locator('[data-testid="wall-error"]').count()) {
      throw new Error(await page.locator('[data-testid="wall-error"]').innerText());
    }

    // 等全部卡片挂完（harness 自己在 window.__wallPerf 上报）
    const ok = await page
      .waitForFunction(() => window.__wallPerf?.mountedAt != null, null, {
        timeout: MOUNT_BUDGET_MS,
      })
      .then(() => true)
      .catch(() => false);
    // 挂完之后再等一拍：ECharts 是在 effect 里初始化的，卡片"挂上"不等于图画完
    await page.waitForTimeout(2500);

    const metrics = Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])
    );

    const snap = await page.evaluate(() => ({
      startedAt: window.__wallPerf?.startedAt ?? null,
      mountedAt: window.__wallPerf?.mountedAt ?? null,
      distinctModels: window.__wallPerf?.distinctModels ?? 0,
      cards: document.querySelectorAll('[data-testid="wall-card"]').length,
      canvases: document.querySelectorAll('[data-testid="wall-card"] canvas').length,
      domNodes: document.querySelectorAll("*").length,
      heapMB: performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null,
      longTasks: (window.__longTasks || []).length,
      longTaskMs: Math.round((window.__longTasks || []).reduce((a, b) => a + b, 0)),
      worstTaskMs: Math.round(Math.max(0, ...(window.__longTasks || []))),
    }));

    // 滚动掉帧：真滚一遍，用 rAF 间隔算 FPS（作品墙是要滚的）
    const fps = await page.evaluate(async () => {
      const gaps = [];
      let last = performance.now();
      let raf = 0;
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const total = document.body.scrollHeight;
      for (let y = 0; y < total; y += 260) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 90));
      }
      cancelAnimationFrame(raf);
      if (gaps.length < 4) return null;
      const mid = gaps.slice(2).sort((a, b) => a - b);
      const p50 = mid[Math.floor(mid.length / 2)];
      return {
        fps: Math.round(1000 / p50),
        worstFrameMs: Math.round(mid[mid.length - 1]),
        dropped: mid.filter(g => g > 33).length,
      };
    });

    return {
      mounted: ok,
      mountMs:
        snap.mountedAt != null && snap.startedAt != null
          ? Math.round(snap.mountedAt - snap.startedAt)
          : null,
      cpuMs: Math.round((metrics.TaskDuration || 0) * 1000),
      heapMB: snap.heapMB,
      canvases: snap.canvases,
      domNodes: snap.domNodes,
      cards: snap.cards,
      distinctModels: snap.distinctModels,
      longTasks: snap.longTasks,
      longTaskMs: snap.longTaskMs,
      worstTaskMs: snap.worstTaskMs,
      fps: fps?.fps ?? null,
      worstFrameMs: fps?.worstFrameMs ?? null,
      droppedFrames: fps?.dropped ?? null,
    };
  } finally {
    await browser.close();
  }
}

const rows = [];
for (const layout of LAYOUTS) {
  for (const n of NS) {
    const runs = [];
    for (let r = 0; r < REPEATS; r++) {
      try {
        runs.push(await runOnce(n, layout));
      } catch (e) {
        console.log(`  n=${n} ${layout} 第 ${r + 1} 轮失败: ${String(e).slice(0, 120)}`);
      }
      // 每轮之间静默一段，让上一轮的 GC 落定，别把回收压力算进下一轮
      await new Promise(r2 => setTimeout(r2, 2500));
    }
    if (!runs.length) continue;
    const pick = k => median(runs.map(x => x[k]).filter(v => typeof v === "number"));
    const row = {
      layout,
      n,
      卡片: runs[0].cards,
      模型数: runs[0].distinctModels,
      挂完: runs.every(x => x.mounted),
      挂载ms: pick("mountMs"),
      CPUms: pick("cpuMs"),
      堆MB: pick("heapMB"),
      canvas: pick("canvases"),
      DOM: pick("domNodes"),
      长任务数: pick("longTasks"),
      长任务ms: pick("longTaskMs"),
      最长任务ms: pick("worstTaskMs"),
      滚动FPS: pick("fps"),
      最差帧ms: pick("worstFrameMs"),
    };
    rows.push(row);
    console.log(
      `${layout.padEnd(8)} n=${String(n).padStart(2)}  挂载${String(row.挂载ms).padStart(6)}ms  ` +
        `CPU${String(row.CPUms).padStart(6)}ms  堆${String(row.堆MB).padStart(4)}MB  ` +
        `canvas${String(row.canvas).padStart(3)}  DOM${String(row.DOM).padStart(6)}  ` +
        `长任务${String(row.长任务数).padStart(3)}个/${String(row.长任务ms).padStart(5)}ms  ` +
        `滚动${String(row.滚动FPS).padStart(3)}fps`
    );
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(JSON.stringify(rows, null, 2));
console.log(
  "\n读数提醒：dev 模式比生产偏慢（vite 不压缩 / 模块逐个请求 / React 开发构建）。\n" +
    "这些数字当**上界**读：dev 下够用则生产必然够用；dev 下不行还得用 preview 构建复测才能定罪。"
);
