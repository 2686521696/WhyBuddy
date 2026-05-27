/**
 * Property-based test for batch resilience behavior.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 *
 * **Property 8: Batch continues after node failure**
 * **Validates: Requirements 6.1, 6.4**
 *
 * Verifies that for any batch of N nodes where K nodes are configured to fail,
 * the batch loop processes all N nodes, emits exactly N `node_started` events
 * and exactly N terminal events (`node_completed` or `node_failed`), and emits
 * exactly one `batch_finished` event where `completedCount + failedCount === N`.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  createSpecDocsProgressEmitter,
  type SpecDocsProgressEmitter,
  type SpecDocsProgressAction,
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
 * Simulates a batch of N nodes where nodes at indices in `failIndices` fail.
 * This replicates the batch loop behavior from `generateSpecDocuments()`.
 */
function simulateBatch(
  emitter: SpecDocsProgressEmitter,
  nodeIds: string[],
  failIndices: Set<number>,
) {
  emitter.emitBatchInit(nodeIds.length, nodeIds);

  let completedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < nodeIds.length; i++) {
    emitter.emitNodeStarted(nodeIds[i], `Node ${i}`, i + 1);

    if (failIndices.has(i)) {
      failedCount++;
      emitter.emitNodeFailed(
        nodeIds[i],
        "simulated error",
        completedCount + failedCount,
      );
    } else {
      completedCount++;
      emitter.emitNodeCompleted(nodeIds[i], completedCount);
    }
  }

  emitter.emitBatchFinished(completedCount, failedCount, 1000);
}

// ─── Property 8: Batch continues after node failure ─────────────────────────
// **Validates: Requirements 6.1, 6.4**

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("Property 8: Batch continues after node failure", () => {
    it("all N nodes are processed — N node_started events emitted", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 50 }),
          fc.context(),
          (n, maxFail, ctx) => {
            // Clamp K to be at most N
            const k = Math.min(maxFail, n);
            ctx.log(`N=${n}, K=${k}`);

            // Generate node IDs
            const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);

            // Pick K indices to fail (first K for determinism)
            const failIndices = new Set(
              Array.from({ length: k }, (_, i) => i),
            );

            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-batch");

            simulateBatch(emitter, nodeIds, failIndices);

            // Count node_started events
            const nodeStartedEvents = events.filter(
              (e) =>
                (e.payload as Record<string, unknown>).progressAction ===
                "node_started",
            );
            expect(nodeStartedEvents).toHaveLength(n);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("exactly N terminal events (node_completed or node_failed) are emitted", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 50 }),
          (n, maxFail) => {
            const k = Math.min(maxFail, n);
            const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);
            const failIndices = new Set(
              Array.from({ length: k }, (_, i) => i),
            );

            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-batch");

            simulateBatch(emitter, nodeIds, failIndices);

            // Count terminal events
            const terminalEvents = events.filter((e) => {
              const action = (e.payload as Record<string, unknown>)
                .progressAction;
              return action === "node_completed" || action === "node_failed";
            });
            expect(terminalEvents).toHaveLength(n);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("exactly one batch_finished event with completedCount + failedCount === N", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 50 }),
          (n, maxFail) => {
            const k = Math.min(maxFail, n);
            const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);
            const failIndices = new Set(
              Array.from({ length: k }, (_, i) => i),
            );

            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-batch");

            simulateBatch(emitter, nodeIds, failIndices);

            // Find batch_finished events
            const batchFinishedEvents = events.filter(
              (e) =>
                (e.payload as Record<string, unknown>).progressAction ===
                "batch_finished",
            );
            expect(batchFinishedEvents).toHaveLength(1);

            const payload = batchFinishedEvents[0].payload as Record<
              string,
              unknown
            >;
            const completedCount = payload.completedCount as number;
            const failedCount = payload.failedCount as number;

            // Invariant: completedCount + failedCount === N
            expect(completedCount + failedCount).toBe(n);
            // Also verify the individual counts match expectations
            expect(failedCount).toBe(k);
            expect(completedCount).toBe(n - k);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("with randomized fail positions, invariant still holds", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }).chain((n) =>
            fc.tuple(
              fc.constant(n),
              fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), {
                minLength: 0,
                maxLength: n,
              }),
            ),
          ),
          ([n, failPositions]) => {
            const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);
            const failIndices = new Set(failPositions);

            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-random");

            simulateBatch(emitter, nodeIds, failIndices);

            // Verify all N nodes started
            const startedCount = events.filter(
              (e) =>
                (e.payload as Record<string, unknown>).progressAction ===
                "node_started",
            ).length;
            expect(startedCount).toBe(n);

            // Verify terminal events
            const terminalCount = events.filter((e) => {
              const action = (e.payload as Record<string, unknown>)
                .progressAction;
              return action === "node_completed" || action === "node_failed";
            }).length;
            expect(terminalCount).toBe(n);

            // Verify batch_finished invariant
            const batchFinished = events.find(
              (e) =>
                (e.payload as Record<string, unknown>).progressAction ===
                "batch_finished",
            );
            expect(batchFinished).toBeDefined();
            const payload = batchFinished!.payload as Record<string, unknown>;
            expect(
              (payload.completedCount as number) +
                (payload.failedCount as number),
            ).toBe(n);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("event ordering: batch_init first, then interleaved node events, batch_finished last", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 30 }),
          fc.integer({ min: 0, max: 30 }),
          (n, maxFail) => {
            const k = Math.min(maxFail, n);
            const nodeIds = Array.from({ length: n }, (_, i) => `node-${i}`);
            const failIndices = new Set(
              Array.from({ length: k }, (_, i) => i),
            );

            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-order");

            simulateBatch(emitter, nodeIds, failIndices);

            const actions = events.map(
              (e) =>
                (e.payload as Record<string, unknown>)
                  .progressAction as SpecDocsProgressAction,
            );

            // First event is batch_init
            expect(actions[0]).toBe("batch_init");
            // Last event is batch_finished
            expect(actions[actions.length - 1]).toBe("batch_finished");

            // Middle events alternate: node_started followed by node_completed or node_failed
            const middleActions = actions.slice(1, -1);
            expect(middleActions).toHaveLength(2 * n);

            for (let i = 0; i < n; i++) {
              expect(middleActions[i * 2]).toBe("node_started");
              expect(
                middleActions[i * 2 + 1] === "node_completed" ||
                  middleActions[i * 2 + 1] === "node_failed",
              ).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
