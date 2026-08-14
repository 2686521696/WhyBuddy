/**
 * 把生成的整页 HTML 放进沙箱 iframe 渲染。
 *
 * ## 为什么必须换掉 Shadow DOM 这条路
 *
 * 2026-08-14 真机跑一趟看到的：右侧渲染出来是一堆裸文字加一个撑满屏的蓝色
 * 图标——**一条 CSS 都没生效**。查下来不是样式丢了，是样式压根没来过：
 *
 *     <script src="https://cdn.tailwindcss.com"></script>   ← 整页的排版全靠它
 *     <script>tailwind.config = { colors: { brand… } }</script>  ← 自定义配色
 *
 * 页面的**全部**样式来自这两个 script。宿主消毒层的 FORBID_TAGS 把 script 一律
 * 摘掉（这在它自己的语境里是对的），于是所有 Tailwind 类名当场变成死字符串。
 *
 * ⚠ 这不是"放行 script 就能修"。Tailwind Play CDN 是**运行时 JIT**：它扫描
 * document 再往 `document.head` 注一段 `<style>`。影子根里的元素它扫不到，
 * 注出来的样式也跨不过影子边界。**Shadow DOM 与 CDN 版 Tailwind 在原理上
 * 不兼容**，不是配置问题。
 *
 * ## 抄的是业界标准答案
 *
 * 渲染"模型刚生成的一整页 HTML"，v0 / bolt.new / abi/screenshot-to-code 用的
 * 都是同一件东西：**srcdoc + sandbox 的 iframe**。理由三条，条条对得上这里：
 *
 *   · 样式隔离比 Shadow DOM 彻底（另一个 document，连继承都断干净）
 *   · 页面本来就是完整文档（<!DOCTYPE><html><head>），iframe 原生就吃这个；
 *     塞进影子根反而要把 html/head/body 拆掉——那正是现在这堆裸文字的由来
 *   · 脚本能跑，而且跑在**不透明源**里
 *
 * ## 边界在哪：sandbox 挡什么、不挡什么
 *
 * `sandbox="allow-scripts"` 且**不给** `allow-same-origin` ⇒ 文档是不透明源。
 * 里面的脚本：
 *     ✔ 拿不到父页面 DOM / cookie / localStorage / 同源接口
 *     ✔ 改不了地址栏（没有 allow-top-navigation）
 *     ✔ 弹不出 modal（没有 allow-modals）
 *
 * 剩下两个风险由 srcdoc 里那条 CSP 收掉——**这条是这一层真正的安全判据**，
 * 不是 sandbox 属性本身：
 *     connect-src 'none'   脚本发不出 fetch/XHR/WebSocket ⇒ 外带不出去
 *     form-action 'none'   表单提交不出去 ⇒ 框里画个假登录页也骗不走东西
 *
 * ⚠ 明说一句：**这一层不再由 DOMPurify 兜底**。消毒器和"让脚本跑"是互斥的
 * 两个要求，二选一。选沙箱是因为不让脚本跑等于这个功能不存在（见上面那张
 * 零 CSS 的截图）。DOMPurify 那层留着给"不需要脚本的 HTML"用，没有删。
 */

import React from "react";

export const SANDBOXED_PAGE_FRAME_VERSION = "sandboxed-page-frame-v1";

/**
 * 框内 CSP。**这是这一层的安全判据本身**，改它等于改安全边界。
 *
 * ⚠ 顺序与取值都别凭感觉调：
 *   script-src 必须带 'unsafe-inline'——页面里那段 `tailwind.config = {…}`
 *     是内联的，去掉它配色就没了（但类名还在，于是"半有样式"，比全没有更难查）
 *   style-src  同理，Play CDN 注出来的就是内联 <style>
 *   connect-src 'none' 是**外带的闸**，任何时候都不许放开
 */
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com",
  "style-src 'unsafe-inline' https:",
  "img-src data: https: blob:",
  "font-src data: https:",
  "media-src data: https:",
  // 外带与钓鱼这两条是这一层真正挡住的东西
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

/** 兜底底样式：CDN 挂了的时候至少不是一坨堆在左上角的裸文字。 */
const FALLBACK_CSS = `html,body{margin:0;padding:0;font:14px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#172b4d;background:#fff}
img,svg{max-width:100%;height:auto}`;

/**
 * 把一份完整 HTML 文档改造成能进沙箱的 srcdoc。
 *
 * ⚠ CSP 必须插在 `<head>` **最前面**：`<meta http-equiv>` 形式的 CSP 只对它
 * 之后解析的内容生效，插晚了前面的 script 已经放过去了。所以这里锚定的是
 * `<head>` 的开标签，不是"往 head 里塞"。
 */
export function toSandboxDocument(html: string): string {
  const raw = html || "";
  const csp = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`
    + `<style>${FALLBACK_CSS}</style>`;

  const headOpen = raw.match(/<head[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return raw.slice(0, at) + csp + raw.slice(at);
  }
  // 不是完整文档（片段）——自己包一层，别把 CSP 丢了
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">${csp}`
    + `<script src="https://cdn.tailwindcss.com"></script></head><body>${raw}</body></html>`;
}

export interface SandboxedPageFrameProps {
  html: string;
  title?: string;
  className?: string;
}

/**
 * 渲染一份生成出来的页面。
 *
 * ⚠ `sandbox` 里**不许**出现 `allow-same-origin`。它跟 `allow-scripts` 同时
 * 给出去，等于把沙箱整个撤掉（同源之后脚本就能拿父页面的一切）——这是
 * MDN 上专门标红的那条，也是这一层唯一一处"改一个词就全盘失守"的地方。
 */
export function SandboxedPageFrame({
  html,
  title = "生成的页面",
  className = "",
}: SandboxedPageFrameProps): React.ReactElement {
  const doc = React.useMemo(() => toSandboxDocument(html), [html]);
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="eager"
      data-testid="sandboxed-page-frame"
      className={`h-full w-full border-0 bg-white ${className}`}
    />
  );
}
