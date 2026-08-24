// @vitest-environment jsdom
/**
 * 点选编辑存库前"换壳"那条纯函数（spliceEditedBody）——这是整个功能
 * 不把 Tailwind 注入/覆盖 CSS 存回 pages_json 的唯一保证，必须钉死：
 *   ①编辑过的内容真的进了最终 HTML
 *   ②我们自己注入的东西（chrome 覆盖层、Tailwind script）**不在**最终 HTML 里
 *   ③找不到 <body> 就返回 null，不许编一份出来（fail-closed）
 */
import { describe, expect, it } from "vitest";

import { spliceEditedBody, labelOfEditable } from "../ClickEditStage";

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>档案页</title></head><body><h1 data-field="title">原标题</h1><button data-action="save">保存</button></body></html>`;

describe("spliceEditedBody", () => {
  it("换壳成功：body 换成编辑后的内容", () => {
    const editedBody = `<body><h1 data-field="title">改过的标题</h1><button data-action="save">保存</button></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).toBeTruthy();
    expect(out).toContain("改过的标题");
    expect(out).not.toContain("原标题");
  });

  it("反向：不许把渲染用的注入物存回去", () => {
    // 模拟画布里那份被 buildDocument 注入过 Tailwind script 的 body——
    // 即便调用方手滑把整个注入过的 body 传进来，换壳函数本身不引入新的注入，
    // 但真正的把关在于调用方只传 body.outerHTML（不含 head），这里确认
    // 换出来的整份文档里没有我们会注入的那个 vendor 脚本路径。
    const editedBody = `<body><h1 data-field="title">改过的标题</h1></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).not.toContain("tailwind-play");
    expect(out).not.toContain("sliderule-preview-chrome");
  });

  it("保留原始 head（title/meta 不因为编辑 body 而丢）", () => {
    const editedBody = `<body><h1 data-field="title">改过的标题</h1></body>`;
    const out = spliceEditedBody(PAGE, editedBody);
    expect(out).toContain("<title>档案页</title>");
  });

  it("原始 HTML 是垃圾内容：DOMPurify 的 WHOLE_DOCUMENT 会归一成一份空壳（带 <body>），\n" +
    "   不会走到「没有 body」那条分支——真按到 null 分支需要 sanitizeAppHtml 本身\n" +
    "   失效（见下一条），这里钉住的是「不崩、不把垃圾原样吐回去」。", () => {
    const out = spliceEditedBody("<not-a-real-document>", "<body>x</body>");
    expect(out).toContain("<body>x</body>");
    expect(out).not.toContain("not-a-real-document");
  });

  it("原始 HTML 是空串：同样归一成空壳，塞进去的编辑内容原样落地", () => {
    const out = spliceEditedBody("", "<body>x</body>");
    expect(out).toContain("<body>x</body>");
  });

  it("空 originalHtml 传入时不抛异常（防御 sanitizeAppHtml 自身的 fail-closed 分支，\n" +
    "   见其 typeof purify.sanitize !== \"function\" 判据；真实 DOMPurify 下走不到，\n" +
    "   这里只钉「不崩」，别去猜它一定归一成什么」", () => {
    expect(() => spliceEditedBody(undefined as unknown as string, "<body>x</body>")).not.toThrow();
  });
});

describe("labelOfEditable", () => {
  it("有语义 data-* 属性时用它当标签", () => {
    const el = document.createElement("h1");
    el.setAttribute("data-field", "title");
    expect(labelOfEditable(el)).toBe('data-field="title"');
  });

  it("没有语义属性就退化成标签名 + 文字摘要", () => {
    const el = document.createElement("span");
    el.textContent = "一段很长很长很长很长很长很长很长的文字内容";
    const label = labelOfEditable(el);
    expect(label.startsWith("<span>")).toBe(true);
    expect(label.length).toBeLessThan(40);
  });

  it("空文字元素只给标签名", () => {
    const el = document.createElement("div");
    expect(labelOfEditable(el)).toBe("<div>");
  });
});
