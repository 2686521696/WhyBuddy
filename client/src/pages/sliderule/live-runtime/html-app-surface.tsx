/**
 * 把新链路的 HTML 跑成**一个能用的应用**：菜单能切、数据填得进去、点得动、
 * 游标够得着。
 *
 * ## 为什么不是沙箱 iframe —— 这条是走错一次才想明白的
 *
 * 08-14 第一版用的是 `sandbox="allow-scripts"`（不透明源）。它把样式问题解决了，
 * 代价是**把这条链路存在的理由一起解决掉了**：不透明源意味着宿主碰不到框内
 * DOM，于是
 *
 *     applyBindings 填不了数        —— 页面永远是模型编的占位文字
 *     动作回调收不到               —— 按钮还是"会发光的 div"
 *     游标读不到元素               —— 五系统透视整层没了
 *     左侧菜单切不了页             —— 每页各自为战
 *
 * 用户原话：「偏离了初衷，不是只生成页面，是操作跟以前一样」。**对的**——
 * 沙箱做出来的是"能看的页面"，要的是"能用的应用"。
 *
 * ## 现在的分工：三件事三样东西治，别再混
 *
 *     可执行内容（模型写的 script / on* / javascript:）  → **DOMPurify**（唯一边界）
 *     样式外溢（生成的 CSS 污染整个产品界面）            → **同源 iframe**（只隔样式）
 *     Tailwind 要能跑                                    → 我们自己注入 CDN
 *
 * ⚠ iframe **不加 sandbox** 属性 —— 它跟父页面同源，所以 `contentDocument`
 * 拿得到，上面四件事才成立。这不是"把安全关了"：页面里所有脚本在写进去
 * **之前**就被 DOMPurify 摘干净了，框里跑的只有我们自己注入的那一个。
 *
 * ⚠ **绝不把页面自带的 `tailwind.config` 那段内联脚本放回去。** 它是模型写的
 * JS，在同源文档里执行等于让生成内容碰到父页面（话题文字可以承载提示注入）。
 * 配色改走 `extractPalette` —— 用正则**读出**颜色表再由我们自己赋值，
 * 全程不执行模型写的代码。读不出来就没有自定义配色（版式照样对，只是品牌色
 * 掉回默认），这是可接受的降级；执行它不是。
 */

import React from "react";
import DOMPurify from "dompurify";

import {
  applyBindings,
  hasAnyDataSource,
  BINDING_ATTRS,
  type ActionGates,
  type ApplyBindingsReport,
  type BindingActionEvent,
  type BindingSource,
} from "./html-binding-runtime";
import { wireOverlays } from "./html-overlay";

export const HTML_APP_SURFACE_VERSION = "html-app-surface-v1";

/**
 * 手机页铺满视口（2026-08-20）。
 *
 * 模型常把整页装进 `max-w-md mx-auto` 的机模——预览已经是 Playwright
 * iPhone 14 的 390×844，再套一层就缩在框中间。CSS 与 Python
 * `page_shell.ensure_phone_viewport_fill` 同 id、同规则，两边注入幂等。
 */
export const PHONE_FILL_STYLE_ID = "sliderule-phone-fill";
/**
 * ⚠ 2026-08-20 第二趟：只盖 body>max-w-md 不够。真机四个页面入口漂在
 * 屏幕正中——居中层是 `min-h-screen flex items-center justify-center`。
 * 第三趟：`items-center` 单独当选择器会误伤顶栏（flex items-center
 * justify-between），把顶栏拉成整页高。盯 min-h-screen / justify-center。
 * Tailwind Play 还会在我们之后往 head 注样式，所以渲染时还要把这份
 * style 挪到 head 末尾（pinPhoneFillStyle）。文案与 Python 同文。
 */
export const PHONE_FILL_CSS =
  "html,body{margin:0!important;width:100%!important;height:100%!important;" +
  "min-height:100%!important;max-width:none!important;overflow:hidden!important}" +
  "body{display:flex!important;flex-direction:column!important;" +
  "align-items:stretch!important;justify-content:flex-start!important}" +
  "body>*{width:100%!important;max-width:none!important;" +
  "margin-left:0!important;margin-right:0!important;box-sizing:border-box!important}" +
  'body>div[class*="min-h-screen"],body>div[class*="justify-center"]{' +
  "display:flex!important;flex-direction:column!important;" +
  "align-items:stretch!important;justify-content:flex-start!important;" +
  "min-height:0!important;flex:1 1 auto!important;height:100%!important;width:100%!important;" +
  "overflow:hidden!important}" +
  "header{flex:0 0 auto!important;width:100%!important}" +
  "main{flex:1 1 auto!important;min-height:0!important;width:100%!important;" +
  "overflow-y:auto!important;overflow-x:hidden!important;" +
  "-webkit-overflow-scrolling:touch}" +
  "nav{display:flex!important;flex-direction:row!important;" +
  "justify-content:space-around!important;align-items:center!important;" +
  "flex:0 0 auto!important;width:100%!important}";

/**
 * 桌面页铺满 1920×1080（2026-08-20 满电青年）。
 *
 * 模型把 aside+header+main 塞进 max-w-6xl mx-auto 白卡片，body 浅绿底
 * + items-center justify-center。画布是满的，应用缩在正中。手机页已有
 * 铺满层，桌面漏了。与 Python page_shell._DESKTOP_FILL_CSS 同文。
 *
 * ⚠ 不许抄手机的 body>*{margin-left:0}：fixed 侧栏靠 ml-16/ml-64 让位。
 * ⚠ 不许给 body 写 flex-direction:column：aside 和 main 会被竖着叠。
 */
export const DESKTOP_FILL_STYLE_ID = "sliderule-desktop-fill";
export const DESKTOP_FILL_CSS =
  "html,body{margin:0!important;width:100%!important;height:100%!important;" +
  "min-height:100%!important;max-width:none!important;overflow:hidden!important}" +
  "body{align-items:stretch!important;justify-content:flex-start!important;" +
  "padding:0!important}" +
  'body>[class*="mx-auto"]{' +
  "max-width:none!important;width:100%!important;height:100%!important;" +
  "margin:0!important;box-sizing:border-box!important;" +
  "border-radius:0!important;box-shadow:none!important}" +
  'body>div[class*="min-h-screen"],body>div[class*="justify-center"]{' +
  "display:flex!important;align-items:stretch!important;" +
  "justify-content:flex-start!important;" +
  "width:100%!important;height:100%!important;max-width:none!important;" +
  "padding:0!important;margin:0!important;box-sizing:border-box!important}" +
  'body>div[class*="min-h-screen"]>[class*="mx-auto"],' +
  'body>div[class*="min-h-screen"]>[class*="max-w-"],' +
  'body>div[class*="justify-center"]>[class*="mx-auto"],' +
  'body>div[class*="justify-center"]>[class*="max-w-"]{' +
  "max-width:none!important;width:100%!important;height:100%!important;" +
  "margin:0!important;box-sizing:border-box!important;" +
  "border-radius:0!important;box-shadow:none!important}";

/** 浅色壳上盖掉模型按深色写的白字 / 白高亮 / 顶栏深按钮。与 Python
 *  theme_tokens._chrome_contrast_css 同文。已生成的页刷新即生效。
 *
 *  2026-08-20 第二趟：品牌行 items-center（对照 shadcn SidebarMenuButton）；
 *  有文字的侧栏锁 16rem（对照 --sidebar-width）；header 的 bg-zinc-950
 *  也改写成 muted，浅色顶栏右侧不再是一块黑开关。 */
export const CHROME_CONTRAST_STYLE_ID = "sliderule-chrome-contrast";
export const CHROME_CONTRAST_CSS =
  'html[data-theme="light"] header .text-white,html[data-theme="light"] header .text-slate-100,html[data-theme="light"] header .text-slate-200,html[data-theme="light"] header .text-gray-100,html[data-theme="light"] aside .text-white,html[data-theme="light"] aside .text-slate-100,html[data-theme="light"] aside .text-slate-200,html[data-theme="light"] aside .text-gray-100{color:var(--chrome-fg,#0f172a)!important}' +
  'html[data-theme="light"] header .bg-black,html[data-theme="light"] header .bg-slate-800,html[data-theme="light"] header .bg-slate-900,html[data-theme="light"] header .bg-slate-950,html[data-theme="light"] header .bg-gray-800,html[data-theme="light"] header .bg-gray-900,html[data-theme="light"] header .bg-gray-950,html[data-theme="light"] header .bg-zinc-800,html[data-theme="light"] header .bg-zinc-900,html[data-theme="light"] header .bg-zinc-950,html[data-theme="light"] header .bg-neutral-800,html[data-theme="light"] header .bg-neutral-900,html[data-theme="light"] header .bg-neutral-950,html[data-theme="light"] header .bg-stone-800,html[data-theme="light"] header .bg-stone-900,html[data-theme="light"] header .bg-stone-950{background-color:var(--muted)!important;color:var(--chrome-fg,#0f172a)!important}' +
  "aside nav a{box-sizing:border-box;width:100%;display:flex!important;flex-direction:row!important;align-items:center!important;gap:.5rem}" +
  "aside>:first-child:not(nav):not(:has(nav)){display:flex!important;flex-direction:row!important;align-items:center!important;gap:.5rem}" +
  "aside :is(img,svg){flex-shrink:0}" +
  "aside:has(nav a){min-width:16rem!important;box-sizing:border-box}" +
  'aside[class*="fixed"]:has(nav a),aside[class*="absolute"]:has(nav a){width:16rem!important}' +
  'aside[class*="fixed"]:has(nav a)~*,aside[class*="absolute"]:has(nav a)~*{margin-left:16rem!important}' +
  'aside [aria-current="page"]{background-color:color-mix(in srgb,var(--primary,currentColor) 16%,var(--chrome,transparent))!important;color:var(--chrome-fg,inherit)!important;font-weight:600}' +
  'header nav[aria-label="Breadcrumb"] [aria-current="page"],header nav[aria-label="breadcrumb"] [aria-current="page"]{background-color:transparent!important;color:var(--chrome-fg,inherit)!important;font-weight:600}';

function injectHeadStyle(html: string, id: string, css: string): string {
  if (!html) return html;
  if (html.includes(`id="${id}"`)) {
    return html.replace(
      new RegExp(`(<style id="${id}">)[\\s\\S]*?(</style>)`, "i"),
      `$1${css}$2`
    );
  }
  const tag = `<style id="${id}">${css}</style>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const htmlOpen = html.match(/<html[^>]*>/i);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${tag}</head>` + html.slice(at);
  }
  return tag + html;
}

export function applyPhoneViewportFill(html: string): string {
  return injectHeadStyle(html, PHONE_FILL_STYLE_ID, PHONE_FILL_CSS);
}

export function applyDesktopViewportFill(html: string): string {
  return injectHeadStyle(html, DESKTOP_FILL_STYLE_ID, DESKTOP_FILL_CSS);
}

export function applyChromeContrast(html: string): string {
  return injectHeadStyle(html, CHROME_CONTRAST_STYLE_ID, CHROME_CONTRAST_CSS);
}

/** 铺满 + 对比合成一张。对照 Gutenberg iframe 把覆盖样式写进初始 HTML、
 *  Stylus 只挂一张 user style——两张表抢 lastElementChild 会把观察器踢死。 */
export const PREVIEW_CHROME_STYLE_ID = "sliderule-preview-chrome";

export function previewChromeCss(fillPhone: boolean): string {
  return (fillPhone ? PHONE_FILL_CSS : DESKTOP_FILL_CSS) + CHROME_CONTRAST_CSS;
}

export function applyPreviewChrome(html: string, fillPhone = false): string {
  return injectHeadStyle(html, PREVIEW_CHROME_STYLE_ID, previewChromeCss(fillPhone));
}

/** 把铺满样式钉到 head 末尾。Tailwind Play 后注的 utility 没有 !important，后到也能被盖住。 */
function pinFillStyle(doc: Document, id: string, css: string): void {
  const head = doc.head;
  if (!head) return;
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = id;
    el.textContent = css;
  } else if (el.textContent !== css) {
    el.textContent = css;
  }
  if (head.lastElementChild !== el) head.appendChild(el);
}

export function pinPhoneFillStyle(doc: Document): void {
  pinFillStyle(doc, PHONE_FILL_STYLE_ID, PHONE_FILL_CSS);
}

export function pinDesktopFillStyle(doc: Document): void {
  pinFillStyle(doc, DESKTOP_FILL_STYLE_ID, DESKTOP_FILL_CSS);
}

export function pinChromeContrastStyle(doc: Document): void {
  pinFillStyle(doc, CHROME_CONTRAST_STYLE_ID, CHROME_CONTRAST_CSS);
}

export function pinPreviewChromeStyles(doc: Document, fillPhone: boolean): void {
  pinFillStyle(doc, PREVIEW_CHROME_STYLE_ID, previewChromeCss(fillPhone));
}

/**
 * Tailwind 后注 utility 时，把覆盖表再挪到 head 末尾。
 *
 * 对照 tailwindcss `@tailwindcss-browser`（v4.1.11
 * packages/@tailwindcss-browser/src/index.ts）：
 *
 *     // Skip the output stylesheet itself to prevent loops
 *     if (node === sheet) continue
 *
 * ⚠ 2026-08-20 满电青年：对比层和铺满层各 appendChild 抢末位，观察器
 * 互踢把主线程钉死。标准答案不是两层各 disconnect，是**一张 sheet**，
 * 回调里跳过自己。Gutenberg iframe 也是覆盖样式进初始 HTML、按 id 只挂一次。
 */
export function watchPreviewChromePin(
  doc: Document,
  fillPhone: boolean
): MutationObserver | null {
  const head = doc.head;
  if (!head || typeof MutationObserver === "undefined") {
    pinPreviewChromeStyles(doc, fillPhone);
    return null;
  }
  pinPreviewChromeStyles(doc, fillPhone);
  const mo = new MutationObserver(records => {
    const ours = doc.getElementById(PREVIEW_CHROME_STYLE_ID);
    let foreign = 0;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Skip the output stylesheet itself to prevent loops
        if (node === ours) continue;
        foreign += 1;
      }
    }
    if (foreign === 0) return;
    pinPreviewChromeStyles(doc, fillPhone);
  });
  mo.observe(head, { childList: true });
  return mo;
}

/**
 * Tailwind 从**自己的源**取，不走 cdn.tailwindcss.com。
 *
 * ⚠ 这条是线上打脸打出来的（2026-08-14）：右侧渲染出来一条 CSS 都没有。
 * 页面的全部样式都靠这一个脚本，而那个域在国内经常连不上——这个仓的容器里
 * 就一直连不上（离线渲染得靠 Playwright 路由拦截喂本地）。
 * **把产品可用性押在一个境外 CDN 上是不成立的。**
 *
 * 固化的那份见 client/public/vendor/（含更新方式与"必须是 v3"的理由）。
 */
const TAILWIND_SRC = "/vendor/tailwind-play-3.js";

/**
 * 从页面自带的 `tailwind.config = {...}` 里**读出**颜色表。
 *
 * ⚠ 读，不是执行。匹配 `名字: '#rrggbb'` 与 `名字: { 500: '#rrggbb' }` 两种形状，
 * 其它一律忽略。读不出来就返回空——**宁可没有自定义配色，也不在同源文档里
 * 跑模型写的 JS**。
 */
export function extractPalette(html: string): Record<string, Record<string, string> | string> {
  const m = (html || "").match(/tailwind\.config\s*=\s*\{[\s\S]*?colors\s*:\s*\{([\s\S]*?)\n\s*\}/);
  if (!m) return {};
  const body = m[1];
  const out: Record<string, Record<string, string> | string> = {};
  // 嵌套色阶：brand: { 50: '#effcf8', 500: '#13b58c' }
  const nested = /([A-Za-z_][\w-]*)\s*:\s*\{([^{}]*)\}/g;
  let n: RegExpExecArray | null;
  while ((n = nested.exec(body)) !== null) {
    const scale: Record<string, string> = {};
    const pair = /(['"]?)([\w-]+)\1\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g;
    let s: RegExpExecArray | null;
    while ((s = pair.exec(n[2])) !== null) scale[s[2]] = s[3];
    if (Object.keys(scale).length > 0) out[n[1]] = scale;
  }
  // 平铺色：ink: '#172b4d'
  const flat = /([A-Za-z_][\w-]*)\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g;
  let f: RegExpExecArray | null;
  while ((f = flat.exec(body)) !== null) {
    if (!(f[1] in out)) out[f[1]] = f[2];
  }
  return out;
}

const ALLOWED_TAGS = [
  "html", "head", "body", "title", "meta",
  "div", "span", "p", "section", "article", "header", "footer", "main", "aside",
  "nav", "h1", "h2", "h3", "h4", "h5", "h6", "form", "label", "fieldset", "legend",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "em", "b", "i", "u", "s", "small", "mark", "code", "pre", "blockquote",
  "hr", "br", "wbr", "style",
  "img", "picture", "source", "figure", "figcaption", "a", "link",
  "details", "summary", "time", "abbr", "kbd", "samp", "var", "sub", "sup",
  // 表单控件：「能读能写」正是这条链路存在的理由，不放开等于整页只剩文字
  "input", "select", "option", "optgroup", "textarea", "button", "progress", "meter",
  "svg", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask",
  "text", "tspan", "use", "symbol", "desc", "pattern", "filter",
  "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
];

const ALLOWED_ATTR = [
  "class", "style", "id", "title", "colspan", "rowspan", "scope", "lang", "dir",
  "role", "tabindex", "datetime", "open", "charset", "content", "http-equiv", "name",
  "aria-label", "aria-hidden", "aria-describedby", "aria-current", "aria-expanded",
  "hidden", "data-state",
  "type", "value", "placeholder", "checked", "selected", "disabled",
  "readonly", "required", "min", "max", "step", "rows", "cols", "for", "maxlength",
  "src", "srcset", "sizes", "alt", "loading", "decoding", "referrerpolicy",
  "href", "target", "rel", "media", "crossorigin",
  "viewBox", "preserveAspectRatio", "xmlns", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-opacity",
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "points", "opacity", "transform", "offset", "stop-color",
  "stop-opacity", "gradientUnits", "gradientTransform", "clip-path", "mask",
  "text-anchor", "dominant-baseline", "font-size", "font-weight", "font-family",
  "dx", "dy", "patternUnits",
  // 导航切页的锚点（page_shell 打的）。⚠ 漏了它左侧菜单就点不动，
  // 而且不会有任何一处报错——菜单还在，只是点了没反应。
  "data-page-id",
  // 绑定词汇 —— 从解释器 import，不手抄
  ...BINDING_ATTRS,
];

//: 只剩可执行内容与能改变文档基址的东西。**这是这一层唯一的安全边界。**
const FORBID_TAGS = ["script", "iframe", "object", "embed", "base", "template"];

type PurifyLike = {
  sanitize?: (s: string, c: object) => string;
  addHook?: (name: string, cb: (node: Element) => void) => void;
};

let hooksInstalled = false;

function installHooks(p: PurifyLike): void {
  if (hooksInstalled || typeof p.addHook !== "function") return;
  p.addHook("afterSanitizeAttributes", (node) => {
    const href = node.getAttribute?.("href");
    if (href && /^\s*data:/i.test(href)) node.removeAttribute("href");
  });
  hooksInstalled = true;
}

/**
 * 消毒。**没有 DOM 就返回空串** —— 消毒不了就不渲染。
 *
 * `WHOLE_DOCUMENT: true`：进来的是整份文档（`<!DOCTYPE><html><head>`），
 * 不开这个开关 DOMPurify 会把 html/head/body 拆掉，`<style>` 和 `<meta>` 跟着
 * 散架——那正是 08-14 那版"一堆裸文字"的另一半原因。
 */
export function stripOrphanCommentClosers(html: string): string {
  /**
   * ⚠ 2026-08-20 满电青年：page_shell 把 ``<!-- 左侧导航 <aside>`` 捞出来
   * 之后，闭合 ``-->`` 变成 body 里第一段文字，顶在预览左上角。
   * 消毒层不会当注释删——它已经不是注释了。这里与 Python
   * ``_ORPHAN_COMMENT_CLOSE`` 同形，已闭合的 ``<!-- 主正文 <main> -->``
   * 碰不到（那是开标签后面的 -->）。
   */
  return (html || "").replace(
    /(<\/(?:aside|nav|header|main|div)\s*>|<body\b[^>]*>)\s*-->/gi,
    "$1"
  );
}

export function sanitizeAppHtml(markup: string): string {
  const purify = DOMPurify as unknown as PurifyLike;
  if (typeof purify.sanitize !== "function") return "";
  installHooks(purify);
  return purify.sanitize(stripOrphanCommentClosers(markup || ""), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    WHOLE_DOCUMENT: true,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

/** 注入 Tailwind + 我们读出来的配色。**只有这一段脚本会跑。** */
function buildDocument(pageHtml: string, fillPhone = false): string {
  const clean = sanitizeAppHtml(pageHtml);
  if (!clean) return "";
  const page = applyPreviewChrome(clean, fillPhone);
  const palette = extractPalette(pageHtml);
  const cfg = `window.tailwind=window.tailwind||{};`
    + `window.tailwind.config={theme:{extend:{colors:${JSON.stringify(palette)}}}};`;
  // ⚠ config 必须在 CDN 脚本**之前**赋值：Play CDN 加载即刻编译一遍，
  //   晚了的话首屏那一版没有自定义色，闪一下才变过来。
  const inject = `<script>${cfg}</script><script src="${TAILWIND_SRC}"></script>`;
  const m = page.match(/<head[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return page.slice(0, at) + inject + page.slice(at);
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${inject}</head>`
    + `<body>${page}</body></html>`;
}

export interface HtmlAppSurfaceProps {
  html: string;
  source: BindingSource;
  /** 角色上下文（权限门）。不传 = 不设卡。宿主务必 memo——它进 effect 依赖。 */
  gates?: ActionGates;
  /** 点了带 data-action 的东西 */
  onAction?: (event: BindingActionEvent) => void;
  /** 点了左侧菜单里的某一项（data-page-id） */
  onNavigate?: (pageId: string) => void;
  /** 游标：鼠标停在某个带绑定的元素上 */
  onHoverBinding?: (info: { attr: string; value: string; el: Element } | null) => void;
  onReport?: (report: ApplyBindingsReport & { hasDataSource: boolean }) => void;
  /** 手机画布：把套在 max-w-md 里的机模撑满 390×844。桌面页不要开。 */
  fillPhone?: boolean;
  className?: string;
}

/**
 * 挂载 + 填数 + 接线。
 *
 * ⚠ 顺序：消毒 → 写进框 → 等 Tailwind 就绪 → applyBindings → 接事件。
 * 填数必须在写进框**之后**（要真实 DOM），接事件必须在填数**之后**
 * （行是填数时建出来的，早了就只给模板绑了一个）。
 */
export function HtmlAppSurface({
  html,
  source,
  gates,
  onAction,
  onNavigate,
  onHoverBinding,
  onReport,
  fillPhone = false,
  className = "",
}: HtmlAppSurfaceProps): React.ReactElement {
  const ref = React.useRef<HTMLIFrameElement | null>(null);
  // 回调放 ref：它们几乎每次渲染都是新函数，进依赖数组会让整框反复重写，
  // 表现是页面闪、输入框失焦。
  const cbs = React.useRef({ onAction, onNavigate, onHoverBinding, onReport });
  cbs.current = { onAction, onNavigate, onHoverBinding, onReport };

  React.useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const doc = buildDocument(html, fillPhone);
    if (!doc) return;
    let disposed = false;
    let fillMo: MutationObserver | null = null;
    let wired = false;
    let unwireOverlays: (() => void) | null = null;

    const onLoad = () => {
      if (disposed || wired) return;
      const d = frame.contentDocument;
      if (!d || !d.body) return;
      // about:blank 在 srcdoc 真正写进去之前也会 complete。空 body 不算接好。
      if (!d.body.childNodes.length && !d.head?.childNodes.length) return;
      wired = true;

      // Tailwind Play 扫完 DOM 会再往 head 注一层 utility。
      // 铺满样式若停在那一层前面，items-center 会把整页重新居中——
      // 真机表现就是「刚铺满，过一秒又缩回屏幕中间一张卡片」。
      // 一张覆盖表 + 跳过自己（Tailwind browser `node === sheet`）。
      fillMo = watchPreviewChromePin(d, fillPhone);
      if (disposed) {
        fillMo?.disconnect();
        fillMo = null;
        return;
      }

      const report = applyBindings(d.body, {
        source,
        gates,
        onAction: e => cbs.current.onAction?.(e),
      });
      cbs.current.onReport?.({ ...report, hasDataSource: hasAnyDataSource(d.body) });

      // 抽屉开/关：页面 script 被摘了，对照 Radix Dialog 的 onOpenChange
      // 由宿主接。必须赶在切页监听之前挂到 document（捕获阶段比 body 早），
      // 打开态遮罩上的点击先被认成关闭，不会误切页。
      unwireOverlays = wireOverlays(d);

      // 左侧菜单切页：认 data-page-id，**不认标签文字**（名字会重复、会被改写）
      d.body.addEventListener("click", ev => {
        const el = (ev.target as Element | null)?.closest?.("[data-page-id]");
        const pid = el?.getAttribute("data-page-id");
        if (pid) {
          ev.preventDefault();
          ev.stopPropagation();
          cbs.current.onNavigate?.(pid);
        }
      }, true);

      // 游标：把鼠标下那个带绑定的元素报出去，宿主据它查五系统声明
      if (cbs.current.onHoverBinding) {
        const sel = BINDING_ATTRS.map(a => `[${a}]`).join(",");
        d.body.addEventListener("mouseover", ev => {
          const el = (ev.target as Element | null)?.closest?.(sel);
          if (!el) return;
          const attr = BINDING_ATTRS.find(a => el.hasAttribute(a));
          if (attr) {
            cbs.current.onHoverBinding?.({ attr, value: el.getAttribute(attr) || "", el });
          }
        });
        d.body.addEventListener("mouseleave", () => cbs.current.onHoverBinding?.(null));
      }
    };
    // ⚠ 监听必须赶在 srcdoc 赋值之前。srcdoc 有时同步触发 load，
    //   先赋值后挂监听 = 切页回调永远接不上，菜单点了像没点。
    frame.addEventListener("load", onLoad);
    frame.srcdoc = doc;
    onLoad();
    return () => {
      disposed = true;
      unwireOverlays?.();
      fillMo?.disconnect();
      frame.removeEventListener("load", onLoad);
    };
    // gates 进依赖：切角色必须重填一遍（锁上/解锁）。整框重载可接受——
    // 切角色不是高频操作，且 srcdoc 重写才能把上一轮的行内监听整批清干净。
  }, [html, source, gates, fillPhone]);

  return (
    <iframe
      ref={ref}
      title="生成的应用"
      // ⚠ 没有 sandbox：要同源才够得到 contentDocument（填数/点击/游标/切页
      //   全靠它）。安全边界是上面的 DOMPurify——页面里的脚本在写进来之前
      //   就没了，框里跑的只有我们自己注入的 Tailwind。
      referrerPolicy="no-referrer"
      data-testid="html-app-surface"
      className={`h-full w-full border-0 ${className || "bg-white"}`}
    />
  );
}
