// @vitest-environment jsdom
/**
 * 沙箱框：这一层是**安全边界本身**，所以判据要钉死在属性与 CSP 上。
 *
 * ## 为什么不是拿渲染结果当判据
 *
 * 框里是不透明源，jsdom 也不执行 srcdoc。看不见框内 DOM 是**设计如此**，
 * 不是测试写不动。所以这里验的是"交给浏览器的那份契约对不对"：
 * sandbox 给了哪几个能力、CSP 里那几条闸在不在、CSP 插的位置对不对。
 *
 * ⚠ 这一层最危险的改动只有一个词：`allow-same-origin`。它跟 `allow-scripts`
 * 同时给出去，等于沙箱整个作废（同源之后脚本就能拿父页面的一切）。
 * MDN 上专门标红，这里也单独一条用例守着。
 */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { toSandboxDocument, SandboxedPageFrame } from "../sandboxed-page-frame";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

/**
 * ⚠ 判据落在**真实 DOM 的属性**上，不落在 renderToStaticMarkup 的字符串上。
 * SSR 那条路会把 srcDoc / referrerPolicy 原样按驼峰吐出来，看起来像"属性名
 * 写错了"，实际上浏览器里是对的——拿它当判据会把对的判成错的。
 */
function frame(html: string): HTMLIFrameElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(React.createElement(SandboxedPageFrame, { html })));
  return host.querySelector("iframe") as HTMLIFrameElement;
}

const FULL_DOC = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>预约挂号</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{500:'#13b58c'}}}}}</script>
</head><body class="bg-slate-50"><main class="flex gap-4">正文</main></body></html>`;

describe("沙箱属性：一个词都不能松", () => {
  const sandbox = () => frame(FULL_DOC).getAttribute("sandbox") || "";

  it("给 allow-scripts —— 不给脚本就等于这个功能不存在", () => {
    // 页面的全部样式来自 Tailwind Play CDN 那个运行时 JIT。脚本不跑，
    // 右侧就是一堆裸文字加一个撑满屏的图标（08-14 真机截图）。
    expect(sandbox()).toBe("allow-scripts");
  });

  it("**不许**出现 allow-same-origin —— 这是全盘失守的那一个词", () => {
    expect(sandbox()).not.toContain("allow-same-origin");
  });

  it("也不给 top 导航 / modal / 弹窗这些不需要的能力", () => {
    const src = sandbox();
    for (const cap of [
      "allow-top-navigation",
      "allow-modals",
      "allow-popups",
      "allow-forms",
      "allow-downloads",
      "allow-pointer-lock",
      "allow-presentation",
    ]) {
      expect(src).not.toContain(cap);
    }
  });

  it("走 srcdoc 不走 src —— 内容不落地址、不发一次外部请求", () => {
    const el = frame(FULL_DOC);
    expect(el.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(el.getAttribute("src")).toBeNull();
  });
});

describe("框内 CSP：真正挡住外带与钓鱼的是这几条", () => {
  const doc = () => toSandboxDocument(FULL_DOC);

  it("connect-src 'none' —— 脚本发不出 fetch/XHR/WebSocket", () => {
    // 沙箱挡住的是"读父页面"，挡不住"把自己有的东西发出去"。这条才是外带的闸。
    expect(doc()).toContain("connect-src 'none'");
  });

  it("form-action 'none' —— 框里画个假登录页也提交不出去", () => {
    expect(doc()).toContain("form-action 'none'");
  });

  it("base-uri / object-src / frame-src 都掐死", () => {
    const d = doc();
    expect(d).toContain("base-uri 'none'");
    expect(d).toContain("object-src 'none'");
    expect(d).toContain("frame-src 'none'");
  });

  it("script-src 只放 tailwind CDN 与内联 —— 不是 https: 全放", () => {
    const d = doc();
    expect(d).toContain("script-src 'unsafe-inline' https://cdn.tailwindcss.com");
    expect(d).not.toContain("script-src 'unsafe-inline' https:;");
  });

  it("内联 script 必须放行 —— 配色就写在 tailwind.config 那段里", () => {
    /**
     * 不放行的话类名还在、配色没了，页面变成"半有样式"——比全没有更难查，
     * 因为它看着像是模型画得不好，而不是像渲染坏了。
     */
    expect(doc()).toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});

describe("CSP 必须插在 head 最前面", () => {
  it("插在第一个 script 之前 —— 插晚了前面的脚本已经放过去了", () => {
    /**
     * `<meta http-equiv>` 形式的 CSP 只对它**之后**解析的内容生效。
     * 这条是这一层最容易写对形状、错在位置的地方：CSP 明明在文档里，
     * 却一条也没拦住。
     */
    const d = toSandboxDocument(FULL_DOC);
    expect(d.indexOf("Content-Security-Policy")).toBeLessThan(d.indexOf("cdn.tailwindcss.com"));
  });

  it("紧跟 <head> 开标签，不是塞在 </head> 前", () => {
    const d = toSandboxDocument(FULL_DOC);
    expect(d).toMatch(/<head[^>]*><meta http-equiv="Content-Security-Policy"/);
  });
});

describe("页面原样保留 —— 这一层不改内容", () => {
  it("Tailwind CDN 那个 script 留着", () => {
    expect(toSandboxDocument(FULL_DOC)).toContain('src="https://cdn.tailwindcss.com"');
  });

  it("body 上的类名和正文都在", () => {
    const d = toSandboxDocument(FULL_DOC);
    expect(d).toContain('class="bg-slate-50"');
    expect(d).toContain('class="flex gap-4"');
    expect(d).toContain("正文");
  });
});

describe("不是完整文档也得能渲染", () => {
  it("片段自己包一层，并把 Tailwind 补上", () => {
    const d = toSandboxDocument('<main class="flex">只有片段</main>');
    expect(d).toContain("<!DOCTYPE html>");
    expect(d).toContain("cdn.tailwindcss.com");
    expect(d).toContain("只有片段");
  });

  it("片段也带 CSP —— 少这一条就等于开了个没闸的口子", () => {
    expect(toSandboxDocument("<div>x</div>")).toContain("connect-src 'none'");
  });

  it("空输入不炸，且仍然带 CSP", () => {
    const d = toSandboxDocument("");
    expect(d).toContain("connect-src 'none'");
  });
});

describe("兜底底样式", () => {
  it("CDN 挂了也不至于是一坨堆在左上角的裸文字", () => {
    const d = toSandboxDocument(FULL_DOC);
    expect(d).toContain("font:14px/1.6 system-ui");
    // 图片不许撑破框——08-14 那张截图里撑满屏的蓝图标就是这么来的
    expect(d).toContain("img,svg{max-width:100%");
  });
});
