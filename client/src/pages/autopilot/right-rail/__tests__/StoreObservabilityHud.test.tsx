/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — StoreObservabilityHud 回归测试。
 *
 * 测试三件事：
 * 1. 当 store 三个切片都为空时，HUD 容器仍渲染（保持 testid 可见），但内部
 *    三个子组件全部返回 null，使 HUD 实际只是一个空壳子（视觉上几乎不可见）。
 * 2. 当任一切片有数据时，对应子组件出现在 HUD 内部。
 * 3. AutopilotRoutePage 把 <StoreObservabilityHud /> 挂在 AutopilotVisualStage
 *    内部 absolute overlay 中，并位于 fabric 分支之外，使得 input / clarification
 *    等阶段也能看到该 HUD。
 *
 * 测试策略与本仓既有 right-rail 测试保持一致：使用 `react-dom/server`
 * `renderToStaticMarkup` + `vi.mock` 替换 `useBlueprintRealtimeStore`。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentProgressEntry,
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

// ─── 受控的 store 切片 ────────────────────────────────────────────────────

interface MockedSlices {
  rolePhases: Record<string, RolePhase>;
  capabilityStatuses: Record<string, CapabilityStatus>;
  agentProgress: AgentProgressEntry[];
  agentReasoning: {
    jobId: string | null;
    entries: Array<{
      id: string;
      jobId: string;
      iteration: number;
      iterationLabel: string;
      phase: string;
      thought?: string;
      actionToolId?: string;
      observationSuccess?: boolean;
      observationSummary?: string;
      reason?: string;
      error?: string;
      timestamp: string;
    }>;
    currentIteration: number;
    status: string;
  };
}

let mockedSlices: MockedSlices = {
  rolePhases: {},
  capabilityStatuses: {},
  agentProgress: [],
  agentReasoning: {
    jobId: null,
    entries: [],
    currentIteration: 0,
    status: "idle",
  },
};

function setMockedSlices(next: Partial<MockedSlices>): void {
  mockedSlices = {
    rolePhases: next.rolePhases ?? {},
    capabilityStatuses: next.capabilityStatuses ?? {},
    agentProgress: next.agentProgress ?? [],
    agentReasoning:
      next.agentReasoning ?? {
        jobId: null,
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
  };
}

function resetMockedSlices(): void {
  mockedSlices = {
    rolePhases: {},
    capabilityStatuses: {},
    agentProgress: [],
    agentReasoning: {
      jobId: null,
      entries: [],
      currentIteration: 0,
      status: "idle",
    },
  };
}

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: MockedSlices) => unknown) => {
    return selector ? selector(mockedSlices) : mockedSlices;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { StoreObservabilityHud } from "../StoreObservabilityHud";

// ─── 用例 ──────────────────────────────────────────────────────────────────

describe("StoreObservabilityHud", () => {
  beforeEach(() => {
    resetMockedSlices();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedSlices();
  });

  it("renders the HUD container even when all slices are empty (子组件 null 但壳子存在)", () => {
    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    // 容器自身仍被渲染（只是一个透明壳子）
    expect(markup).toContain('data-testid="store-observability-hud"');

    // 四个子组件的 testid 都不应该出现，因为切片为空时它们各自返回 null
    expect(markup).not.toContain('data-testid="role-status-strip"');
    expect(markup).not.toContain('data-testid="capability-rail"');
    expect(markup).not.toContain('data-testid="agent-reasoning-sub-timeline"');
    expect(markup).not.toContain('data-testid="fleet-activation-log"');
  });

  it("mounts AgentReasoningSubTimeline when agentReasoning.entries has data", () => {
    setMockedSlices({
      agentReasoning: {
        jobId: "intake-1",
        entries: [
          {
            id: "evt-1",
            jobId: "intake-1",
            iteration: 1,
            iterationLabel: "iter-1",
            phase: "thinking",
            thought: "正在扫描 GitHub 仓库...",
            timestamp: "2026-05-16T07:19:16.085Z",
          },
        ],
        currentIteration: 1,
        status: "streaming",
      },
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    expect(markup).toContain('data-testid="agent-reasoning-sub-timeline"');
    expect(markup).toContain("正在扫描 GitHub 仓库");
  });

  it("mounts RoleStatusStrip when rolePhases has data", () => {
    setMockedSlices({ rolePhases: { planner: "thinking" } });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    expect(markup).toContain('data-testid="role-status-strip"');
    expect(markup).toContain("planner");
  });

  it("mounts CapabilityRail when capabilityStatuses has data", () => {
    setMockedSlices({
      capabilityStatuses: { "docker-analysis-sandbox": "invoking" },
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    expect(markup).toContain('data-testid="capability-rail"');
    expect(markup).toContain("docker-analysis-sandbox");
  });

  it("mounts FleetActivationLog when agentProgress has data", () => {
    setMockedSlices({
      agentProgress: [
        {
          id: "p-1",
          roleId: "role-01",
          type: "thinking",
          message: "scanning repo",
          timestamp: Date.UTC(2025, 0, 1, 0, 0, 0),
        },
      ],
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    expect(markup).toContain('data-testid="fleet-activation-log"');
    expect(markup).toContain("role-01");
    expect(markup).toContain("scanning repo");
  });

  it("AutopilotRoutePage 把 <AgentReasoningSubTimeline /> 挂在每个 active 子阶段卡片内（HUD 浮条已移除）", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../AutopilotRoutePage.tsx"),
      "utf8"
    );

    // HUD 浮层已移除（用户反馈：不要 HUD 浮条），AutopilotRoutePage 不再
    // 引用 <StoreObservabilityHud />。
    expect(source).not.toMatch(/<StoreObservabilityHud\b/);

    // <AgentReasoningSubTimeline /> 挂在 intake_created / clarification /
    // route 三个阶段的卡片中（target_input 是用户填写阶段，没有 LLM 调用，
    // 因此不挂载）。每个挂载点都通过 stageFilter 限定只显示属于自身阶段
    // 的事件，避免阶段间事件互相污染。其中 "route" 卡片是路线生成 + 路线
    // 选择 + spec_tree 派生三段后端 stage 在前端的合并视图，stageFilter 用
    // 数组形态同时承接这三个 stageId。
    // 总计预期：3 个 isActive + 3 个 isCompleted = 6 处。
    const jsxMatches = source.match(/<AgentReasoningSubTimeline\b/g) ?? [];
    expect(jsxMatches.length).toBeGreaterThanOrEqual(6);

    // 关键事实：clarification / route / intake_created 在 isActive 分支体内
    // 都紧跟一个 AgentReasoningSubTimeline 引用，并通过 stageFilter 限定
    // 该阶段只显示属于自身的事件。其中 intake_created 承接的是仓库扫描的
    // thinking / observing 流（stageId="intake_created"），让"输入时的执行
    // 过程"挂在"输入记录"卡片下；route 卡片合并 route_generation /
    // route_selection / spec_tree 三段事件，让用户从"看路线"到"选路线"再到
    // "系统派生 SPEC"都能在同一卡片底部看到对应事件流，不会出现断层。
    expect(source).toMatch(
      /isActive\s*&&\s*sub\s*===\s*"intake_created"[\s\S]*?<AgentReasoningSubTimeline\b[\s\S]*?stageFilter=\{?["']intake_created["']\}?/
    );
    expect(source).toMatch(
      /isActive\s*&&\s*sub\s*===\s*"clarification"[\s\S]*?<AgentReasoningSubTimeline\b/
    );
    expect(source).toMatch(
      /isActive\s*&&\s*sub\s*===\s*"route"[\s\S]*?<AgentReasoningSubTimeline\b[\s\S]*?stageFilter=\{[\s\S]*?spec_tree[\s\S]*?\}/
    );
  });
});
