/**
 * `autopilot-spec-documents-workbench-v2` Phase 2 / Task 8 — 底部执行面板左右双栏拆分 SSR 测试。
 *
 * 测试策略与本仓既有 right-rail 测试保持一致：使用 `react-dom/server` 的
 * `renderToStaticMarkup` + `vi.mock` 的组合，对 SSR 输出做字符串级断言。
 *
 * 本测试覆盖 requirements R5.1 / R5.2 / R5.3 / R5.4 / R5.5 / R5.6 / R5.7 / R5.8 / R6.5：
 * - 当 job 有 artifacts 且 reasoning entries 非空时，左右两栏的 `data-testid` 同时出现，
 *   observing chip 出现，角色分类小标题出现。
 * - 当 observing snapshot 为空时，observing chip 不渲染。
 * - 当 reasoning entries 为空时，右栏仅渲染空态占位文案，无角色小标题，无 stream stub。
 * - 当 artifacts 为空时，左栏仅渲染空态占位文案，无 observing chip，无 stream stub。
 * - 任何情况下均不出现 `<ul>` / `<ol>` / `*-list` testid。
 * - 外层 `data-testid="autopilot-workbench-execution-panel"` 始终存在。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock `useBlueprintRealtimeStore`：可配置 agentReasoning.entries 返回值。
let mockReasoningEntries: unknown[] = [];

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: mockReasoningEntries },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

// Mock `MiroFishCardStream`：渲染为简单 stub div，便于断言其存在/缺失。
vi.mock(
  "../../../mirofish-stream/MiroFishCardStream",
  () => ({
    MiroFishCardStream: () => (
      <div data-testid="mock-mirofish-card-stream" />
    ),
  })
);

// Mock `parseSpecDocsObservingEntries`：可配置返回值。
let mockObservingSnapshot = { byNodeTitle: new Map<string, string>() };

vi.mock(
  "../../../parse-spec-docs-observing",
  () => ({
    parseSpecDocsObservingEntries: () => mockObservingSnapshot,
  })
);

import { WorkbenchExecutionPanel } from "../WorkbenchExecutionPanel";
import type { WorkbenchExecutionPanelProps } from "../WorkbenchExecutionPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<WorkbenchExecutionPanelProps> = {}
): WorkbenchExecutionPanelProps {
  return {
    job: null,
    locale: "zh-CN",
    reasoningEntries: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkbenchExecutionPanel split layout (Phase 2 / Task 8)", () => {
  it("keeps a fixed parent-controlled height with internal scrolling instead of growing over the main workspace", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job: {
            id: "job-fixed-height",
            artifacts: Array.from({ length: 8 }, (_, index) => ({
              id: `artifact-${index}`,
              type: "requirements",
              title: `Requirements ${index}`,
              createdAt: "2026-01-01T00:00:01Z",
              payload: {},
            })),
          } as unknown as WorkbenchExecutionPanelProps["job"],
          reasoningEntries: Array.from({ length: 12 }, (_, index) => ({
            id: `reasoning-${index}`,
            jobId: "job-fixed-height",
            iteration: index + 1,
            phase: "observing",
            timestamp: "2026-01-01T00:00:00Z",
            stageId: "spec_docs",
            observationSummary: `Observation ${index}`,
          })) as any,
        })}
      />
    );

    expect(markup).toContain("height:100%");
    expect(markup).not.toContain("max-height:clamp");
    expect(markup).toContain("overflow-y:auto");
  });

  it("a. job has artifacts AND reasoning prop non-empty: columns render from one data source, observing chip present, role headers present", () => {
    mockReasoningEntries = [
      // Deliberately empty in the store-facing shape: this test proves the panel
      // follows its `reasoningEntries` prop instead of splitting state between
      // props and `useBlueprintRealtimeStore`.
    ];
    mockObservingSnapshot = {
      byNodeTitle: new Map([["Auth Domain", "generating"]]),
    };

    const job = {
      id: "job-1",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            { id: "r1", jobId: "job-1", iteration: 1, iterationLabel: "#1", phase: "observing", timestamp: "2026-01-01T00:00:00Z", stageId: "spec_docs", observationSummary: "✓ Auth Domain — 规格文档已生成" },
          ] as any,
        })}
      />
    );

    // The workbench must not render two complete MiroFish streams; that creates
    // duplicate subscriptions/auto-scroll behavior in the real browser.
    const streamMatches = markup.match(/data-testid="mock-mirofish-card-stream"/g);
    expect(streamMatches?.length ?? 0).toBeLessThanOrEqual(1);

    // Observing chip present
    expect(markup).toContain('data-testid="autopilot-workbench-execution-observing-chip"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');

    // Role headers present
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-analyzer"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-planner"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-generator"');

    // No empty placeholders
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-artifacts-empty"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-reasoning-empty"');
  });

  it("b. observing snapshot empty: observing chip NOT rendered", () => {
    mockReasoningEntries = [{ id: "r1", phase: "thinking", iteration: 1 }];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const job = {
      id: "job-2",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
    );

    // Observing chip NOT present
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-observing-chip"');

    // Left column still renders artifact cards (has artifacts)
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });

  it("c. reasoning props empty: right column renders only empty placeholder, no role headers, no stream stub", () => {
    mockReasoningEntries = [];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const job = {
      id: "job-3",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
    );

    // Right column has empty placeholder
    expect(markup).toContain('data-testid="autopilot-workbench-execution-reasoning-empty"');

    // No role headers
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-role-analyzer"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-role-planner"');
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-role-generator"');

    // Left column still renders artifact cards (has artifacts)
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });

  it("d. artifacts empty: left column renders only empty placeholder, no observing chip, no stream stub", () => {
    mockReasoningEntries = [{ id: "r1", phase: "thinking", iteration: 1 }];
    mockObservingSnapshot = {
      byNodeTitle: new Map([["Auth Domain", "generating"]]),
    };

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job: null,
          reasoningEntries: [
            { id: "r1", jobId: "job-1", iteration: 1, iterationLabel: "#1", phase: "observing", timestamp: "2026-01-01T00:00:00Z", stageId: "spec_docs", observationSummary: "✓ Auth Domain — 规格文档已生成" },
          ] as any,
        })}
      />
    );

    // Left column has empty placeholder
    expect(markup).toContain('data-testid="autopilot-workbench-execution-artifacts-empty"');

    // No observing chip (artifacts empty means left column is empty placeholder only)
    expect(markup).not.toContain('data-testid="autopilot-workbench-execution-observing-chip"');

    // Right column renders reasoning cards (reasoning non-empty)
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');

    // Role headers present in right column
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-analyzer"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-planner"');
    expect(markup).toContain('data-testid="autopilot-workbench-execution-role-generator"');
  });

  it("e. no <ul>, <ol>, or *-list testids in any case", () => {
    // Case 1: both non-empty
    mockReasoningEntries = [{ id: "r1", phase: "thinking", iteration: 1 }];
    mockObservingSnapshot = {
      byNodeTitle: new Map([["Auth Domain", "generating"]]),
    };

    const job = {
      id: "job-4",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    let markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
    );
    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);

    // Case 2: both empty
    mockReasoningEntries = [];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job: null, reasoningEntries: [] })} />
    );
    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);
  });

  it("f. outer data-testid='autopilot-workbench-execution-panel' always present", () => {
    mockReasoningEntries = [];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps()} />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-execution-panel"');
  });

  it("g. execution panel has a bounded scrolling budget so it cannot push the document area off-screen", () => {
    mockReasoningEntries = [
      { id: "r1", phase: "thinking", iteration: 1 },
    ];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const job = {
      id: "job-5",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            { id: "r1", jobId: "job-1", iteration: 1, iterationLabel: "#1", phase: "thinking", timestamp: "2026-01-01T00:00:00Z", stageId: "spec_docs", thought: "Analyze documents" },
          ] as any,
        })}
      />
    );

    expect(markup).toContain("height:100%");
    expect(markup).not.toContain("max-height");
    expect(markup).toContain("overflow-y:auto");
  });

  it("h. execution panel uses compact fluid columns and wraps artifact cards in an overflow guard", () => {
    mockReasoningEntries = [
      { id: "r1", phase: "thinking", iteration: 1 },
    ];
    mockObservingSnapshot = { byNodeTitle: new Map([["Auth Domain", "generating"]]) };

    const job = {
      id: "job-6",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "An intentionally long artifact title that should stay clipped inside the bottom panel",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            { id: "r1", jobId: "job-1", iteration: 1, iterationLabel: "#1", phase: "thinking", timestamp: "2026-01-01T00:00:00Z", stageId: "spec_docs", thought: "Analyze documents" },
          ] as any,
        })}
      />
    );

    expect(markup).toContain(
      "grid-template-columns:minmax(0, 0.9fr) minmax(0, 1.1fr)"
    );
    expect(markup).toContain("grid-template-rows:minmax(0, 1fr)");
    expect(markup).toContain("height:100%");
    expect(markup).toContain(
      'data-testid="autopilot-workbench-execution-artifact-card-frame"'
    );
    expect(markup).toContain("overflow-hidden");
  });

  it("i. keeps next-stage generation reasoning visible after spec document execution completes", () => {
    mockReasoningEntries = [];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          reasoningEntries: [
            {
              id: "preview-1",
              jobId: "job-1",
              iteration: 1,
              iterationLabel: "#1",
              phase: "thinking",
              timestamp: "2026-01-01T00:00:00Z",
              stageId: "effect_preview",
              thought: "Generating the effect preview from completed SPEC documents",
            },
          ] as any,
        })}
      />
    );

    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain("Generating the effect preview");
    expect(markup).not.toContain(
      'data-testid="autopilot-workbench-execution-reasoning-empty"'
    );
  });

  it("j. renders a stale badge above stale spec document artifact cards", () => {
    mockReasoningEntries = [];
    mockObservingSnapshot = { byNodeTitle: new Map() };

    const job = {
      id: "job-stale-doc-artifact",
      artifacts: [
        {
          id: "artifact-stale-requirements",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
          staleSince: "2026-05-23T08:00:00.000Z",
          invalidatedBy: {
            stage: "route_generation",
            artifactId: "route-selection-1",
            artifactType: "route_selection",
            reason: "upstream_route_selection_changed",
            triggeredAt: "2026-05-23T08:00:00.000Z",
          },
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
    );

    expect(markup).toContain('data-testid="autopilot-stale-badge"');
    expect(markup).toContain("已过期");
    expect(markup).toContain("路线");
    expect(markup).not.toContain("Stale: route_generation changed");
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });
});
