/**
 * Unit tests for SpecDocsProgressPanel rendering.
 *
 * Testing strategy: Uses `react-dom/server` `renderToStaticMarkup` + `vi.mock`
 * to replace `useBlueprintRealtimeStore`, consistent with existing right-rail
 * test patterns (RoleStatusStrip.test.tsx, CapabilityRail.test.tsx).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 5.2, 6.2, 6.3
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SpecDocsNodeEntry,
  SpecDocsBatchSummary,
  SpecDocsProgressState,
} from "@/lib/blueprint-realtime-store";

// ─── Controlled store state ───────────────────────────────────────────────

let mockedProgress: SpecDocsProgressState = {
  batchStatus: "idle",
  totalCount: 0,
  completedCount: 0,
  assembledCount: 0,
  processedCount: 0,
  nodeOrder: [],
  nodes: {},
  summary: null,
  dismissed: false,
};

const mockDismiss = vi.fn();

function setMockedProgress(next: Partial<SpecDocsProgressState>): void {
  mockedProgress = { ...mockedProgress, ...next };
}

function resetMockedProgress(): void {
  mockedProgress = {
    batchStatus: "idle",
    totalCount: 0,
    completedCount: 0,
    assembledCount: 0,
    processedCount: 0,
    nodeOrder: [],
    nodes: {},
    summary: null,
    dismissed: false,
  };
  mockDismiss.mockClear();
}

// ─── Mock `@/lib/blueprint-realtime-store` ────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: Record<string, unknown>) => unknown
  ) => {
    const snapshot = {
      specDocsProgress: mockedProgress,
      dismissSpecDocsProgress: mockDismiss,
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { SpecDocsProgressPanel } from "../SpecDocsProgressPanel";

// ─── Test helpers ─────────────────────────────────────────────────────────

function makeNode(
  nodeId: string,
  status: SpecDocsNodeEntry["status"],
  title = nodeId,
  errorSummary?: string
): SpecDocsNodeEntry {
  return { nodeId, title, position: 0, status, errorSummary };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SpecDocsProgressPanel render contract", () => {
  beforeEach(() => {
    resetMockedProgress();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedProgress();
  });

  // Req 5.2: Panel not rendered when batchStatus is idle
  it("returns null when batchStatus is idle", () => {
    setMockedProgress({ batchStatus: "idle" });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toBe("");
  });

  // Req 3.7: Panel not rendered when dismissed is true
  it("returns null when dismissed is true", () => {
    setMockedProgress({ batchStatus: "finished", dismissed: true });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toBe("");
  });

  // Req 3.1: Panel renders with completion counter during batch
  it("renders completion counter showing processed/total during batch", () => {
    setMockedProgress({
      batchStatus: "running",
      totalCount: 8,
      processedCount: 3,
      completedCount: 3,
      assembledCount: 0,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "processing", "Node 1") },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toContain("spec-docs-progress-panel");
    expect(markup).toContain("3/8");
    expect(markup).toContain("生成中");
  });

  // Req 3.2: Processing node shows animated indicator
  it("shows animated spinner indicator for processing node", () => {
    setMockedProgress({
      batchStatus: "running",
      totalCount: 3,
      processedCount: 0,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "processing", "Processing Node") },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    // The processing indicator uses CSS animation
    expect(markup).toContain("status-processing");
    expect(markup).toContain("spec-docs-spin");
    expect(markup).toContain("Processing Node");
  });

  // Req 3.3: Completed node shows success indicator
  it("shows success indicator (checkmark) for completed node", () => {
    setMockedProgress({
      batchStatus: "running",
      totalCount: 3,
      processedCount: 1,
      completedCount: 1,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "completed", "Done Node") },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toContain("status-completed");
    expect(markup).toContain("✓");
    expect(markup).toContain("Done Node");
  });

  // Req 3.4: Failed node shows error indicator and tooltip
  it("shows error indicator and error tooltip for failed node", () => {
    setMockedProgress({
      batchStatus: "running",
      totalCount: 3,
      processedCount: 1,
      nodeOrder: ["n1"],
      nodes: {
        n1: makeNode("n1", "failed", "Failed Node", "Something went wrong"),
      },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toContain("status-failed");
    expect(markup).toContain("✗");
    expect(markup).toContain("Failed Node");
    // Error tooltip trigger should be present
    expect(markup).toContain("error-tooltip-trigger");
  });

  // Req 3.5: Summary line displays on batch finish
  it("displays summary line with counts and elapsed time on batch finish", () => {
    setMockedProgress({
      batchStatus: "finished",
      totalCount: 8,
      processedCount: 8,
      completedCount: 5,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "completed", "Node 1") },
      summary: {
        completedCount: 5,
        failedCount: 3,
        elapsedMs: 125000, // 2:05
      },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toContain("batch-summary");
    expect(markup).toContain("5 成功");
    expect(markup).toContain("3 失败");
    expect(markup).toContain("2:05");
  });

  // Req 3.7: Dismiss button appears only when batch is finished
  it("does not show dismiss button while batch is running", () => {
    setMockedProgress({
      batchStatus: "running",
      totalCount: 3,
      processedCount: 1,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "processing", "Node 1") },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).not.toContain("dismiss-btn");
  });

  it("shows dismiss button when batch is finished", () => {
    setMockedProgress({
      batchStatus: "finished",
      totalCount: 3,
      processedCount: 3,
      completedCount: 3,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "completed", "Node 1") },
      summary: { completedCount: 3, failedCount: 0, elapsedMs: 5000 },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    expect(markup).toContain("dismiss-btn");
    expect(markup).toContain("关闭进度面板");
  });

  // Req 3.7: Dismiss button click hides panel
  // Note: Since we use renderToStaticMarkup (SSR), we cannot test click handlers
  // directly. Instead, we verify the dismiss action is wired by checking that
  // the store's dismissSpecDocsProgress is consumed and that dismissed=true hides panel.
  it("panel is hidden after dismiss (dismissed=true)", () => {
    // First verify panel is visible when finished and not dismissed
    setMockedProgress({
      batchStatus: "finished",
      totalCount: 3,
      processedCount: 3,
      completedCount: 3,
      nodeOrder: ["n1"],
      nodes: { n1: makeNode("n1", "completed", "Node 1") },
      summary: { completedCount: 3, failedCount: 0, elapsedMs: 5000 },
      dismissed: false,
    });

    let markup = renderToStaticMarkup(<SpecDocsProgressPanel />);
    expect(markup).toContain("spec-docs-progress-panel");

    // After dismiss, panel should not render
    setMockedProgress({ dismissed: true });
    markup = renderToStaticMarkup(<SpecDocsProgressPanel />);
    expect(markup).toBe("");
  });

  // Req 6.2, 6.3: Mixed success/failure rendering
  it("renders mixed completed and failed nodes correctly", () => {
    setMockedProgress({
      batchStatus: "finished",
      totalCount: 3,
      processedCount: 3,
      completedCount: 2,
      nodeOrder: ["n1", "n2", "n3"],
      nodes: {
        n1: makeNode("n1", "completed", "Node A"),
        n2: makeNode("n2", "failed", "Node B", "Timeout error"),
        n3: makeNode("n3", "completed", "Node C"),
      },
      summary: { completedCount: 2, failedCount: 1, elapsedMs: 30000 },
    });

    const markup = renderToStaticMarkup(<SpecDocsProgressPanel />);

    // Both success and failure indicators present
    expect(markup).toContain("status-completed");
    expect(markup).toContain("status-failed");
    expect(markup).toContain("Node A");
    expect(markup).toContain("Node B");
    expect(markup).toContain("Node C");
    // Summary shows both counts
    expect(markup).toContain("2 成功");
    expect(markup).toContain("1 失败");
  });
});
