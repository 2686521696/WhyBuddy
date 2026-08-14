// @vitest-environment jsdom
/**
 * 推演中右侧的页面舞台。
 *
 * 这一层要挡的是三件**都不会报错**的事：
 *   ① 页面到了但右侧还在转圈（接线断在任何一环，没有一处会红）
 *   ② 换页时框里还留着上一页（React 复用同一个 iframe）
 *   ③ 手动选了一页，被新到达的页面挤走（存下标而不是 pageId）
 *
 * ⚠ 渲染走沙箱 iframe（srcdoc + sandbox，不透明源），外面伸不进去。
 * 那是**故意的**——所以判据落在"挂了几个框、挂的是哪一页、srcdoc 里有什么"，
 * 不落在框内渲染出来的 DOM 上。
 *
 * 仓库里没有 @testing-library/react（freeform-actionref 那条注释是明说的），
 * 所以照它的做法拿 createRoot + act 搭挂载器，不引新依赖。
 */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SpecPageLiveStage, type SpecPageLive } from "../SpecPageLiveStage";

// 不设这个标志 React 会走"环境不支持 act"的兼容分支，更新不保证在 act 返回前
// 冲干净——断言就变成在赛跑。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const page = (id: string, n: number, total = 3, bound = false): SpecPageLive => ({
  pageId: id,
  html: `<main><h1>${id}</h1></main>`,
  current: n,
  total,
  bound,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(pages: SpecPageLive[]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<SpecPageLiveStage pages={pages} />));
  return host;
}

function update(pages: SpecPageLive[]): void {
  act(() => root!.render(<SpecPageLiveStage pages={pages} />));
}

const tab = (id: string) =>
  host!.querySelector<HTMLButtonElement>(`[data-testid="sliderule-spec-page-tab-${id}"]`)!;
const frames = () =>
  host!.querySelectorAll<HTMLIFrameElement>('[data-testid="sandboxed-page-frame"]');
const stageText = () =>
  host!.querySelector('[data-testid="sliderule-spec-page-stage"]')!.textContent || "";

describe("有页面就渲染，没页面就让位", () => {
  it("一页都没有时不占位 —— 交给原来的『推演中』那支", () => {
    expect(mount([]).firstChild).toBeNull();
  });

  it("有页面就挂出渲染框", () => {
    mount([page("p1", 1)]);
    expect(frames()).toHaveLength(1);
  });

  it("同时只挂一个框 —— 不是把所有页堆在一起", () => {
    mount([page("p1", 1), page("p2", 2)]);
    expect(frames()).toHaveLength(1);
  });
});

describe("没手动选过就跟最新一页", () => {
  it("页面陆续到达时，显示的是最后到的那页", () => {
    mount([page("p1", 1)]);
    expect(tab("p1").getAttribute("aria-pressed")).toBe("true");

    update([page("p1", 1), page("p2", 2)]);
    expect(tab("p2").getAttribute("aria-pressed")).toBe("true");
    expect(tab("p1").getAttribute("aria-pressed")).toBe("false");
  });

  it("手动选过之后，新页面到达不许把它挤走", () => {
    /**
     * ⚠ 这条钉的是"存 pageId 不是存下标"。存下标时新页面一到，同一个下标
     * 指向的就是另一页了——表现是"我明明点了甲页，它自己跳到乙页去"。
     */
    mount([page("p1", 1), page("p2", 2)]);
    act(() => tab("p1").click());
    expect(tab("p1").getAttribute("aria-pressed")).toBe("true");

    update([page("p1", 1), page("p2", 2), page("p3", 3)]);
    expect(tab("p1").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("进度与接数状态如实说", () => {
  it("角标报已到几页 / 共几页", () => {
    mount([page("p1", 1, 5), page("p2", 2, 5)]);
    expect(stageText()).toContain("2/5");
  });

  it("第 3 步的素颜页如实标『尚未接数据』", () => {
    // 不是渲染失败——这个阶段本来就还没有数据（孔要等第 6.5 步）。
    // 装作已经接上，等于把"还没做"说成"做完了"。
    mount([page("p1", 1, 3, false)]);
    expect(
      host!.querySelector('[data-testid="sliderule-spec-page-bound"]')!.textContent
    ).toBe("尚未接数据");
  });

  it("打过孔的页标『已接数据』", () => {
    mount([page("p1", 1, 3, true)]);
    expect(
      host!.querySelector('[data-testid="sliderule-spec-page-bound"]')!.textContent
    ).toBe("已接数据");
  });

  it("总数以实到页数兜底 —— total 缺席不显 0/0", () => {
    mount([{ ...page("p1", 1), total: 0 }]);
    expect(stageText()).toContain("1/1");
  });
});

describe("换页要重挂，不能留着上一页", () => {
  it("切页后 iframe 被整个替换（key 带 pageId）", () => {
    /**
     * 沙箱是不透明源，框内内容看不见。所以判据落在**节点身份**上：
     * key 变了 React 会新建一个 iframe，旧的那个不再在文档里。
     * key 不带 pageId 的话 iframe 会被复用，srcdoc 换值时浏览器的重载时机
     * 不一致，能看到上一页残留一瞬——那时这条会红。
     */
    mount([page("p1", 1), page("p2", 2)]);
    const before = frames()[0];
    act(() => tab("p1").click());
    expect(frames()[0]).not.toBe(before);
  });
});
