/**
 * Property-based tests for SpecDocsProgressEmitter.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 *
 * Tests two properties:
 * - Property 1: Emitter event payload correctness with truncation
 * - Property 9: No-op when eventBus is absent (caller-side optional chaining)
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

/**
 * Creates a mock event bus that captures emitted events without validation.
 * The real event bus validates event types against BlueprintEventName,
 * so we bypass that for unit-level property testing.
 */
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

// ─── Property 1: Emitter event payload correctness with truncation ──────────
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("Property 1: Emitter event payload correctness with truncation", () => {
    it("emitBatchInit payload contains progressAction='batch_init', totalCount, and nodeIds", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 200 }),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 20 }),
          (totalCount, nodeIds) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-123");

            emitter.emitBatchInit(totalCount, nodeIds);

            expect(events).toHaveLength(1);
            const payload = events[0].payload as Record<string, unknown>;
            expect(payload.progressAction).toBe("batch_init" satisfies SpecDocsProgressAction);
            expect(payload.totalCount).toBe(totalCount);
            expect(payload.nodeIds).toEqual(nodeIds);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("emitNodeStarted payload contains progressAction='node_started', nodeId, nodeTitle (truncated ≤200), position", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 500 }),
          fc.integer({ min: 1, max: 200 }),
          (nodeId, title, position) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-456");

            emitter.emitNodeStarted(nodeId, title, position);

            expect(events).toHaveLength(1);
            const payload = events[0].payload as Record<string, unknown>;
            expect(payload.progressAction).toBe("node_started" satisfies SpecDocsProgressAction);
            expect(payload.nodeId).toBe(nodeId);
            expect(payload.position).toBe(position);
            // nodeTitle must be truncated to at most 200 characters
            const nodeTitle = payload.nodeTitle as string;
            expect(nodeTitle.length).toBeLessThanOrEqual(200);
            expect(nodeTitle).toBe(title.slice(0, 200));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("emitNodeCompleted payload contains progressAction='node_completed', nodeId, completedCount", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 1000 }),
          (nodeId, completedCount) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-789");

            emitter.emitNodeCompleted(nodeId, completedCount);

            expect(events).toHaveLength(1);
            const payload = events[0].payload as Record<string, unknown>;
            expect(payload.progressAction).toBe("node_completed" satisfies SpecDocsProgressAction);
            expect(payload.nodeId).toBe(nodeId);
            expect(payload.completedCount).toBe(completedCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("emitNodeFailed payload contains progressAction='node_failed', nodeId, errorSummary (truncated ≤400), processedCount", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (nodeId, errorSummary, processedCount) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-fail");

            emitter.emitNodeFailed(nodeId, errorSummary, processedCount);

            expect(events).toHaveLength(1);
            const payload = events[0].payload as Record<string, unknown>;
            expect(payload.progressAction).toBe("node_failed" satisfies SpecDocsProgressAction);
            expect(payload.nodeId).toBe(nodeId);
            // errorSummary must be truncated to at most 400 characters
            const truncatedError = payload.errorSummary as string;
            expect(truncatedError.length).toBeLessThanOrEqual(400);
            expect(truncatedError).toBe(errorSummary.slice(0, 400));
            // Must contain processedCount (not completedCount)
            expect(payload.processedCount).toBe(processedCount);
            expect(payload).toHaveProperty("processedCount");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("emitBatchFinished payload contains progressAction='batch_finished', completedCount, failedCount, elapsedMs", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 200 }),
          fc.integer({ min: 0, max: 200 }),
          fc.integer({ min: 0, max: 600_000 }),
          (completedCount, failedCount, elapsedMs) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-done");

            emitter.emitBatchFinished(completedCount, failedCount, elapsedMs);

            expect(events).toHaveLength(1);
            const payload = events[0].payload as Record<string, unknown>;
            expect(payload.progressAction).toBe("batch_finished" satisfies SpecDocsProgressAction);
            expect(payload.completedCount).toBe(completedCount);
            expect(payload.failedCount).toBe(failedCount);
            expect(payload.elapsedMs).toBe(elapsedMs);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("all 5 methods produce correct progressAction discriminator for arbitrary inputs", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 300 }),
          fc.string({ minLength: 0, maxLength: 600 }),
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 0, max: 500 }),
          (text1, text2, num1, num2) => {
            const { bus, events } = createMockEventBus();
            const emitter = createSpecDocsProgressEmitter(bus, "job-all");

            emitter.emitBatchInit(num1, [text1]);
            emitter.emitNodeStarted("n1", text1, num1);
            emitter.emitNodeCompleted("n1", num1);
            emitter.emitNodeFailed("n2", text2, num2);
            emitter.emitBatchFinished(num1, num2, 1000);

            const actions = events.map(
              (e) => (e.payload as Record<string, unknown>).progressAction,
            );
            expect(actions).toEqual([
              "batch_init",
              "node_started",
              "node_completed",
              "node_failed",
              "batch_finished",
            ]);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ─── Property 9: No-op when eventBus is absent (caller-side optional chaining) ─
  // **Validates: Requirements 7.2**

  describe("Property 9: No-op when eventBus is absent (caller-side optional chaining)", () => {
    it("undefined?.emitBatchInit(...) etc. complete without throwing", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 200 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 10 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 500 }),
          fc.integer({ min: 1, max: 100 }),
          (totalCount, nodeIds, nodeId, text, num) => {
            // Simulate the caller-side pattern: emitter is undefined
            const emitter: SpecDocsProgressEmitter | undefined = undefined;

            // All optional chaining calls should be no-ops (no throw)
            expect(() => emitter?.emitBatchInit(totalCount, nodeIds)).not.toThrow();
            expect(() => emitter?.emitNodeStarted(nodeId, text, num)).not.toThrow();
            expect(() => emitter?.emitNodeCompleted(nodeId, num)).not.toThrow();
            expect(() => emitter?.emitNodeFailed(nodeId, text, num)).not.toThrow();
            expect(() => emitter?.emitBatchFinished(num, num, 1000)).not.toThrow();
          },
        ),
        { numRuns: 100 },
      );
    });

    it("conditional pattern produces undefined when eventBus is absent", () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.string({ minLength: 1, maxLength: 30 }),
          (isBatchRequest, jobId) => {
            // Simulate the caller-side conditional:
            // isBatchRequest && ctx?.eventBus ? createSpecDocsProgressEmitter(...) : undefined
            const ctx: { eventBus?: BlueprintEventBus } = { eventBus: undefined };

            const progressEmitter = isBatchRequest && ctx?.eventBus
              ? createSpecDocsProgressEmitter(ctx.eventBus, jobId)
              : undefined;

            // When eventBus is absent, emitter should always be undefined
            expect(progressEmitter).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it("conditional pattern produces a valid emitter when eventBus is present and isBatchRequest is true", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          (jobId) => {
            const { bus } = createMockEventBus();
            const ctx: { eventBus?: BlueprintEventBus } = { eventBus: bus };
            const isBatchRequest = true;

            const progressEmitter = isBatchRequest && ctx?.eventBus
              ? createSpecDocsProgressEmitter(ctx.eventBus, jobId)
              : undefined;

            // When eventBus is present and isBatchRequest, emitter should be defined
            expect(progressEmitter).toBeDefined();
            expect(progressEmitter!.emitBatchInit).toBeTypeOf("function");
            expect(progressEmitter!.emitNodeStarted).toBeTypeOf("function");
            expect(progressEmitter!.emitNodeCompleted).toBeTypeOf("function");
            expect(progressEmitter!.emitNodeFailed).toBeTypeOf("function");
            expect(progressEmitter!.emitBatchFinished).toBeTypeOf("function");
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
