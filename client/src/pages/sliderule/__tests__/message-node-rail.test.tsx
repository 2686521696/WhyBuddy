// @vitest-environment jsdom
/**
 * 对话导轨（照 grok-app 的 MessageNodeRail）：刻度怎么来、悬停看什么、点了跳哪。
 *
 * 正反成对（CLAUDE.md 三）：有刻度 ↔ 没有可见正文的用户轮不出刻度、只有一条消息时整条导轨不出；
 * 点击会滚 ↔ 滚到的是**那一条**的位置（不是随便滚一下）。整页里刻度跟消息一一对上的那条在
 * SlideRule.unified-surface.test.tsx（刻度和消息各算一份就会对不上）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageNodeRail } from "../MessageNodeRail";
import {
  adjacentRailNode,
  buildRailNodes,
  pickActiveNodeId,
  truncateRailPreview,
  type RailNode,
  type RailSourceItem,
} from "../message-rail-nodes";
import type { UiTurn } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function turn(id: string, over: Partial<UiTurn> = {}): UiTurn {
  return {
    id,
    user: "做一个采购审批应用",
    assistant: "好的，先把审批流拆成三步。",
    assistantSource: "llm",
    status: "done",
    steps: [],
    actions: [],
    routeFacts: { rounds: [], planSelectedCount: 0 },
    routeExpanded: false,
    routeLitCount: 0,
    main: null,
    ...over,
  } as unknown as UiTurn;
}

function items(...turns: UiTurn[]): RailSourceItem[] {
  return turns.flatMap(t => [
    ...(t.user ? [{ id: `${t.id}-user`, role: "user" as const, turn: t }] : []),
    { id: `${t.id}-assistant`, role: "assistant" as const, turn: t },
  ]);
}

describe("刻度数据", () => {
  it("一条消息一个刻度，id 就是消息 id，序号连续", () => {
    const nodes = buildRailNodes(items(turn("t1"), turn("t2", { user: "加一个导出按钮" })));
    expect(nodes.map(n => n.id)).toEqual(["t1-user", "t1-assistant", "t2-user", "t2-assistant"]);
    expect(nodes.map(n => n.nodeIndex)).toEqual([0, 1, 2, 3]);
    expect(nodes[2].preview).toBe("加一个导出按钮");
    expect(nodes[1].role).toBe("assistant");
  });

  it("反向：用户那条没有可见正文（气泡不渲染）就不出刻度，序号不留空洞", () => {
    // 只剩系统附注的用户轮：visibleUserMessage 剥完是空的，ImUserMessage 不画气泡。
    const hidden = turn("t1", { user: "\n\n" });
    const nodes = buildRailNodes(items(hidden, turn("t2")));
    expect(nodes.map(n => n.id)).toEqual(["t1-assistant", "t2-user", "t2-assistant"]);
    expect(nodes.map(n => n.nodeIndex)).toEqual([0, 1, 2]);
  });

  it("面团还没说完：用开口那句当预览，状态 pending；中断的那轮标 error", () => {
    const running = turn("t1", {
      assistant: "",
      status: "streaming",
      steps: [{ id: "s1", kind: "model_speech", text: "我先看一下现有的表结构。" }] as UiTurn["steps"],
    });
    const failed = turn("t2", { assistant: "推演中断：模型超时", assistantSource: "fallback" });
    const nodes = buildRailNodes(items(running, failed));
    expect(nodes[1]).toMatchObject({ preview: "我先看一下现有的表结构。", status: "pending" });
    expect(nodes[3].status).toBe("error");
    expect(nodes[2].status).toBe("done");
  });

  it("预览是一行字：去 markdown 记号、压空白、超长截断", () => {
    expect(truncateRailPreview("## 结论\n\n**三步**走完 [文档](http://x)")).toBe("结论 三步走完 文档");
    const long = truncateRailPreview("长".repeat(200));
    expect(long.length).toBe(72);
    expect(long.endsWith("…")).toBe(true);
    expect(truncateRailPreview("   ")).toBe("…");
  });

  it("正在读哪条：28% 那条线以上最后开头的那条；都没过线取最近的", () => {
    const rects = [
      { id: "a", top: 0, bottom: 100 },
      { id: "b", top: 100, bottom: 300 },
      { id: "c", top: 300, bottom: 400 },
    ];
    expect(pickActiveNodeId(rects, 150)).toBe("b");
    expect(pickActiveNodeId(rects, 350)).toBe("c");
    expect(pickActiveNodeId([{ id: "x", top: 500, bottom: 600 }, { id: "y", top: 900, bottom: 1000 }], 200)).toBe("x");
    expect(pickActiveNodeId([], 0)).toBeNull();
  });

  it("上一条 / 下一条：到头是 null；没有当前就从头 / 从尾", () => {
    const nodes = buildRailNodes(items(turn("t1"), turn("t2")));
    expect(adjacentRailNode(nodes, "t1-assistant", 1)?.id).toBe("t2-user");
    expect(adjacentRailNode(nodes, "t1-assistant", -1)?.id).toBe("t1-user");
    expect(adjacentRailNode(nodes, "t2-assistant", 1)).toBeNull();
    expect(adjacentRailNode(nodes, "t1-user", -1)).toBeNull();
    expect(adjacentRailNode(nodes, null, 1)?.id).toBe("t1-user");
    expect(adjacentRailNode(nodes, null, -1)?.id).toBe("t2-assistant");
  });
});

describe("导轨组件", () => {
  let host: HTMLDivElement;
  let root: Root;
  let viewport: HTMLDivElement;
  let scrollTo: ReturnType<typeof vi.fn>;
  let frames: FrameRequestCallback[] = [];
  const flushFrames = () =>
    act(() => {
      const run = frames;
      frames = [];
      run.forEach(cb => cb(0));
    });

  // 每条消息高 200，视口从 0 开始、高 500（jsdom 不排版，位置自己给）。
  function mountViewport(ids: string[]) {
    viewport = document.createElement("div");
    let scrollTop = 0;
    Object.defineProperty(viewport, "scrollTop", { get: () => scrollTop, set: v => (scrollTop = v), configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 400, height: 500, width: 400 }) as DOMRect;
    scrollTo = vi.fn((opts: ScrollToOptions) => {
      scrollTop = Number(opts.top);
    });
    (viewport as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
    ids.forEach((id, i) => {
      const el = document.createElement("div");
      el.setAttribute("data-message-id", id);
      el.getBoundingClientRect = () =>
        ({ top: i * 200 - scrollTop, bottom: i * 200 + 200 - scrollTop, height: 200, left: 0, right: 400, width: 400 }) as DOMRect;
      viewport.appendChild(el);
    });
    document.body.appendChild(viewport);
  }

  function render(nodes: RailNode[]) {
    act(() => {
      root.render(<MessageNodeRail nodes={nodes} viewportRef={{ current: viewport }} />);
    });
  }

  const q = (testId: string) => document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`);

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    // 跟浏览器一样下一帧才跑（同步调用的话组件先清空的帧号会被返回值盖回去，以后再也排不上帧）。
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const fourNodes = () => buildRailNodes(items(turn("t1"), turn("t2", { user: "加一个导出按钮" })));

  it("一条消息一个刻度；悬停浮出谁说的、说了什么、第几条 / 共几条", () => {
    const nodes = fourNodes();
    mountViewport(nodes.map(n => n.id));
    render(nodes);
    const ticks = q("message-rail-tick");
    expect(ticks).toHaveLength(4);
    expect(q("message-rail-tip")).toHaveLength(0);
    act(() => {
      ticks[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const tip = q("message-rail-tip")[0];
    expect(tip.textContent).toContain("你");
    expect(tip.textContent).toContain("加一个导出按钮");
    expect(tip.textContent).toContain("3 / 4");
    act(() => {
      ticks[2].dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(q("message-rail-tip")).toHaveLength(0);
  });

  it("点刻度跳到那一条消息的位置，那条描边、那个刻度高亮", () => {
    const nodes = fourNodes();
    mountViewport(nodes.map(n => n.id));
    render(nodes);
    act(() => q("message-rail-tick")[2].click());
    // 第 3 条在 400，留 12px 上边距。
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 388, behavior: "smooth" });
    const target = viewport.querySelector('[data-message-id="t2-user"]')!;
    expect(target.hasAttribute("data-rail-flash")).toBe(true);
    expect(q("message-rail-tick")[2].getAttribute("aria-current")).toBe("true");
  });

  it("上一条 / 下一条从当前那条走", () => {
    const nodes = fourNodes();
    mountViewport(nodes.map(n => n.id));
    render(nodes);
    act(() => q("message-rail-tick")[1].click());
    act(() => q("message-rail-next")[0].click());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 388, behavior: "smooth" });
    act(() => q("message-rail-prev")[0].click());
    act(() => q("message-rail-prev")[0].click());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    expect((q("message-rail-prev")[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("自己滚动时高亮跟着走（28% 那条线读到哪条）", () => {
    const nodes = fourNodes();
    mountViewport(nodes.map(n => n.id));
    render(nodes);
    flushFrames();
    // 挂上时在顶上：线在 140，读的是第 1 条。
    expect(q("message-rail-tick")[0].classList.contains("is-active")).toBe(true);
    act(() => {
      viewport.scrollTop = 500;    // 线落在内容 640 处 → 第 4 条（600 起）
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(new Event("scroll"));   // 同一帧里滚两下只排一帧
    });
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(q("message-rail-tick")[3].classList.contains("is-active")).toBe(true);
    expect(q("message-rail-tick")[0].classList.contains("is-active")).toBe(false);
  });

  it("反向：只有一条消息不出导轨；刻度对应的消息不在页面上，点了不乱滚", () => {
    mountViewport(["t1-assistant"]);
    render(buildRailNodes(items(turn("t1", { user: "" }))));
    expect(q("message-rail")).toHaveLength(0);

    act(() => root.render(<></>));
    document.body.removeChild(viewport);
    mountViewport(["t1-user", "t1-assistant"]);
    render(fourNodes());
    act(() => q("message-rail-tick")[3].click());
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
