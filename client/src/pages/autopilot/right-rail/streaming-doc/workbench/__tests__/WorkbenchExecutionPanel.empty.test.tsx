import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import { WorkbenchExecutionPanel } from "../WorkbenchExecutionPanel";
import type { WorkbenchExecutionPanelProps } from "../WorkbenchExecutionPanel";

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

describe("WorkbenchExecutionPanel empty states", () => {
  it("keeps both split lanes mounted when job and reasoning are empty", () => {
    mockReasoningEntries = [];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job: null })} />
    );

    expect(markup).toContain('data-testid="autopilot-workbench-execution-panel"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-split-panel"');
    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
    // New baseline: placeholder cards replace the old EmptyLane text
    expect(markup).toContain('data-testid="autopilot-process-execution-placeholder"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-placeholder"');
    expect(markup).not.toContain('data-testid="mirofish-card-artifact"');
    expect(markup).not.toContain('data-testid="mirofish-card-reasoning"');
  });

  it("renders execution and artifact cards without empty placeholders", () => {
    mockReasoningEntries = [];

    const job = {
      id: "job-1",
      artifacts: [{ id: "a1", type: "spec_document", title: "Spec document", payload: {} }],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            {
              id: "r1",
              phase: "thinking",
              iteration: 1,
              iterationLabel: "#1",
              timestamp: "2026-01-01T00:00:00Z",
              stageId: "spec_docs",
              thought: "Generate spec document",
            },
          ] as any,
        })}
      />
    );

    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).not.toContain('data-testid="autopilot-process-execution-empty"');
    expect(markup).not.toContain('data-testid="autopilot-process-artifact-empty"');
  });

  it("renders a fallback execution fact while artifact cards remain visible", () => {
    mockReasoningEntries = [];

    const job = {
      id: "job-2",
      artifacts: [{ id: "a1", type: "spec_document", title: "Spec document", payload: {} }],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job })} />
    );

    expect(markup.indexOf('data-testid="autopilot-process-execution-lane"')).toBeLessThan(
      markup.indexOf('data-testid="autopilot-process-artifact-lane"')
    );
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain("阶段已产出");
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).not.toContain('data-testid="autopilot-process-artifact-empty"');
    expect(markup).not.toContain('data-testid="autopilot-process-execution-empty"');
  });

  it("keeps the artifact lane empty while execution cards remain visible", () => {
    mockReasoningEntries = [];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job: null,
          reasoningEntries: [
            {
              id: "r1",
              phase: "thinking",
              iteration: 1,
              iterationLabel: "#1",
              timestamp: "2026-01-01T00:00:00Z",
              stageId: "spec_docs",
              thought: "Read spec tree",
            },
          ] as any,
        })}
      />
    );

    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    // New baseline: artifact placeholder card replaces the old EmptyLane text
    expect(markup).toContain('data-testid="autopilot-process-artifact-placeholder"');
    expect(markup).not.toContain('data-testid="autopilot-process-execution-placeholder"');
  });

  it("does not render list containers in the split lanes", () => {
    mockReasoningEntries = [];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job: null })} />
    );

    expect(markup).not.toMatch(/<ul\b/);
    expect(markup).not.toMatch(/<ol\b/);
    expect(markup).not.toMatch(/data-testid="[^"]*-list"/);
  });
});
