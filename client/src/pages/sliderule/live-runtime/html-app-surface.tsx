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
  type ApplyBindingsReport,
  type BindingActionEvent,
  type BindingSource,
} from "./html-binding-runtime";

export const HTML_APP_SURFACE_VERSION = "html-app-surface-v1";

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
export function sanitizeAppHtml(markup: string): string {
  const purify = DOMPurify as unknown as PurifyLike;
  if (typeof purify.sanitize !== "function") return "";
  installHooks(purify);
  return purify.sanitize(markup || "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    WHOLE_DOCUMENT: true,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

/** 注入 Tailwind + 我们读出来的配色。**只有这一段脚本会跑。** */
function buildDocument(pageHtml: string): string {
  const clean = sanitizeAppHtml(pageHtml);
  if (!clean) return "";
  const palette = extractPalette(pageHtml);
  const cfg = `window.tailwind=window.tailwind||{};`
    + `window.tailwind.config={theme:{extend:{colors:${JSON.stringify(palette)}}}};`;
  // ⚠ config 必须在 CDN 脚本**之前**赋值：Play CDN 加载即刻编译一遍，
  //   晚了的话首屏那一版没有自定义色，闪一下才变过来。
  const inject = `<script>${cfg}</script><script src="${TAILWIND_SRC}"></script>`;
  const m = clean.match(/<head[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return clean.slice(0, at) + inject + clean.slice(at);
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${inject}</head>`
    + `<body>${clean}</body></html>`;
}

export interface HtmlAppSurfaceProps {
  html: string;
  source: BindingSource;
  /** 点了带 data-action 的东西 */
  onAction?: (event: BindingActionEvent) => void;
  /** 点了左侧菜单里的某一项（data-page-id） */
  onNavigate?: (pageId: string) => void;
  /** 游标：鼠标停在某个带绑定的元素上 */
  onHoverBinding?: (info: { attr: string; value: string; el: Element } | null) => void;
  onReport?: (report: ApplyBindingsReport & { hasDataSource: boolean }) => void;
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
  onAction,
  onNavigate,
  onHoverBinding,
  onReport,
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
    const doc = buildDocument(html);
    if (!doc) return;
    let disposed = false;

    frame.srcdoc = doc;
    const onLoad = () => {
      if (disposed) return;
      const d = frame.contentDocument;
      if (!d || !d.body) return;

      const report = applyBindings(d.body, {
        source,
        onAction: e => cbs.current.onAction?.(e),
      });
      cbs.current.onReport?.({ ...report, hasDataSource: hasAnyDataSource(d.body) });

      // 左侧菜单切页：认 data-page-id，**不认标签文字**（名字会重复、会被改写）
      d.body.addEventListener("click", ev => {
        const el = (ev.target as Element | null)?.closest?.("[data-page-id]");
        const pid = el?.getAttribute("data-page-id");
        if (pid) {
          ev.preventDefault();
          cbs.current.onNavigate?.(pid);
        }
      });

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
    frame.addEventListener("load", onLoad);
    return () => {
      disposed = true;
      frame.removeEventListener("load", onLoad);
    };
  }, [html, source]);

  return (
    <iframe
      ref={ref}
      title="生成的应用"
      // ⚠ 没有 sandbox：要同源才够得到 contentDocument（填数/点击/游标/切页
      //   全靠它）。安全边界是上面的 DOMPurify——页面里的脚本在写进来之前
      //   就没了，框里跑的只有我们自己注入的 Tailwind。
      referrerPolicy="no-referrer"
      data-testid="html-app-surface"
      className={`h-full w-full border-0 bg-white ${className}`}
    />
  );
}
