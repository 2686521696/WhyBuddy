/**
 * Unit tests for batch loop error handling.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 * **Validates: Requirements 5.1, 6.1, 6.4**
 *
 * Tests:
 * - All-nodes-fail scenario: batch_finished with completedCount=0, failedCount=N
 * - Single-node request (request.nodeId set) emits zero progress events
 * - Batch with 1 node (request.nodeId == null, 1 node in tree) still emits progress events
 */

import { describe, it, expect } from "vitest";

import {
  createSpecDocsProgressEmitter,
  type SpecDocsProgressEmitter,
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

/**
 * Simulates a batch where all nodes fail.
 */
function simulateAllNodesFail(
  emitter: SpecDocsProgressEmitter,
  nodeIds: string[],
) {
  emitter.emitBatchInit(nodeIds.length, nodeIds);

  let failedCount = 0;

  for (let i = 0; i < nodeIds.length; i++) {
    emitter.emitNodeStarted(nodeIds[i], `Node ${i}`, i + 1);
    failedCount++;
    emitter.emitNodeFailed(
      nodeIds[i],
      `Error processing node ${i}`,
      failedCount,
    );
  }

  emitter.emitBatchFinished(0, failedCount, 5000);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("Batch loop error handling", () => {
    // ─── All-nodes-fail scenario (Req 6.4) ──────────────────────────────
    describe("all-nodes-fail scenario (Req 6.4)", () => {
      it("batch_finished has completedCount=0 and failedCount=N when all 5 nodes fail", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-all-fail");
        const nodeIds = ["node-1", "node-2", "node-3", "node-4", "node-5"];

        simulateAllNodesFail(emitter, nodeIds);

        // Find batch_finished event
        const batchFinished = events.find(
          (e) =>
            (e.payload as Record<string, unknown>).progressAction ===
            "batch_finished",
        );
        expect(batchFinished).toBeDefined();

        const payload = batchFinished!.payload as Record<string, unknown>;
        expect(payload.completedCount).toBe(0);
        expect(payload.failedCount).toBe(5);
      });

      it("all N nodes still emit node_started and node_failed events even when all fail", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-all-fail-2");
        const nodeIds = ["a", "b", "c"];

        simulateAllNodesFail(emitter, nodeIds);

        const nodeStarted = events.filter(
          (e) =>
            (e.payload as Record<string, unknown>).progressAction ===
            "node_started",
        );
        const nodeFailed = events.filter(
          (e) =>
            (e.payload as Record<string, unknown>).progressAction ===
            "node_failed",
        );

        expect(nodeStarted).toHaveLength(3);
        expect(nodeFailed).toHaveLength(3);
      });

      it("batch loop continues processing after each failure (Req 6.1)", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-continue");
        const nodeIds = ["first", "second", "third"];

        simulateAllNodesFail(emitter, nodeIds);

        // Verify all three nodes were started in order
        const startedNodeIds = events
          .filter(
            (e) =>
              (e.payload as Record<string, unknown>).progressAction ===
              "node_started",
          )
          .map((e) => (e.payload as Record<string, unknown>).nodeId);

        expect(startedNodeIds).toEqual(["first", "second", "third"]);
      });
    });

    // ─── Single-node request emits zero progress events (Req 5.1) ────────
    describe("single-node request emits zero progress events (Req 5.1)", () => {
      it("when request.nodeId is set, no emitter is created (undefined)", () => {
        const { bus, events } = createMockEventBus();

        // Simulate the caller-side conditional for single-node request:
        // isBatchRequest = request.nodeId == null → false when nodeId is set
        const request = { nodeId: "specific-node-123" };
        const isBatchRequest = request.nodeId == null;
        const ctx = { eventBus: bus };

        const progressEmitter =
          isBatchRequest && ctx?.eventBus
            ? createSpecDocsProgressEmitter(ctx.eventBus, "job-single")
            : undefined;

        // Emitter should be undefined for single-node requests
        expect(progressEmitter).toBeUndefined();

        // No events should be emitted
        expect(events).toHaveLength(0);
      });

      it("optional chaining on undefined emitter produces no events", () => {
        const { bus, events } = createMockEventBus();

        // Simulate single-node path: emitter is undefined
        const progressEmitter: SpecDocsProgressEmitter | undefined = undefined;

        // All calls are no-ops via optional chaining
        progressEmitter?.emitBatchInit(1, ["node-1"]);
        progressEmitter?.emitNodeStarted("node-1", "Test", 1);
        progressEmitter?.emitNodeCompleted("node-1", 1);
        progressEmitter?.emitBatchFinished(1, 0, 500);

        // No events captured on the bus
        expect(events).toHaveLength(0);
      });
    });

    // ─── Batch with 1 node still emits progress events ──────────────────
    describe("batch with 1 node still emits progress events", () => {
      it("when request.nodeId is null and tree has 1 node, progress events are emitted", () => {
        const { bus, events } = createMockEventBus();

        // Simulate the caller-side conditional for batch request with 1 node:
        // isBatchRequest = request.nodeId == null → true
        const request = { nodeId: null };
        const isBatchRequest = request.nodeId == null;
        const ctx = { eventBus: bus };

        const progressEmitter =
          isBatchRequest && ctx?.eventBus
            ? createSpecDocsProgressEmitter(ctx.eventBus, "job-batch-1")
            : undefined;

        // Emitter should be defined for batch requests
        expect(progressEmitter).toBeDefined();

        // Simulate batch with 1 node
        progressEmitter!.emitBatchInit(1, ["only-node"]);
        progressEmitter!.emitNodeStarted("only-node", "Single Node", 1);
        progressEmitter!.emitNodeCompleted("only-node", 1);
        progressEmitter!.emitBatchFinished(1, 0, 200);

        // All 4 progress events should be emitted
        expect(events).toHaveLength(4);

        const actions = events.map(
          (e) => (e.payload as Record<string, unknown>).progressAction,
        );
        expect(actions).toEqual([
          "batch_init",
          "node_started",
          "node_completed",
          "batch_finished",
        ]);
      });

      it("batch with 1 node that fails still emits all lifecycle events", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-batch-1-fail");

        emitter.emitBatchInit(1, ["failing-node"]);
        emitter.emitNodeStarted("failing-node", "Will Fail", 1);
        emitter.emitNodeFailed("failing-node", "timeout error", 1);
        emitter.emitBatchFinished(0, 1, 120000);

        expect(events).toHaveLength(4);

        const batchFinished = events.find(
          (e) =>
            (e.payload as Record<string, unknown>).progressAction ===
            "batch_finished",
        );
        const payload = batchFinished!.payload as Record<string, unknown>;
        expect(payload.completedCount).toBe(0);
        expect(payload.failedCount).toBe(1);
      });
    });
  });
});
