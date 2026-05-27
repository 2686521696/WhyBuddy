/**
 * Unit tests for SpecDocsProgressEmitter edge cases.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 * **Validates: Requirements 1.6, 7.2**
 *
 * Tests:
 * - Zero-node edge case: only batch_finished emitted with zeros
 * - eventBus.emit throwing internally does not propagate
 * - observing() is called with correct extraPayload structure for each action type
 */

import { describe, it, expect, vi } from "vitest";

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

function createThrowingEventBus() {
  return {
    emit() {
      throw new Error("eventBus.emit internal failure");
    },
    subscribe() {
      return () => {};
    },
  } as unknown as BlueprintEventBus;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("SpecDocsProgressEmitter edge cases", () => {
    // ─── Zero-node edge case (Req 1.6) ────────────────────────────────────
    describe("zero-node edge case (Req 1.6)", () => {
      it("emitBatchFinished with zeros emits a single batch_finished event", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-zero");

        // Simulate zero-node scenario: only batch_finished is emitted
        emitter.emitBatchFinished(0, 0, 0);

        expect(events).toHaveLength(1);
        const payload = events[0].payload as Record<string, unknown>;
        expect(payload.progressAction).toBe("batch_finished");
        expect(payload.completedCount).toBe(0);
        expect(payload.failedCount).toBe(0);
        expect(payload.elapsedMs).toBe(0);
      });

      it("zero-node scenario does not emit batch_init or any node events", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-zero-2");

        // Only emit batch_finished (as the caller would for zero nodes)
        emitter.emitBatchFinished(0, 0, 0);

        // Should only have the one batch_finished event
        expect(events).toHaveLength(1);
        expect((events[0].payload as Record<string, unknown>).progressAction).toBe("batch_finished");
      });
    });

    // ─── eventBus.emit throwing does not propagate (Req 7.2) ──────────────
    describe("eventBus.emit throwing internally does not propagate", () => {
      it("emitBatchInit does not throw when eventBus.emit throws", () => {
        const bus = createThrowingEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-throw");

        // StageProgressEmitter has try/catch around emit, so this should not throw
        expect(() => emitter.emitBatchInit(5, ["a", "b", "c", "d", "e"])).not.toThrow();
      });

      it("emitNodeStarted does not throw when eventBus.emit throws", () => {
        const bus = createThrowingEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-throw");

        expect(() => emitter.emitNodeStarted("node-1", "Test Node", 1)).not.toThrow();
      });

      it("emitNodeCompleted does not throw when eventBus.emit throws", () => {
        const bus = createThrowingEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-throw");

        expect(() => emitter.emitNodeCompleted("node-1", 1)).not.toThrow();
      });

      it("emitNodeFailed does not throw when eventBus.emit throws", () => {
        const bus = createThrowingEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-throw");

        expect(() => emitter.emitNodeFailed("node-1", "Some error", 1)).not.toThrow();
      });

      it("emitBatchFinished does not throw when eventBus.emit throws", () => {
        const bus = createThrowingEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-throw");

        expect(() => emitter.emitBatchFinished(3, 2, 5000)).not.toThrow();
      });
    });

    // ─── observing() extraPayload structure correctness ───────────────────
    describe("observing() is called with correct extraPayload structure", () => {
      it("emitBatchInit passes progressAction, totalCount, nodeIds in extraPayload", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-struct");

        emitter.emitBatchInit(3, ["node-a", "node-b", "node-c"]);

        const payload = events[0].payload as Record<string, unknown>;
        // Verify the extraPayload fields are present alongside standard fields
        expect(payload).toMatchObject({
          progressAction: "batch_init",
          totalCount: 3,
          nodeIds: ["node-a", "node-b", "node-c"],
        });
        // Standard StageProgressEmitter fields should also be present
        expect(payload).toHaveProperty("iteration");
        expect(payload).toHaveProperty("roleId");
        expect(payload).toHaveProperty("stageId");
      });

      it("emitNodeStarted passes progressAction, nodeId, nodeTitle, position in extraPayload", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-struct");

        emitter.emitNodeStarted("node-x", "用户认证模块", 2);

        const payload = events[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({
          progressAction: "node_started",
          nodeId: "node-x",
          nodeTitle: "用户认证模块",
          position: 2,
        });
        expect(payload).toHaveProperty("iteration");
        expect(payload).toHaveProperty("roleId");
        expect(payload).toHaveProperty("stageId");
      });

      it("emitNodeCompleted passes progressAction, nodeId, completedCount in extraPayload", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-struct");

        emitter.emitNodeCompleted("node-x", 5);

        const payload = events[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({
          progressAction: "node_completed",
          nodeId: "node-x",
          completedCount: 5,
        });
        expect(payload).toHaveProperty("iteration");
        expect(payload).toHaveProperty("roleId");
        expect(payload).toHaveProperty("stageId");
      });

      it("emitNodeFailed passes progressAction, nodeId, errorSummary, processedCount in extraPayload", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-struct");

        emitter.emitNodeFailed("node-y", "LLM 调用超时", 3);

        const payload = events[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({
          progressAction: "node_failed",
          nodeId: "node-y",
          errorSummary: "LLM 调用超时",
          processedCount: 3,
        });
        expect(payload).toHaveProperty("iteration");
        expect(payload).toHaveProperty("roleId");
        expect(payload).toHaveProperty("stageId");
      });

      it("emitBatchFinished passes progressAction, completedCount, failedCount, elapsedMs in extraPayload", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-struct");

        emitter.emitBatchFinished(7, 1, 45000);

        const payload = events[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({
          progressAction: "batch_finished",
          completedCount: 7,
          failedCount: 1,
          elapsedMs: 45000,
        });
        expect(payload).toHaveProperty("iteration");
        expect(payload).toHaveProperty("roleId");
        expect(payload).toHaveProperty("stageId");
      });

      it("observing success flag is true for batch_init, node_started, node_completed, batch_finished", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-success");

        emitter.emitBatchInit(2, ["a", "b"]);
        emitter.emitNodeStarted("a", "Node A", 1);
        emitter.emitNodeCompleted("a", 1);
        emitter.emitBatchFinished(1, 0, 1000);

        // All these should have observationSuccess = true
        for (const event of events) {
          const payload = event.payload as Record<string, unknown>;
          expect(payload.observationSuccess).toBe(true);
        }
      });

      it("observing success flag is false for node_failed", () => {
        const { bus, events } = createMockEventBus();
        const emitter = createSpecDocsProgressEmitter(bus, "job-fail");

        emitter.emitNodeFailed("node-z", "timeout", 1);

        const payload = events[0].payload as Record<string, unknown>;
        expect(payload.observationSuccess).toBe(false);
      });
    });
  });
});
