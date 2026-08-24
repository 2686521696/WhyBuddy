// @vitest-environment jsdom
/**
 * 点选编辑存库前"换壳"那条纯函数（spliceEditedBody）——这是整个功能
 * 不把 Tailwind 注入/覆盖 CSS 存回 pages_json 的唯一保证，必须钉死：
 *   ①编辑过的内容真的进了最终 HTML
 *   ②我们自己注入的东西（chrome 覆盖层、Tailwind script）**不在**最终 HTML 里
 *   ③找不到 <body> 就返回 null，不许编一份出来（fail-closed）
 */
import { describe, expect, it } from "vitest";

import {
  spliceEditedBody,
  labelOfEditable,
  firstEditableDescendant,
  editableAncestorChain,
  breadcrumbLabel,
  clampFontSizePx,
  resolveFontSizePx,
  parseFirstElement,
  MIN_FONT_SIZE_PX,
  MAX_FONT_SIZE_PX,
} from "../ClickEditStage";

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

/**
 * 面包屑导航（editableAncestorChain / firstEditableDescendant）——参照
 * GrapesJS ComponentExit「沿 parent() 链爬到第一个够格祖先」写的一对
 * 互逆函数。判据钉两头：能往上找到该找的那级、也能往下钻到该钻的那级，
 * 而且中间那些不够格的容器（纯 div）不能被误当成一级。
 */
describe("editableAncestorChain / firstEditableDescendant（面包屑导航）", () => {
  function buildFixture() {
    document.body.innerHTML = `
      <nav data-shell="aside">
        <div class="wrap">
          <ul>
            <li data-field="nav_item_1">面试日程日历</li>
          </ul>
        </div>
      </nav>`;
    const li = document.querySelector('[data-field="nav_item_1"]') as HTMLElement;
    const nav = document.querySelector("nav") as HTMLElement;
    return { li, nav };
  }

  it("从叶子节点往上收链：语义/结构节点各占一级，中间纯 div 不占位", () => {
    const { li, nav } = buildFixture();
    const chain = editableAncestorChain(li);
    expect(chain[chain.length - 1]).toBe(li);
    expect(chain[0]).toBe(nav);
    // wrap 那层纯 div 没有语义属性也不在 BLOCK_TAGS 里，不该单独占一级
    expect(chain.some(el => el.className === "wrap")).toBe(false);
  });

  it("反向：链条不超过 max 参数指定的级数", () => {
    document.body.innerHTML = `
      <nav><header><section><article><li data-field="deep">深</li></article></section></header></nav>`;
    const li = document.querySelector('[data-field="deep"]') as HTMLElement;
    const chain = editableAncestorChain(li, 2);
    expect(chain.length).toBe(2);
    expect(chain[chain.length - 1]).toBe(li);
  });

  it("从容器往下钻：找到第一个语义/块级后代", () => {
    const { nav, li } = buildFixture();
    const found = firstEditableDescendant(nav);
    expect(found).toBe(li);
  });

  it("反向：叶子节点自己没有可下钻的后代时返回 null", () => {
    const { li } = buildFixture();
    expect(firstEditableDescendant(li)).toBeNull();
  });

  it("结构标签（nav/header/aside/main/footer）在面包屑里显示中文名，不是原始标签", () => {
    const nav = document.createElement("nav");
    expect(breadcrumbLabel(nav)).toBe("导航");
    const aside = document.createElement("aside");
    expect(breadcrumbLabel(aside)).toBe("侧栏");
  });

  it("语义元素在面包屑里显示属性值，不是「属性名=值」的完整形式（跟 labelOfEditable 不同）", () => {
    const el = document.createElement("li");
    el.setAttribute("data-field", "nav_item_1");
    expect(breadcrumbLabel(el)).toBe("nav_item_1");
  });
});

/**
 * 字号：跟 Tiptap font-size 扩展同一条读值优先级——先信行内 style，
 * 没改过才退回 computed。判据钉住这个优先级顺序（反向：改过之后不能被
 * computed 值盖回去），以及夹紧范围不越界。
 */
describe("resolveFontSizePx / clampFontSizePx（字号）", () => {
  it("没改过时用 computed 值", () => {
    const el = document.createElement("span");
    expect(resolveFontSizePx(el, "20px")).toBe(20);
  });

  it("反向：改过一次之后必须信行内 style，不能被 computed 盖回去", () => {
    const el = document.createElement("span");
    el.style.fontSize = "24px";
    // 即便 computed 传进来的还是旧值（真机里 computed 有一帧延迟很常见），
    // 结果也必须是行内那个 24，不是 computed 的 16。
    expect(resolveFontSizePx(el, "16px")).toBe(24);
  });

  it("computed 解析不出数字时兜底 16", () => {
    const el = document.createElement("span");
    expect(resolveFontSizePx(el, "")).toBe(16);
  });

  it("夹紧：不允许缩到下限以下、放大到上限以上", () => {
    expect(clampFontSizePx(MIN_FONT_SIZE_PX - 5)).toBe(MIN_FONT_SIZE_PX);
    expect(clampFontSizePx(MAX_FONT_SIZE_PX + 50)).toBe(MAX_FONT_SIZE_PX);
    expect(clampFontSizePx(20)).toBe(20);
  });
});

/**
 * parseFirstElement——AI 编辑返回的 HTML 片段（已经过 sanitizeHtmlFragment
 * 消毒）落地成真实 DOM 节点。判据钉住"只取第一个顶层元素"这条：跟后端
 * 提示词"只输出一个元素"对齐，AI 万一吐出兄弟节点不能被悄悄拼接进页面。
 */
describe("parseFirstElement", () => {
  it("单个元素：原样解析出来", () => {
    const el = parseFirstElement(document, '<div data-field="x" class="text-lg">你好</div>');
    expect(el?.tagName).toBe("DIV");
    expect(el?.getAttribute("data-field")).toBe("x");
    expect(el?.textContent).toBe("你好");
  });

  it("反向：多个顶层兄弟节点只取第一个，不悄悄拼接剩下的", () => {
    const el = parseFirstElement(document, "<p>第一段</p><p>第二段</p>");
    expect(el?.textContent).toBe("第一段");
    expect(el?.textContent).not.toContain("第二段");
    // 调用方（handleAiEditSubmit）拿到 el 之后用 replaceWith 把它单独摘出来
    // 插进画布——el 这时还挂在函数内部的临时容器上，第二段留在那个容器里
    // 被整体丢弃，不会跟着 el 一起被搬进文档。这里只钉"el 本身不含第二段"，
    // 搬运时不泄漏是 Node.replaceWith 的原生语义，不是这个函数要保证的事。
  });

  it("空字符串 / 纯文本（没有元素）返回 null", () => {
    expect(parseFirstElement(document, "")).toBeNull();
    expect(parseFirstElement(document, "只是一段文字，没有标签")).toBeNull();
  });
});
