/**
 * detect-design-defects — 把生成出来的首页渲染出来，做一遍机械体检。
 *
 * 采集与判据分开（见 design-defect-detector.ts 的说明）：这个脚本只负责
 *   ① 起浏览器、把一份模型的首页设计渲染进隔离预览页
 *   ② 走一遍 DOM 把几何和算好的样式收成快照
 *   ③ 把快照交给纯函数检测器
 *
 * 判据抄自 pbakaus/impeccable 的浏览器检测器（Apache-2.0）。
 *
 * 用法：
 *   node scripts/detect-design-defects.mjs <model.json> [<model.json> ...]
 *     [--base http://127.0.0.1:3000] [--json out.json] [--shots <dir>]
 *
 * 前提：前端 dev server 起着（npm run dev:sliderule）。
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BASE = flag("base", "http://127.0.0.1:3000");
const JSON_OUT = flag("json", "");
const SHOTS = flag("shots", "");
const MODELS = args.filter(a => !a.startsWith("--") && a.endsWith(".json"))
  .filter((a, i, all) => all.indexOf(a) === i)
  .filter(a => a !== JSON_OUT);

if (MODELS.length === 0) {
  console.error("用法: node scripts/detect-design-defects.mjs <model.json> [...] [--base URL] [--json out.json] [--shots dir]");
  process.exit(2);
}

// 本机 chromium：仓库 pin 的 @playwright/test 与镜像里的 build 号可能不一致，
// 显式给路径比让它自己找更省事（环境说明里也是这么交代的）。
const EXECUTABLE = process.env.CHROMIUM_PATH
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** 给首页铺一点行数据——不铺的话 rowsRef 那些块全是空态，量不出版式问题。 */
function seedRows(model) {
  const out = {};
  for (const e of model.datamodel?.entities ?? []) {
    const fields = e.fields ?? [];
    out[e.id] = Array.from({ length: 8 }, (_, i) => {
      const values = {};
      for (const f of fields) {
        const t = String(f.type ?? "string").toLowerCase();
        if (t === "number") values[f.id] = [1280, 640, 3200, 480, 2150, 890, 1740, 520][i];
        else if (t === "date") values[f.id] = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        else if (t === "enum") {
          const opts = (f.options ?? []).map(o => o.id ?? o);
          values[f.id] = opts.length ? opts[i % opts.length] : "";
        } else values[f.id] = `${f.name || f.id} ${i + 1}`;
      }
      return { id: `seed-${e.id}-${i}`, values, seed: true };
    });
  }
  return out;
}

/**
 * 页面内采集。**这段在浏览器里跑**，不能引用外面的任何东西。
 *
 * 有效背景沿祖先链找第一个不透明底色——渲染层的卡片背景常常在祖先上，
 * 只看自己会永远拿到 transparent，把每一处文字都误判成低对比。
 */
const COLLECT = () => {
  const parseRgb = v => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(v || "");
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  };
  const isScrollRegion = s =>
    /(auto|scroll)/.test(s.overflowX || "") || /(auto|scroll)/.test(s.overflow || "");
  const selectorOf = el => {
    const id = el.id ? `#${el.id}` : "";
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const testid = el.getAttribute("data-testid");
    return `${el.tagName.toLowerCase()}${id}${cls.length ? "." + cls.join(".") : ""}${testid ? `[${testid}]` : ""}`;
  };
  // sr-only 的经典形态：1x1 裁切、absolute + clip
  const isVisuallyHidden = (el, s) => {
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return true;
    return /inset\(50%\)|rect\(0/.test(s.clip || s.clipPath || "");
  };

  const nodes = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.display === "none") continue;
    const rect = el.getBoundingClientRect();
    const ownText = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    let insideScroll = isScrollRegion(s);
    for (let p = el.parentElement; p && !insideScroll; p = p.parentElement) {
      if (isScrollRegion(getComputedStyle(p))) insideScroll = true;
    }

    // 有效背景：自己往上找第一个不透明的
    let bg = null;
    for (let p = el; p; p = p.parentElement) {
      const c = parseRgb(getComputedStyle(p).backgroundColor);
      if (c && c.a >= 0.95) { bg = { r: c.r, g: c.g, b: c.b }; break; }
    }
    const fg = parseRgb(s.color);
    const lh = s.lineHeight === "normal"
      ? parseFloat(s.fontSize) * 1.5
      : parseFloat(s.lineHeight);

    nodes.push({
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      ownText,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: s.display,
      flexDirection: s.flexDirection,
      overflowX: s.overflowX,
      overflow: s.overflow,
      fontSizePx: parseFloat(s.fontSize) || 0,
      fontWeight: Number(s.fontWeight) || 400,
      lineHeightPx: Number.isFinite(lh) ? lh : 0,
      color: fg ? { r: fg.r, g: fg.g, b: fg.b } : null,
      effectiveBackground: bg,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      insideScrollRegion: insideScroll,
      visuallyHidden: isVisuallyHidden(el, s),
    });
  }
  return { viewport: { width: window.innerWidth, height: window.innerHeight }, nodes };
};

const detectorUrl = pathToFileURL(
  resolve("client/src/pages/sliderule/live-runtime/design-defect-detector.ts")
).href;
// 判据模块是 TS。用 node --experimental-strip-types 跑本脚本即可直接 import；
// 不行就退回同目录下的编译产物。这里用动态 import 让报错可读。
let detectDesignDefects, summarizeDefects;
try {
  ({ detectDesignDefects, summarizeDefects } = await import(detectorUrl));
} catch (err) {
  console.error("载入检测器失败（用 node --experimental-strip-types 跑本脚本）:", err.message);
  process.exit(3);
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });
const report = [];
let total = 0;

for (const path of MODELS) {
  const key = basename(path, ".json");
  const model = JSON.parse(readFileSync(path, "utf8"));
  const home = (model.page?.pages ?? []).find(p => p.freeformOverview?.root);
  if (!home) {
    console.log(`[${key}] 没有首页设计，跳过`);
    continue;
  }
  const identity = model.appbundle?.appIdentity ?? {};
  const payload = {
    freeformContent: home.freeformOverview,
    themeId: identity.theme ?? "",
    generatedTheme: identity.generatedTheme ?? null,
    device: model.appbundle?.preferredDevice ?? "desktop",
    entityRows: seedRows(model),
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("**/api/sliderule/freeform-preview/**", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  );
  await page.goto(`${BASE}/sliderule/freeform-preview/detect-${key}`, {
    waitUntil: "networkidle", timeout: 90000,
  });
  await page.waitForSelector('[data-testid="freeform-preview-loading"]', { state: "detached", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const snapshot = await page.evaluate(COLLECT);
  const defects = detectDesignDefects(snapshot);
  const summary = summarizeDefects(defects);
  total += defects.length;
  report.push({ key, page: home.id, nodes: snapshot.nodes.length, summary, defects });

  console.log(`\n[${key}] ${home.id} — 量了 ${snapshot.nodes.length} 个节点，缺陷 ${defects.length} 处`);
  console.log(`   char-wrap ${summary["char-wrap"]} / text-clip ${summary["text-clip"]} / low-contrast ${summary["low-contrast"]}`);
  for (const d of defects.slice(0, 12)) {
    console.log(`   [${d.severity === "critical" ? "严重" : "警告"}] ${d.id} ${d.selector}`);
    console.log(`        ${d.message}`);
  }
  if (defects.length > 12) console.log(`   …还有 ${defects.length - 12} 处`);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${key}.png`, fullPage: true });
  await page.close();
}
await browser.close();

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\n报告: ${JSON_OUT}`);
}
console.log(`\n合计 ${total} 处缺陷，覆盖 ${report.length} 个首页`);
process.exitCode = total > 0 ? 1 : 0;
