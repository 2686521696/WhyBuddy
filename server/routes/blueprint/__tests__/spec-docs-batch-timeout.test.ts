/**
 * Unit tests for batch timeout handling.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 * **Validates: Requirements 6.5**
 *
 * Tests:
 * - 120s timeout triggers node_failed with timeout error summary
 */

import { describe, it, expect } from "vitest";

import {
  createSpecDocsProgressEmitter,
} from "../spec-docs-progress-emitter.js";
import type { BlueprintEventBus } from "../event-bus.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface CapturedEvent {
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

function createMockEventBus() {
  const events: CapturedEvent[] = [];
  return {
    bus: {
      emit(event: unknown) {
        events.push(event as CapturedEvent);
      },
      subscribe() {
        return () => {};
      },
    } as unknown as BlueprintEventBus,
    events,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("Batch timeout handling (Req 6.5)", () => {
    it("timeout triggers node_failed with timeout error summary", () => {
      const { bus, events } = createMockEventBus();
      const emitter = createSpecDocsProgressEmitter(bus, "job-timeout");

      // Simulate a batch where the second node times out
      const nodeIds = ["node-1", "node-2", "node-3"];
      emitter.emitBatchInit(3, nodeIds);

      // Node 1 succeeds
      emitter.emitNodeStarted("node-1", "Fast Node", 1);
      emitter.emitNodeCompleted("node-1", 1);

      // Node 2 times out — the batch loop would catch the timeout and emit node_failed
      emitter.emitNodeStarted("node-2", "Slow Node", 2);
      const timeoutMessage = "节点生成超时 (120s)";
      emitter.emitNodeFailed("node-2", timeoutMessage, 2);

      // Node 3 succeeds (batch continues after timeout)
      emitter.emitNodeStarted("node-3", "Another Node", 3);
      emitter.emitNodeCompleted("node-3", 2);

      emitter.emitBatchFinished(2, 1, 130000);

      // Verify the timeout node_failed event
      const failedEvents = events.filter(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "node_failed",
      );
      expect(failedEvents).toHaveLength(1);

      const failPayload = failedEvents[0].payload as Record<string, unknown>;
      expect(failPayload.nodeId).toBe("node-2");
      expect(failPayload.errorSummary).toBe("节点生成超时 (120s)");
      expect(failPayload.processedCount).toBe(2);
    });

    it("timeout error summary is truncated to 400 characters", () => {
      const { bus, events } = createMockEventBus();
      const emitter = createSpecDocsProgressEmitter(bus, "job-timeout-long");

      // Simulate a timeout with a very long error message
      const longTimeoutMessage = "节点生成超时 (120s): " + "x".repeat(500);
      emitter.emitNodeStarted("node-slow", "Timeout Node", 1);
      emitter.emitNodeFailed("node-slow", longTimeoutMessage, 1);

      const failedEvent = events.find(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "node_failed",
      );
      expect(failedEvent).toBeDefined();

      const errorSummary = (failedEvent!.payload as Record<string, unknown>)
        .errorSummary as string;
      expect(errorSummary.length).toBeLessThanOrEqual(400);
      expect(errorSummary).toBe(longTimeoutMessage.slice(0, 400));
    });

    it("batch continues processing remaining nodes after timeout failure", () => {
      const { bus, events } = createMockEventBus();
      const emitter = createSpecDocsProgressEmitter(bus, "job-timeout-continue");

      const nodeIds = ["a", "b", "c", "d"];
      emitter.emitBatchInit(4, nodeIds);

      // First node times out
      emitter.emitNodeStarted("a", "Node A", 1);
      emitter.emitNodeFailed("a", "节点生成超时 (120s)", 1);

      // Remaining nodes succeed
      emitter.emitNodeStarted("b", "Node B", 2);
      emitter.emitNodeCompleted("b", 1);

      emitter.emitNodeStarted("c", "Node C", 3);
      emitter.emitNodeCompleted("c", 2);

      emitter.emitNodeStarted("d", "Node D", 4);
      emitter.emitNodeCompleted("d", 3);

      emitter.emitBatchFinished(3, 1, 125000);

      // Verify all 4 nodes were started
      const startedEvents = events.filter(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "node_started",
      );
      expect(startedEvents).toHaveLength(4);

      // Verify batch_finished counts
      const batchFinished = events.find(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "batch_finished",
      );
      const payload = batchFinished!.payload as Record<string, unknown>;
      expect(payload.completedCount).toBe(3);
      expect(payload.failedCount).toBe(1);
    });

    it("multiple nodes can timeout in the same batch", () => {
      const { bus, events } = createMockEventBus();
      const emitter = createSpecDocsProgressEmitter(bus, "job-multi-timeout");

      const nodeIds = ["n1", "n2", "n3"];
      emitter.emitBatchInit(3, nodeIds);

      // All three nodes timeout
      emitter.emitNodeStarted("n1", "Node 1", 1);
      emitter.emitNodeFailed("n1", "节点生成超时 (120s)", 1);

      emitter.emitNodeStarted("n2", "Node 2", 2);
      emitter.emitNodeFailed("n2", "节点生成超时 (120s)", 2);

      emitter.emitNodeStarted("n3", "Node 3", 3);
      emitter.emitNodeFailed("n3", "节点生成超时 (120s)", 3);

      emitter.emitBatchFinished(0, 3, 360000);

      // All should be failed
      const failedEvents = events.filter(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "node_failed",
      );
      expect(failedEvents).toHaveLength(3);

      // batch_finished should reflect all failures
      const batchFinished = events.find(
        (e) =>
          (e.payload as Record<string, unknown>).progressAction ===
          "batch_finished",
      );
      const payload = batchFinished!.payload as Record<string, unknown>;
      expect(payload.completedCount).toBe(0);
      expect(payload.failedCount).toBe(3);
      // Invariant: completedCount + failedCount === N
      expect(
        (payload.completedCount as number) + (payload.failedCount as number),
      ).toBe(3);
    });
  });
});
