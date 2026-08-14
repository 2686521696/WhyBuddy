/**
 * 交付物换成 HTML 载体：把 spec-first 画出来的整页打成**一个自包含文件**。
 *
 * ## 为什么是"一个文件"而不是 zip
 *
 * 交付物原来是一份 .md——描述这次推演，但**拿不到产物本身**。新链路的产出
 * 是一整套能独立打开的 HTML，那才是这次要交的东西。
 *
 * 打成 zip 要引打包库，而且用户拿到还得解压、还得找入口。单个 HTML 文件：
 * 双击就开、能直接发给别人、能存进任何地方，跟"HTML 载体"这条路线本身
 * 是一回事。⚠ 不引新依赖这条是本仓的老规矩（tenacity / LangGraph 那几次）。
 *
 * ## 页面用 base64 塞，不用字符串拼
 *
 * 第一反应是把每页塞进 `<script type="text/plain">`。**那是错的**：生成的页面
 * 里本来就有 `<script src="https://cdn.tailwindcss.com">`，于是内容里含
 * `</script>`——HTML 解析器看到它就当外层脚本结束了，后面的东西全散架。
 * 塞进 srcdoc 属性同样有转义地狱（引号 + & + 换行）。
 *
 * base64 把这两类问题一次性消掉：内容变成纯 ASCII，没有任何字符能提前
 * 终结宿主结构。中文靠 TextEncoder/TextDecoder 走 UTF-8，不用 escape/unescape
 * 那套已废弃的写法。
 *
 * ⚠ 大字符串不能 `btoa(String.fromCharCode(...bytes))`：25KB 的页面展开成
 * 两万多个实参，V8 会 RangeError（Maximum call stack size exceeded）。分块。
 *
 * ## 里面照样是沙箱
 *
 * 交付包在**别人的机器上**打开，内容仍然是模型生成的。所以每页还是走
 * `sandbox="allow-scripts"`（不给 allow-same-origin）+ 框内 CSP，判据与理由
 * 跟 sandboxed-page-frame.tsx 一致——那边是产品内，这边是离线包，
 * **威胁模型一样，所以口径也一样**。
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export const DELIVERY_HTML_VERSION = "sliderule-delivery-html-v1";

/** 与 sandboxed-page-frame.tsx 同一份口径。改这里就要同时改那里（有判据钉着）。 */
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https:",
  "img-src data: https: blob:",
  "font-src data: https:",
  "media-src data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

/** UTF-8 → base64。⚠ 分块，见文件头那条 RangeError。 */
export function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const CHUNK = 0x8000; // 32K 实参，稳在各引擎的 apply 上限之内
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 只用于宿主外壳里的可见文字（页名/标题），不用于页面内容。 */
function escapeText(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把 CSP 插到 `<head>` 开标签紧后 —— meta 形式只对其后解析的内容生效。 */
function withCsp(raw: string): string {
  const html = raw || "";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
  const m = html.match(/<head[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return html.slice(0, at) + meta + html.slice(at);
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${meta}`
    + `<script src="https://cdn.tailwindcss.com"></script></head><body>${html}</body></html>`;
}

export interface DeliveryPage {
  id: string;
  /** 导航上显示的名字；缺省用 id */
  name?: string;
  html: string;
}

export interface SerializeDeliveryHtmlOpts {
  appTitle?: string;
  /** 推演说明（现有的 .md 交付内容）——并进来当"推演说明"那一页 */
  notesMd?: string | null;
  generatedAt?: string;
}

/**
 * 打包。返回一份完整 HTML 文档的字符串。
 *
 * 页面为空时返回空串——**不产出一个只有空壳的包**。交付一个点开什么都没有的
 * 文件，比不交付更糟：它看着像交付成功了。
 */
export function serializeSlideRuleDeliveryHtml(
  pages: DeliveryPage[],
  opts: SerializeDeliveryHtmlOpts = {}
): string {
  const list = (pages || []).filter(p => p && p.html);
  if (list.length === 0) return "";

  const title = opts.appTitle?.trim() || "推演应用";
  const at = opts.generatedAt || new Date().toISOString();
  const payload = list.map(p => ({
    id: p.id,
    name: p.name || p.id,
    b64: toBase64Utf8(withCsp(p.html)),
  }));
  const notes = opts.notesMd ? toBase64Utf8(opts.notesMd) : "";

  // ⚠ 数据走 JSON.stringify 之后再把 `<` 转义掉：JSON 里出现 `</script>`
  //   同样会提前终结宿主脚本（页面 id 理论上可以是任意字符串）。
  const data = JSON.stringify({ title, at, pages: payload, notes })
    .replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)} · 交付包</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;font:14px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#172b4d;background:#f6f8fb}
.wrap{display:flex;height:100%}
.side{width:220px;flex:none;background:#fff;border-right:1px solid #e5e7eb;display:flex;flex-direction:column}
.brand{padding:14px 16px;border-bottom:1px solid #eef1f5}
.brand b{display:block;font-size:14px}
.brand span{font-size:11px;color:#8895a7}
.nav{flex:1;overflow:auto;padding:8px}
.nav button{display:block;width:100%;text-align:left;padding:8px 10px;margin:2px 0;border:0;border-radius:8px;background:transparent;font:inherit;color:#48566a;cursor:pointer}
.nav button:hover{background:#f1f4f8}
.nav button[aria-current="true"]{background:#1677ff;color:#fff}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.bar{padding:8px 14px;font-size:12px;color:#8895a7;border-bottom:1px solid #eef1f5;background:#fff}
.stage{flex:1;min-height:0}
iframe{width:100%;height:100%;border:0;background:#fff}
pre.notes{margin:0;padding:20px 24px;white-space:pre-wrap;word-break:break-word;overflow:auto;height:100%;background:#fff;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
</style>
</head>
<body>
<div class="wrap">
  <aside class="side">
    <div class="brand"><b>${escapeText(title)}</b><span>推演交付包</span></div>
    <nav class="nav" id="nav"></nav>
  </aside>
  <main class="main">
    <div class="bar" id="bar"></div>
    <div class="stage" id="stage"></div>
  </main>
</div>
<script>
(function(){
  var D = ${data};
  var nav = document.getElementById("nav");
  var bar = document.getElementById("bar");
  var stage = document.getElementById("stage");
  function decode(b64){
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(out);
  }
  var items = D.pages.slice();
  if (D.notes) items.push({ id:"__notes__", name:"推演说明", b64:D.notes, notes:true });
  var cur = null;
  function show(id){
    cur = id;
    var it = items.filter(function(x){ return x.id === id; })[0];
    if (!it) return;
    [].forEach.call(nav.children, function(b){
      b.setAttribute("aria-current", String(b.dataset.id === id));
    });
    stage.innerHTML = "";
    if (it.notes){
      var pre = document.createElement("pre");
      pre.className = "notes";
      pre.textContent = decode(it.b64);
      stage.appendChild(pre);
    } else {
      // ⚠ 沙箱口径跟产品里一致：allow-scripts 但**不给** allow-same-origin。
      //    这个包会在别人的机器上打开，内容仍然是模型生成的。
      var f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.setAttribute("referrerpolicy", "no-referrer");
      f.srcdoc = decode(it.b64);
      stage.appendChild(f);
    }
    bar.textContent = it.notes ? "推演说明" : (it.name + "　·　" + D.pages.length + " 页　·　生成于 " + D.at);
  }
  items.forEach(function(it){
    var b = document.createElement("button");
    b.type = "button"; b.textContent = it.name; b.dataset.id = it.id;
    b.onclick = function(){ show(it.id); };
    nav.appendChild(b);
  });
  show(items[0].id);
})();
</script>
</body>
</html>`;
}

/** 从会话状态里取出可交付的页面（落库那份是唯一来源）。 */
export function deliveryPagesFromState(state: V5SessionState): DeliveryPage[] {
  const sp = (state as unknown as {
    specFirstPages?: { pages?: Record<string, string>; navItems?: Array<{ id?: string; label?: string }> };
  }).specFirstPages;
  const pages = sp?.pages;
  if (!pages || typeof pages !== "object") return [];
  // 导航顺序照 navItems（page_shell 按 spec.pages 重排过的那份）。
  // ⚠ 不靠 Object.keys 的顺序：第 3 步改成 as_completed 之后**产出顺序就是
  //   完成顺序**，跟 spec 里的页面顺序无关了。拿它当导航顺序会让页面乱序。
  const order = (sp?.navItems || [])
    .map(n => String(n?.id || ""))
    .filter(id => id && pages[id]);
  const rest = Object.keys(pages).filter(id => !order.includes(id));
  return [...order, ...rest].map(id => {
    const nav = (sp?.navItems || []).find(n => String(n?.id || "") === id);
    return { id, name: nav?.label || id, html: pages[id] };
  });
}

export function downloadSlideRuleDeliveryHtml(
  state: V5SessionState,
  opts: SerializeDeliveryHtmlOpts = {},
  filename?: string
): boolean {
  const pages = deliveryPagesFromState(state);
  const html = serializeSlideRuleDeliveryHtml(pages, opts);
  if (!html) return false; // 没有页面就如实不交付，由调用方回落 .md
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `sliderule-app-${state.sessionId || "session"}-${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
