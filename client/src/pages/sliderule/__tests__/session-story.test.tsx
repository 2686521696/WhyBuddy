// @vitest-environment jsdom
/**
 * 章节面的折：完成轮默认收起过程，工具组默认收起，失败仍在组里。
 *
 * 必须 jsdom——SSR 画不出 click 之后。不跟 ClaudeChatSurface 混，
 * 那份要 TransformStream。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionStory } from "../SessionStory";
import type { TurnStep, UiTurn } from "../types";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function chip(
  id: string,
  tool: string,
  progress: "acting" | "completed" | "failed"
): TurnStep {
  return {
    id,
    kind: "chip",
    capabilityId: tool as never,
    roleId: "system",
    label: tool,
    realLlm: false,
    progressType: progress,
  };
}

function turnOf(over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "构建 TicketStream",
    status: "complete",
    durationMs: 237_000,
    steps: [
      { id: "s1", kind: "model_speech", text: "我先把工程搭起来。" },
      chip("p1a", "project_patch", "acting"),
      chip("p1b", "project_patch", "completed"),
      chip("p2a", "project_patch", "acting"),
      chip("p2b", "project_patch", "failed"),
      chip("p3a", "project_patch", "acting"),
      chip("p3b", "project_patch", "completed"),
    ],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "TicketStream 已完成。",
    assistantSource: "llm",
    main: null,
    actions: [],
    ...over,
  };
}

describe("完成轮默认折起过程，点开才摊", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mount(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(node);
    });
    return container;
  }

  it("正向：完成轮脸上是工作了 3m 57s，过程在 DOM 里但 hidden", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    const duration = el.querySelector('[data-testid="session-story-duration"]');
    expect(duration?.textContent).toContain("工作了 3m 57s");
    expect(duration?.textContent).toContain("编辑了 3 个文件");
    expect(duration?.getAttribute("aria-expanded")).toBe("false");
    const body = el.querySelector('[data-testid="session-story-body"]');
    expect(body, "过程必须还在，只是折起来").not.toBeNull();
    expect(body?.parentElement?.hasAttribute("hidden")).toBe(true);
    expect(el.textContent).toContain("我先把工程搭起来。");
  });

  it("点用时才摊开口和工具组", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-duration"]'
      )!.click();
    });
    const body = el.querySelector('[data-testid="session-story-body"]');
    expect(body?.parentElement?.hasAttribute("hidden")).toBe(false);
    expect(
      el.querySelector('[data-testid="session-story-tools-summary"]')
        ?.textContent
    ).toContain("编辑了 3 个文件");
  });

  it("工具组折着，点开才能看见失败那一行——不许 Map 盖掉", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-duration"]'
      )!.click();
    });
    const rows = () =>
      el.querySelectorAll<HTMLButtonElement>('[data-testid="project-task-row"]');
    expect(
      el
        .querySelector('[data-testid="project-task-checklist"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(true);
    expect(rows().length).toBe(3);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-tools-summary"]'
      )!.click();
    });
    expect(
      el
        .querySelector('[data-testid="project-task-checklist"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    const failed = [...rows()].filter(
      row => row.getAttribute("data-status") === "failed"
    );
    expect(failed).toHaveLength(1);
  });

  it("流式结束且人手没点过 → 收起（assistant-ui Reasoning）", async () => {
    const streamingTurn = turnOf({
      status: "streaming",
      durationMs: undefined,
    });
    const el = await mount(
      <SessionStory turn={streamingTurn} streaming />
    );
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    await act(async () => {
      root!.render(<SessionStory turn={turnOf()} streaming={false} />);
    });
    expect(
      el
        .querySelector('[data-testid="session-story-duration"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(true);
  });

  it("进行中的工具组脸上是当前动作和 2/3，不是收尾摘要", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            { id: "s1", kind: "model_speech", text: "我先改文件。" },
            chip("p1a", "project_patch", "acting"),
            chip("p1b", "project_patch", "completed"),
            chip("p2a", "project_patch", "acting"),
            chip("p2b", "project_patch", "completed"),
            chip("p3a", "project_patch", "acting"),
          ],
        })}
        streaming
      />
    );
    const summary = el.querySelector(
      '[data-testid="session-story-tools-summary"]'
    );
    expect(summary?.textContent).toContain("写入源码");
    expect(summary?.getAttribute("data-tool-group-meta")).toBe("2/3");
    expect(summary?.textContent).not.toContain("编辑了 3 个文件");
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
  });

  it("反向：还在跑的轮次不折过程", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            { id: "s1", kind: "model_speech", text: "我先把工程搭起来。" },
            chip("c1", "project_create", "acting"),
          ],
        })}
        streaming
      />
    );
    expect(el.querySelector('[data-testid="session-story-duration"]')).toBeNull();
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    expect(el.textContent).toContain("创建工程");
  });
});
