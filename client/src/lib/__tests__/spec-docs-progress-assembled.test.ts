/**
 * Unit tests for the spec docs progress reducer — node_assembled integration.
 *
 * Validates the intermediate "assembling" state between "running" and "finished",
 * ensuring "已完成" is NEVER shown while assembledCount < totalCount and
 * batch_finished has not been received.
 *
 * Requirements: Req 1, Req 4, 2.2, 2.5, 2.6
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Mock Socket.IO
// ---------------------------------------------------------------------------

const mockSocket = {
  connected: false,
  on: vi.fn(() => mockSocket),
  off: vi.fn(() => mockSocket),
  emit: vi.fn(),
  disconnect: vi.fn(),
} as unknown as Socket;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

// ---------------------------------------------------------------------------
// Import store after mocks
// ---------------------------------------------------------------------------

import {
  useBlueprintRealtimeStore,
  __setSocket,
  type BlueprintRelayedEvent,
  type SpecDocsProgressState,
} from "../blueprint-realtime-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useBlueprintRealtimeStore.getState().reset();
  vi.clearAllMocks();
}

function getProgress(): SpecDocsProgressState {
  return useBlueprintRealtimeStore.getState().specDocsProgress;
}

function createSpecDocsEvent(
  action: string,
  payload: Record<string, unknown>
): BlueprintRelayedEvent {
  return {
    type: "role.agent.observing",
    jobId: "test-job",
    timestamp: Date.now(),
    payload: {
      stageId: "spec_docs",
      roleId: "generator",
      progressAction: action,
      iteration: 1,
      ...payload,
    },
  };
}

function dispatchBatchInit(nodeIds: string[]): void {
  const event = createSpecDocsEvent("batch_init", {
    totalCount: nodeIds.length,
    nodeIds,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeStarted(nodeId: string, position: number): void {
  const event = createSpecDocsEvent("node_started", {
    nodeId,
    nodeTitle: `Title for ${nodeId}`,
    position,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeCompleted(nodeId: string, completedCount: number): void {
  const event = createSpecDocsEvent("node_completed", {
    nodeId,
    completedCount,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeAssembled(
  nodeId: string,
  position: number,
  assembledCount: number,
  totalCount: number
): void {
  const event = createSpecDocsEvent("node_assembled", {
    nodeId,
    position,
    assembledCount,
    totalCount,
    documentIds: [`doc-${nodeId}-req`, `doc-${nodeId}-design`, `doc-${nodeId}-tasks`],
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchBatchFinished(
  completedCount: number,
  failedCount: number,
  elapsedMs = 5000
): void {
  const event = createSpecDocsEvent("batch_finished", {
    completedCount,
    failedCount,
    elapsedMs,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spec docs progress reducer — node_assembled integration", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("transitions through idle → running → assembling → finished on full 24-node event stream", () => {
    const nodeIds = Array.from({ length: 24 }, (_, i) => `node-${i + 1}`);

    // Initial state: idle
    expect(getProgress().batchStatus).toBe("idle");

    // batch_init → running
    dispatchBatchInit(nodeIds);
    expect(getProgress().batchStatus).toBe("running");
    expect(getProgress().totalCount).toBe(24);
    expect(getProgress().assembledCount).toBe(0);

    // Phase 1: node_started × 24 → node_completed × 24
    for (let i = 0; i < 24; i++) {
      dispatchNodeStarted(nodeIds[i], i + 1);
      expect(getProgress().batchStatus).toBe("running");
    }
    for (let i = 0; i < 24; i++) {
      dispatchNodeCompleted(nodeIds[i], i + 1);
      // Still "running" during Phase 1 completions
      expect(getProgress().batchStatus).toBe("running");
    }
    expect(getProgress().completedCount).toBe(24);

    // Phase 2: node_assembled × 24 → transitions to "assembling"
    for (let i = 0; i < 24; i++) {
      dispatchNodeAssembled(nodeIds[i], i + 1, i + 1, 24);
      // After first node_assembled, batchStatus transitions to "assembling"
      expect(getProgress().batchStatus).toBe("assembling");
      expect(getProgress().assembledCount).toBe(i + 1);
      // "已完成" must NEVER be shown during assembling
      expect(getProgress().batchStatus).not.toBe("finished");
    }

    // All 24 assembled but batch_finished not yet received
    expect(getProgress().assembledCount).toBe(24);
    expect(getProgress().batchStatus).toBe("assembling");

    // batch_finished → "finished" (terminal "已完成" now allowed)
    dispatchBatchFinished(24, 0, 5000);
    expect(getProgress().batchStatus).toBe("finished");
    expect(getProgress().assembledCount).toBe(24);
    expect(getProgress().summary).toEqual({
      completedCount: 24,
      failedCount: 0,
      elapsedMs: 5000,
    });
  });

  it("never simultaneously shows progress 24/24 已完成 with 文档统计 0%", () => {
    // The key regression assertion from Req 5:
    // During the assembling phase, batchStatus is "assembling" (not "finished"),
    // so the UI cannot render "已完成" while documents are still being assembled.
    const nodeIds = Array.from({ length: 24 }, (_, i) => `node-${i + 1}`);

    dispatchBatchInit(nodeIds);

    // Complete all Phase 1 nodes
    for (let i = 0; i < 24; i++) {
      dispatchNodeStarted(nodeIds[i], i + 1);
      dispatchNodeCompleted(nodeIds[i], i + 1);
    }

    // At this point: completedCount = 24, but assembledCount = 0
    // batchStatus is still "running" — NOT "finished"
    const afterPhase1 = getProgress();
    expect(afterPhase1.completedCount).toBe(24);
    expect(afterPhase1.assembledCount).toBe(0);
    expect(afterPhase1.batchStatus).toBe("running");
    // The "已完成" label is gated on batchStatus === "finished", so it won't show

    // Partially assemble (simulate Phase 2 in progress)
    dispatchNodeAssembled(nodeIds[0], 1, 1, 24);
    const duringAssembly = getProgress();
    expect(duringAssembly.batchStatus).toBe("assembling");
    expect(duringAssembly.assembledCount).toBe(1);
    // Still not "finished" — "已完成" cannot appear
    expect(duringAssembly.batchStatus).not.toBe("finished");
  });

  it("node_assembled transitions node status from completed to assembled", () => {
    const nodeIds = ["node-a", "node-b"];
    dispatchBatchInit(nodeIds);
    dispatchNodeStarted("node-a", 1);
    dispatchNodeCompleted("node-a", 1);

    expect(getProgress().nodes["node-a"].status).toBe("completed");

    dispatchNodeAssembled("node-a", 1, 1, 2);
    expect(getProgress().nodes["node-a"].status).toBe("assembled");
  });

  it("node_assembled is ignored for failed nodes", () => {
    const nodeIds = ["node-a"];
    dispatchBatchInit(nodeIds);
    dispatchNodeStarted("node-a", 1);

    // Simulate node failure
    const failEvent = createSpecDocsEvent("node_failed", {
      nodeId: "node-a",
      errorSummary: "timeout",
    });
    useBlueprintRealtimeStore.getState().dispatchEvent(failEvent);
    expect(getProgress().nodes["node-a"].status).toBe("failed");

    // node_assembled should be ignored for failed nodes
    dispatchNodeAssembled("node-a", 1, 1, 1);
    expect(getProgress().nodes["node-a"].status).toBe("failed");
    // assembledCount should NOT increment
    expect(getProgress().assembledCount).toBe(0);
  });

  it("node_assembled is ignored for unknown nodes", () => {
    const nodeIds = ["node-a"];
    dispatchBatchInit(nodeIds);

    // Dispatch for unknown node
    dispatchNodeAssembled("unknown-node", 1, 1, 1);
    expect(getProgress().assembledCount).toBe(0);
    expect(getProgress().batchStatus).toBe("running");
  });

  it("completeSpecDocsProgress does NOT re-transition nodes already assembled", () => {
    const nodeIds = Array.from({ length: 24 }, (_, i) => `node-${i + 1}`);
    dispatchBatchInit(nodeIds);

    // Phase 1: complete all
    for (let i = 0; i < 24; i++) {
      dispatchNodeStarted(nodeIds[i], i + 1);
      dispatchNodeCompleted(nodeIds[i], i + 1);
    }

    // Phase 2: assemble all 24 via event stream
    for (let i = 0; i < 24; i++) {
      dispatchNodeAssembled(nodeIds[i], i + 1, i + 1, 24);
    }

    expect(getProgress().batchStatus).toBe("assembling");
    expect(getProgress().assembledCount).toBe(24);

    // Now HTTP response arrives and calls completeSpecDocsProgress
    useBlueprintRealtimeStore.getState().completeSpecDocsProgress(3000);

    const final = getProgress();
    expect(final.batchStatus).toBe("finished");
    // All nodes should still be "assembled" — not re-transitioned
    for (const nodeId of nodeIds) {
      expect(final.nodes[nodeId].status).toBe("assembled");
    }
    expect(final.assembledCount).toBe(24);
  });

  it("completeSpecDocsProgress force-completes nodes not yet assembled", () => {
    const nodeIds = ["node-a", "node-b", "node-c"];
    dispatchBatchInit(nodeIds);

    // Only node-a goes through the full pipeline
    dispatchNodeStarted("node-a", 1);
    dispatchNodeCompleted("node-a", 1);
    dispatchNodeAssembled("node-a", 1, 1, 3);

    // node-b is still processing, node-c is still pending
    dispatchNodeStarted("node-b", 2);

    expect(getProgress().nodes["node-a"].status).toBe("assembled");
    expect(getProgress().nodes["node-b"].status).toBe("processing");
    expect(getProgress().nodes["node-c"].status).toBe("pending");

    // HTTP fallback fires
    useBlueprintRealtimeStore.getState().completeSpecDocsProgress(2000);

    const final = getProgress();
    expect(final.batchStatus).toBe("finished");
    // node-a: already assembled, stays assembled
    expect(final.nodes["node-a"].status).toBe("assembled");
    // node-b and node-c: force-transitioned to assembled
    expect(final.nodes["node-b"].status).toBe("assembled");
    expect(final.nodes["node-c"].status).toBe("assembled");
  });

  it("batch_finished resolves all non-failed nodes to assembled", () => {
    const nodeIds = ["node-a", "node-b"];
    dispatchBatchInit(nodeIds);
    dispatchNodeStarted("node-a", 1);
    dispatchNodeCompleted("node-a", 1);
    // node-b stays pending (missed events)

    dispatchBatchFinished(2, 0, 1000);

    const final = getProgress();
    expect(final.batchStatus).toBe("finished");
    expect(final.nodes["node-a"].status).toBe("assembled");
    expect(final.nodes["node-b"].status).toBe("assembled");
  });
});


// ─── Phase 6: batch_finished with failedCount > 0 ──────────────────────────

describe("spec docs progress reducer — batch_finished failure-aware resolution", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("batch_finished with failedCount > 0 does NOT mark unresolved nodes as assembled", () => {
    const nodeIds = ["node-a", "node-b", "node-c"];
    dispatchBatchInit(nodeIds);
    // Phase 1: all complete
    for (const id of nodeIds) {
      dispatchNodeStarted(id, 1);
      dispatchNodeCompleted(id, 1);
    }
    // Phase 2: only node-a and node-c get assembled; node-b gets node_failed
    dispatchNodeAssembled("node-a", 1, 1, 3);
    // node-b: simulate server sending node_failed
    const failEvent = createSpecDocsEvent("node_failed", {
      nodeId: "node-b",
      errorSummary: "assembly timeout",
    });
    useBlueprintRealtimeStore.getState().dispatchEvent(failEvent);
    dispatchNodeAssembled("node-c", 3, 2, 3);
    // batch_finished with failedCount=1
    dispatchBatchFinished(2, 1, 3000);

    const final = getProgress();
    expect(final.nodes["node-a"].status).toBe("assembled");
    expect(final.nodes["node-b"].status).toBe("failed");
    expect(final.nodes["node-c"].status).toBe("assembled");
  });

  it("batch_finished with failedCount > 0 marks truly-unresolved nodes as failed", () => {
    const nodeIds = ["node-a", "node-b"];
    dispatchBatchInit(nodeIds);
    dispatchNodeStarted("node-a", 1);
    dispatchNodeCompleted("node-a", 1);
    dispatchNodeAssembled("node-a", 1, 1, 2);
    // node-b: no Phase 2 event at all (silent failure — the bug Task 11 fixes server-side)
    dispatchNodeStarted("node-b", 2);
    dispatchNodeCompleted("node-b", 1);
    // batch_finished arrives with failedCount=1
    dispatchBatchFinished(1, 1, 2000);

    const final = getProgress();
    expect(final.nodes["node-a"].status).toBe("assembled");
    // node-b should NOT be marked assembled — it should be failed
    expect(final.nodes["node-b"].status).toBe("failed");
    expect(final.nodes["node-b"].errorSummary).toContain("terminal event missed");
  });
});
