/**
 * `autopilot-agent-reasoning-stream` spec Task 12：AgentReasoningTimeline 组件单测。
 *
 * 验证 pulse-ring 占位 / reduced-motion 降级 / 双轨布局 / error+completed 横幅 /
 * iteration 分隔线。使用 renderToStaticMarkup 做 DOM 结构断言（与项目既有测试风格一致）。
 * 全部 example-based，禁 PBT。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

import type { AgentReasoningEntry } from "../../../lib/blueprint-realtime-store.js";

// ─── Mock store ──────────────────────────────────────────────────────────────

const storeState = {
  agentReasoning: {
    jobId: "job-test",
    entries: [] as AgentReasoningEntry[],
    currentIteration: 0,
    status: "idle" as "idle" | "streaming" | "completed" | "failed" | "aborted",
  },
  connectionState: "connected" as "disconnected" | "connecting" | "connected",
};

vi.mock("../../../lib/blueprint-realtime-store.js", () => ({
  useBlueprintRealtimeStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
  __setSocket: vi.fn(),
}));

// Mock framer-motion to avoid SSR issues
vi.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
        const { initial, animate, transition, children, ...rest } = props;
        return React.createElement("div", { ...rest, ref }, children as React.ReactNode);
      }
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// Mock matchMedia
const matchMediaState = { matches: false };
Object.defineProperty(globalThis, "window", {
  value: {
    matchMedia: () => ({
      matches: matchMediaState.matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  },
  writable: true,
});

import { AgentReasoningTimeline } from "../AgentReasoningTimeline.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AgentReasoningEntry> = {}): AgentReasoningEntry {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    jobId: "job-test",
    iteration: 1,
    iterationLabel: "#1",
    phase: "thinking",
    timestamp: "2026-05-13T10:00:00.000Z",
    ...overrides,
  };
}

function renderTimeline() {
  return renderToStaticMarkup(
    React.createElement(AgentReasoningTimeline, { jobId: "job-test" })
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AgentReasoningTimeline", () => {
  beforeEach(() => {
    storeState.agentReasoning = {
      jobId: "job-test",
      entries: [],
      currentIteration: 0,
      status: "idle",
    };
    storeState.connectionState = "connected";
    matchMediaState.matches = false;
  });

  it("空 state 渲染 PulseRingPlaceholder，文案含「等待第一条思考」", () => {
    const html = renderTimeline();
    expect(html).toContain("pulse-ring-placeholder");
    expect(html).toContain("等待第一条思考");
  });

  it("prefers-reduced-motion: reduce → pulse-ring 带 reasoning-ripple-disable class", () => {
    matchMediaState.matches = true;
    const html = renderTimeline();
    expect(html).toContain("reasoning-ripple-disable");
  });

  it("thinking entry 渲染 data-column='left'", () => {
    storeState.agentReasoning.entries = [makeEntry({ phase: "thinking", thought: "分析代码" })];
    storeState.agentReasoning.status = "streaming";
    const html = renderTimeline();
    expect(html).toContain('data-column="left"');
    expect(html).toContain("reasoning-card-thinking");
  });

  it("acting + observing entries 渲染 data-column='right'", () => {
    storeState.agentReasoning.entries = [
      makeEntry({ phase: "acting", actionToolId: "mcp.github.clone" }),
      makeEntry({ id: "obs-1", phase: "observing", observationSuccess: true }),
    ];
    storeState.agentReasoning.status = "streaming";
    const html = renderTimeline();
    expect(html).toContain('data-column="right"');
    expect(html).toContain("reasoning-card-acting");
    expect(html).toContain("reasoning-card-observing");
  });

  it("error entry 渲染为 banner 含红系 class；completed 含绿系 class", () => {
    storeState.agentReasoning.entries = [
      makeEntry({ phase: "error", error: "超时", degraded: true, reason: "执行异常" }),
    ];
    storeState.agentReasoning.status = "failed";
    let html = renderTimeline();
    expect(html).toContain("reasoning-banner-error");
    expect(html).toContain("red");

    storeState.agentReasoning.entries = [
      makeEntry({ phase: "completed", reason: "任务完成" }),
    ];
    storeState.agentReasoning.status = "completed";
    html = renderTimeline();
    expect(html).toContain("reasoning-banner-completed");
    expect(html).toContain("green");
  });

  it("iteration 分隔线渲染 #N 编号", () => {
    storeState.agentReasoning.entries = [
      makeEntry({ iteration: 1, phase: "thinking" }),
      makeEntry({ iteration: 2, phase: "thinking", id: "t2" }),
    ];
    storeState.agentReasoning.status = "streaming";
    const html = renderTimeline();
    expect(html).toContain("iteration-separator");
    expect(html).toContain("#1");
    expect(html).toContain("#2");
  });

  it("非空 entries 时不渲染 pulse-ring-placeholder", () => {
    storeState.agentReasoning.entries = [makeEntry({ phase: "thinking" })];
    storeState.agentReasoning.status = "streaming";
    const html = renderTimeline();
    expect(html).not.toContain("pulse-ring-placeholder");
  });
});
