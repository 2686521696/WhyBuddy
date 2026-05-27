/**
 * Unit tests for SpecDocsProgressEmitter.emitNodeAssembled.
 *
 * **Feature: spec-docs-runtime-perception-double-pass**
 * **Validates: Requirements 1, 4, 1.5, 2.1, 2.5, 2.6**
 *
 * Tests:
 * - emitNodeAssembled emits an event with progressAction "node_assembled" and the full payload shape
 * - Ordering: node_assembled can be emitted after node_completed without error
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

describe("SpecDocsProgressEmitter.emitNodeAssembled", () => {
  it("emits an event with progressAction 'node_assembled' and the full payload shape", () => {
    const { bus, events } = createMockEventBus();
    const emitter = createSpecDocsProgressEmitter(bus, "job-assembled-1");

    emitter.emitNodeAssembled({
      nodeId: "node-abc",
      position: 2,
      assembledCount: 3,
      totalCount: 5,
      documentIds: ["doc-1", "doc-2", "doc-3"],
    });

    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;

    // Verify progressAction discriminator
    expect(payload.progressAction).toBe("node_assembled");

    // Verify all structured fields
    expect(payload.nodeId).toBe("node-abc");
    expect(payload.position).toBe(2);
    expect(payload.assembledCount).toBe(3);
    expect(payload.totalCount).toBe(5);
    expect(payload.documentIds).toEqual(["doc-1", "doc-2", "doc-3"]);

    // Verify observationSuccess is true (assembly is a success event)
    expect(payload.observationSuccess).toBe(true);

    // Standard StageProgressEmitter fields should also be present
    expect(payload).toHaveProperty("iteration");
    expect(payload).toHaveProperty("roleId");
    expect(payload).toHaveProperty("stageId");
  });

  it("documentIds is a defensive copy (not the same reference as input)", () => {
    const { bus, events } = createMockEventBus();
    const emitter = createSpecDocsProgressEmitter(bus, "job-assembled-copy");

    const inputIds = ["doc-x", "doc-y"];
    emitter.emitNodeAssembled({
      nodeId: "node-copy",
      position: 1,
      assembledCount: 1,
      totalCount: 2,
      documentIds: inputIds,
    });

    const payload = events[0].payload as Record<string, unknown>;
    const emittedIds = payload.documentIds as string[];

    // Values should be equal
    expect(emittedIds).toEqual(["doc-x", "doc-y"]);
    // But not the same reference (defensive copy via spread)
    expect(emittedIds).not.toBe(inputIds);
  });

  it("ordering: node_assembled can be emitted after node_completed without error", () => {
    const { bus, events } = createMockEventBus();
    const emitter = createSpecDocsProgressEmitter(bus, "job-ordering");

    // Emit node_completed first
    emitter.emitNodeCompleted("node-order", 1);

    // Then emit node_assembled — should not throw
    expect(() =>
      emitter.emitNodeAssembled({
        nodeId: "node-order",
        position: 1,
        assembledCount: 1,
        totalCount: 3,
        documentIds: ["doc-a"],
      })
    ).not.toThrow();

    // Both events captured in order
    expect(events).toHaveLength(2);
    const firstPayload = events[0].payload as Record<string, unknown>;
    const secondPayload = events[1].payload as Record<string, unknown>;

    expect(firstPayload.progressAction).toBe("node_completed");
    expect(secondPayload.progressAction).toBe("node_assembled");
  });
});
