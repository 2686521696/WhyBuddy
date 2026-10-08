// @vitest-environment jsdom
/**
 * 状态行：用真机那一轮的**原样事件**驱动真 hook，再把 hook 吐出来的东西画到页面上。
 *
 * ⚠ 2026-09-26 第一版修复只在 `live-status.test.tsx` 里喂了 liveAction={null}——
 *   真机从来不给这个输入：工具一结束，hook 把 liveAction 改写成过去式
 *   「已执行工程命令」。判据全绿，真机 sr-20260926103934-KXTT09V6JE 里模型写脚本
 *   的 3 分钟照旧是「◌ 已执行工程命令 · 已等待 1 分 18 秒」（CLAUDE.md §一之二）。
 *
 * 夹具 `fixtures/round19-execution-events.json` 是那一轮执行那条 control run 的
 * 前 13 个 SSE 事件原样：开口 → 建工程 → import 探测（失败）→ pip install（成功）
 * → file_write 开始。第 12 个（pip 的结果）和第 13 个（file_write 开始）之间，
 * 就是用户盯着状态行等了 3 分钟的那段。
 *
 * 把 useSlideRuleSession 里给结果打 settled 的那处删掉，或把 SlideRule.tsx 里
 * liveActionSettled 那行删掉，第一条变红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { ClaudeChatSurface } from "../../SlideRule";
import { THINKING_NEXT } from "../live-status";
import { useSlideRuleSession } from "../useSlideRuleSession";

// SlideRule.tsx → assistant-stream 在模块加载时就要 TransformStream，jsdom 没有。
// vi.hoisted 跑在 import 之前。
vi.hoisted(async () => {
  const web = await import("node:stream/web");
  const g = globalThis as Record<string, unknown>;
  g.TransformStream ??= web.TransformStream;
  g.WritableStream ??= web.WritableStream;
});

vi.mock("@/lib/use-auth", () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/sliderule-narrator", () => ({
  fetchNarration: async () => ({ text: "", source: "fallback" }),
}));
vi.mock("@/pages/agent-loop/dashboard/SidebarSessions", () => ({
  notifySessionsUpdated: vi.fn(),
}));

const EVENTS: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/round19-execution-events.json"), "utf8")
);
/** pip install 的结果——之后模型想了 3 分钟才有下一个事件。 */
const THINKING_GAP_AFTER = EVENTS.findIndex(
  e => e.type === "control_tool_result" && String(e.command || "").startsWith("pip install")
);

/**
 * 第 21 轮（sr-20260927052041-2V6K4Z5SPY）执行 run 的开头：建工程 → todo_write。
 * 之后模型写了 2 分钟脚本。todo_write 的结果摘要（「◐ t1: …」）会作为一段
 * model_speech 挂到步骤末尾——最后一步不是动作 chip，第二版的规则认不出这是空闲，
 * 状态行退回「正在推演...」，下面明明挂着进行中的待办。
 */
const ROUND21: Array<Record<string, unknown>> = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/round21-events-until-todo.json"), "utf8")
);

const SID = "live-status-real-events";
let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: V5SessionState;
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let running: Promise<void> | undefined;

function Harness() {
  current = useSlideRuleSession({ sessionId: SID });
  return null;
}

const encode = (value: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  saved = createInitialSessionState("季度复盘 PPT", SID);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/sessions/${SID}`)) {
        return init?.method === "PUT"
          ? Response.json({ ok: true })
          : Response.json({ state: saved, backend: "python" });
      }
      if (url.includes("/runs/active?")) return Response.json({ active: null });
      if (url.endsWith("/control-turn-stream")) {
        return new Response(new ReadableStream({ start(c) { stream = c; } }));
      }
      return Response.json({});
    })
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (stream) {
    await act(async () => {
      stream!.enqueue(encode({ type: "complete", state: saved }));
      stream!.close();
      stream = undefined;
      await running;
    });
  }
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function replayThrough(lastIndex: number, events = EVENTS) {
  await act(async () => {
    root.render(<Harness />);
  });
  await expect.poll(() => current.sessionHydrated).toBe(true);
  await act(async () => {
    running = current.sendMessage("帮我做一份季度复盘 PPT");
    await vi.waitFor(() => expect(stream).toBeDefined());
  });
  await act(async () => {
    for (const e of events.slice(0, lastIndex + 1)) stream!.enqueue(encode(e));
  });
  await vi.waitFor(() =>
    expect(current.uiTurns.at(-1)?.steps.length ?? 0).toBeGreaterThan(0)
  );
}

/** 页面上那一行状态的字（不是动作列表里的同名 chip）。 */
function statusLine(): string {
  const turn = current.uiTurns.at(-1) ?? null;
  const html = renderToStaticMarkup(
    <ClaudeChatSurface
      uiTurns={current.uiTurns}
      isRunning={current.isRunning}
      liveAction={current.liveAction}
      latestTurn={turn}
      onChallenge={() => {}}
      runtimeKind="project"
      controlTodo={current.sessionState.controlTodo}  // 与 SlideRule.tsx 同一来源
    />
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const row = doc.querySelector('[data-testid="sliderule-live-status"]');
  expect(row).not.toBeNull();
  return row!.textContent || "";
}

describe("真机那一轮的原样事件", () => {
  it("pip install 结束、模型还在想：状态行说在想下一步，不说「已执行工程命令」", async () => {
    await replayThrough(THINKING_GAP_AFTER);
    expect(current.isRunning).toBe(true);
    // 真机的输入形状：liveAction 不为空，是一个过去式标签——第一版判据没喂过这个。
    expect(current.liveAction?.label).toMatch(/^已/);
    expect(current.liveAction?.settled).toBe(true);
    const text = statusLine();
    expect(text).toContain(THINKING_NEXT);
    expect(text).not.toContain("已执行工程命令");
  });

  it("todo_write 之后模型还在想：说在想下一步，带上进行中的那条待办（第 21 轮）", async () => {
    await replayThrough(ROUND21.length - 1, ROUND21);
    expect(ROUND21.at(-1)).toMatchObject({ type: "control_tool_result", tool: "todo_write" });
    // 2026-10-08 起：工具结果只把 human 念给用户，summary 留给模型和日志（sliderule-marathon-driver 头注）——
    // todo 摘要不再作为 model_speech 挂到步骤末尾，最后一步就是 todo_write 那个动作 chip。状态行照样要认得出空闲。
    expect(current.uiTurns.at(-1)?.steps.at(-1)?.kind).toBe("chip");
    const text = statusLine();
    expect(text).toContain(`${THINKING_NEXT}：搭建 PPT 生成脚本与统一视觉规范`);
    expect(text).not.toContain("正在推演");
  });

  it("反向：下一个工具开始了，状态行说的是那个工具", async () => {
    await replayThrough(THINKING_GAP_AFTER + 1);
    expect(EVENTS[THINKING_GAP_AFTER + 1]).toMatchObject({ type: "control_tool_start", tool: "file_write" });
    expect(current.liveAction?.settled).toBeFalsy();
    const text = statusLine();
    expect(text).not.toContain(THINKING_NEXT);
    expect(text).toContain(current.liveAction!.label);
  });
});
