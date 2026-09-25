// @vitest-environment jsdom
/**
 * 完成轮的收尾总结留在折页外面。
 *
 * ⚠ 2026-09-25 luna 隔离真机 sr-20260925003931-HP3KEB33FR：模型收尾说
 *   「已完成并生成 PPT 文件……已核对：共 10 页、16:9……」，跟过程一起被折进
 *   「工作了 7m 16s」，页面全文里搜不到。下面的收尾文字取自那一轮的
 *   controlTranscript 原文（链接换成回执给出的真实下载地址）。
 *
 * 删掉 SessionStory 里的 splitClosingSpeech，第一条变红（总结只在 hidden 里）。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionStory } from "../SessionStory";
import { splitClosingSpeech, deriveSessionStory } from "../session-story";
import type { TurnStep, UiTurn } from "../types";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const DOWNLOAD =
  "/api/sliderule/projects/prj-9577095ad669540abc28d4a3cd19b55a/artifacts/art-f3e3f8b9057bcfc350a24745e555a5adb0eb35a2";

const CLOSING = [
  "已完成并生成 PPT 文件：",
  "",
  `[下载《2026 年第三季度产品复盘》PPTX](${DOWNLOAD})`,
  "",
  "已核对：",
  "- 共 10 页，16:9 宽屏格式",
  "- 包含开篇结论、三个关键指标、两个做成了的事、两个没做成的原因、下季度三件事",
].join("\n");

function chip(id: string, tool: string, progress: "acting" | "completed"): TurnStep {
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
    id: "t-closing",
    user: "批准计划并执行",
    status: "complete",
    durationMs: 436_000,
    steps: [
      { id: "s1", kind: "model_speech", text: "我现在按已批准的 10 页结构整理示例数据，并开始生成可编辑的 PPTX。" },
      chip("c1a", "project_create", "acting"),
      chip("c1b", "project_create", "completed"),
      chip("c2a", "shell_exec", "acting"),
      chip("c2b", "shell_exec", "completed"),
      { id: "s-final", kind: "model_speech", text: CLOSING },
    ],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
    ...over,
  };
}

describe("收尾总结不进折叠", () => {
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

  /** 用户真能看见的字：不在任何 hidden 祖先里。 */
  function visibleText(el: HTMLElement): string {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let out = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let p: HTMLElement | null = n.parentElement;
      let hidden = false;
      while (p && p !== el) {
        if (p.hidden) hidden = true;
        p = p.parentElement;
      }
      if (!hidden) out += n.textContent;
    }
    return out;
  }

  it("完成轮：过程折起，收尾总结和它的下载链接照样看得见", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    const shown = visibleText(el);
    expect(shown).toContain("已核对");
    expect(shown).toContain("共 10 页，16:9 宽屏格式");
    // 过程仍然折着：开场那句只在 hidden 里。
    expect(shown).not.toContain("整理示例数据");
    const link = el.querySelector<HTMLAnchorElement>(
      '[data-testid="session-story-closing"] a'
    );
    expect(link?.getAttribute("href")).toBe(DOWNLOAD);
    // 不许双渲染：折页里不再有同一段总结。
    const body = el.querySelector('[data-testid="session-story-body"]');
    expect(body?.textContent ?? "").not.toContain("已核对");
  });

  it("模型写成 sandbox: 路径时，不画成一个点了没反应的链接", async () => {
    const text = CLOSING.replace(DOWNLOAD, "sandbox:/home/user/workspace/2026_Q3_product_review.pptx");
    const el = await mount(
      <SessionStory
        turn={turnOf({
          steps: [
            ...turnOf().steps.slice(0, -1),
            { id: "s-final", kind: "model_speech", text },
          ],
        })}
        streaming={false}
      />
    );
    // 空 href 也是个能点的链接（点了整页重载），所以要求这里根本没有 <a>，
    // 字照样在。
    const closingEl = el.querySelector('[data-testid="session-story-closing"]');
    expect(closingEl?.querySelectorAll("a").length).toBe(0);
    expect(closingEl?.textContent).toContain("下载《2026 年第三季度产品复盘》PPTX");
  });

  it("反向：还在流的时候最后一句不是收尾，不拎出来", () => {
    const blocks = deriveSessionStory(turnOf({ status: "streaming" }));
    expect(splitClosingSpeech(blocks, true).closing).toBeNull();
  });

  /**
   * ⚠ 2026-09-25 第二轮真机：前面没有工程工具组（工厂工具不成组），模型如实说
   *   「当前无法交付 PPTX……」，上一版不拆，整段折进「工作了 3m 42s」。
   *   上一版这里的反向判据「纯对话不拆」写反了——把它改回去，本条变红。
   */
  it("前面没有工具组时，结束那句照样露在外面", async () => {
    const honest =
      "当前无法交付 PPTX：办公文件生成链连续执行后仍未产出 SPEC、页面或文件，页面数量为 0，因此不能声称文件已生成或完成核验。";
    const el = await mount(
      <SessionStory
        turn={turnOf({
          durationMs: 222_000,
          steps: [
            { id: "s1", kind: "model_speech", text: "我会按已批准的 10 页结构制作 PPT。" },
            { id: "s2", kind: "model_speech", text: honest },
          ],
        })}
        streaming={false}
      />
    );
    expect(visibleText(el)).toContain("当前无法交付 PPTX");
    const blocks = deriveSessionStory(
      turnOf({ steps: [{ id: "s", kind: "model_speech", text: "你好，我能做 PPT 和网页。" }] })
    );
    const { process, closing } = splitClosingSpeech(blocks, false);
    expect(closing?.text).toBe("你好，我能做 PPT 和网页。");
    expect(process).toHaveLength(0);
  });

  it("反向：最后一块是工具组时没有收尾可拆", () => {
    const blocks = deriveSessionStory(turnOf({ steps: turnOf().steps.slice(0, -1) }));
    const { process, closing } = splitClosingSpeech(blocks, false);
    expect(closing).toBeNull();
    expect(process).toHaveLength(blocks.length);
  });
});
