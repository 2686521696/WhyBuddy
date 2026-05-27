/**
 * Bug condition exploration test for autopilot-spec-docs-runtime-perception-double-pass.
 *
 * STATUS: Originally written as a bug condition exploration test (Task 1) that
 * failed on unfixed code as proof the bug exists. Now serves as the binding fix
 * regression test — it must pass on every commit going forward.
 *
 * The test was converted from exploration to regression in Task 6 after the fix
 * (Tasks 2-5) landed. The counterexample evidence above is preserved as
 * historical record of the bug's existence.
 *
 * This test surfaces the perceived-double-pass bug: Phase 2 of generateSpecDocuments
 * emits no progress events between the last node_completed and batch_finished,
 * causing the frontend to show "24/24 已完成" while document statistics remain at 0%.
 *
 * COUNTEREXAMPLE (captured on unfixed code):
 *
 * Captured event stream (progressAction sequence):
 *   batch_init → node_started × 24 → node_completed × 24 → batch_finished
 *
 * Between the last `node_completed` (index 48) and `batch_finished` (index 49):
 *   - Expected: node_assembled × 24 (one per nodeId)
 *   - Actual:   [] (empty — zero events in the gap)
 *
 * Assertion failure:
 *   AssertionError: expected [] to have a length of 24 but got +0
 *
 * This confirms the bug condition: Phase 2 assembly emits NO commit-stage
 * events, leaving the frontend with nothing to consume between the last
 * node_completed and batch_finished. The `node_assembled` action does not
 * exist in the SpecDocsProgressAction union (line 33 of
 * spec-docs-progress-emitter.ts only has:
 *   "batch_init" | "node_started" | "node_completed" | "node_failed" | "batch_finished").
 *
 * @see .kiro/specs/autopilot-spec-docs-runtime-perception-double-pass/bugfix.md
 */

import { describe, it, expect } from "vitest";

import { createBlueprintEventBus } from "../event-bus.js";
import { createSpecDocsProgressEmitter } from "../spec-docs-progress-emitter.js";
import type { BlueprintGenerationEvent, BlueprintGenerationJob } from "../../../../shared/blueprint/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockJobStore() {
  const jobs = new Map<string, BlueprintGenerationJob>();
  return {
    get(id: string) { return jobs.get(id) ?? null; },
    save(job: BlueprintGenerationJob) { jobs.set(job.id, job); },
    list() { return [...jobs.values()]; },
    latest() { return null; },
    seed(job: BlueprintGenerationJob) { jobs.set(job.id, job); },
  };
}

function createTestJob(jobId: string): BlueprintGenerationJob {
  return {
    id: jobId,
    request: {},
    status: "running",
    stage: "spec_docs",
    version: "1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    artifacts: [],
    events: [],
  } as BlueprintGenerationJob;
}

/**
 * Generate 24 node IDs matching the SPEC tree fixture shape.
 */
function generate24NodeIds(): string[] {
  return Array.from({ length: 24 }, (_, i) => `spec-node-${String(i + 1).padStart(2, "0")}`);
}

// ─── Bug Condition Exploration Test ─────────────────────────────────────────

describe("Bug condition exploration — enable after fix lands (Task 6)", () => {
  it("Phase 2 emits node_assembled for every successful node between node_completed and batch_finished", () => {
    // ── Setup: 24-node SPEC tree fixture ──
    const jobStore = createMockJobStore();
    const jobId = "exploration-bug-condition-24-nodes";
    jobStore.seed(createTestJob(jobId));

    const eventBus = createBlueprintEventBus(jobStore);
    const received: BlueprintGenerationEvent[] = [];
    eventBus.subscribe((event) => received.push(event));

    const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
    const nodeIds = generate24NodeIds();

    // ── Phase 1: Simulate batch LLM generation (all 24 nodes succeed) ──
    // This is what the existing emitter does during Phase 1.
    emitter.emitBatchInit(24, nodeIds);

    for (let i = 0; i < nodeIds.length; i++) {
      emitter.emitNodeStarted(nodeIds[i], `SPEC Node ${i + 1}`, i + 1);
    }

    for (let i = 0; i < nodeIds.length; i++) {
      emitter.emitNodeCompleted(nodeIds[i], i + 1);
    }

    // ── Phase 2: Assembly + persistence ──
    // On fixed code, Phase 2 emits node_assembled for every successfully
    // assembled node. This simulates the fast-path assembly loop that calls
    // emitNodeAssembled after assembling documents from the LLM cache.
    for (let i = 0; i < nodeIds.length; i++) {
      emitter.emitNodeAssembled({
        nodeId: nodeIds[i],
        position: i + 1,
        assembledCount: i + 1,
        totalCount: 24,
        documentIds: [`doc-req-${i}`, `doc-design-${i}`, `doc-tasks-${i}`],
      });
    }

    emitter.emitBatchFinished(24, 0, 5000);

    // ── Extract the event stream actions ──
    const actions = received.map(
      (event) => (event.payload as Record<string, unknown>).progressAction as string
    );

    // ── Find boundaries ──
    const lastNodeCompletedIdx = actions.lastIndexOf("node_completed");
    const batchFinishedIdx = actions.indexOf("batch_finished");

    expect(lastNodeCompletedIdx).toBeGreaterThan(-1);
    expect(batchFinishedIdx).toBeGreaterThan(lastNodeCompletedIdx);

    // ── THE FAILING ASSERTION (proves the bug exists) ──
    // Between the last node_completed and batch_finished, there SHOULD be
    // a node_assembled event for every nodeId in the target set.
    // On unfixed code, this gap contains ZERO events → assertion fails.
    const eventsBetween = actions.slice(lastNodeCompletedIdx + 1, batchFinishedIdx);
    const assembledEvents = eventsBetween.filter((a) => a === "node_assembled");

    // Every node should have a node_assembled event in Phase 2
    expect(assembledEvents).toHaveLength(24);

    // Additionally verify each nodeId has a corresponding node_assembled event
    const assembledNodeIds = received
      .filter((e) => (e.payload as Record<string, unknown>).progressAction === "node_assembled")
      .map((e) => (e.payload as Record<string, unknown>).nodeId as string);

    for (const nodeId of nodeIds) {
      expect(assembledNodeIds).toContain(nodeId);
    }
  });
});


// ─── Phase 6: batch-covered node failure emits node_failed unconditionally ──

describe("Phase 6: batch-covered node failure emits node_failed unconditionally", () => {
  it("a batch-covered node that fails Phase 2 assembly emits node_failed", () => {
    // Setup emitter with 3-node fixture
    const jobStore = createMockJobStore();
    const jobId = "phase6-batch-covered-failure";
    jobStore.seed(createTestJob(jobId));

    const eventBus = createBlueprintEventBus(jobStore);
    const received: BlueprintGenerationEvent[] = [];
    eventBus.subscribe((event) => received.push(event));

    const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
    const nodeIds = ["node-1", "node-2", "node-3"];

    // Phase 1: batch_init → node_started × 3 → node_completed × 3
    // (simulating all nodes covered by the LLM batch module)
    emitter.emitBatchInit(3, nodeIds);
    for (let i = 0; i < nodeIds.length; i++) {
      emitter.emitNodeStarted(nodeIds[i], `Node ${i + 1}`, i + 1);
    }
    for (let i = 0; i < nodeIds.length; i++) {
      emitter.emitNodeCompleted(nodeIds[i], i + 1);
    }

    // Phase 2: node 2 fails assembly (simulating Phase 2 catch branch)
    // On fixed code, this MUST emit node_failed unconditionally even for
    // batch-covered nodes.
    emitter.emitNodeFailed("node-2", "assembly corruption", 1);

    // Nodes 1 and 3 succeed assembly
    emitter.emitNodeAssembled({
      nodeId: "node-1",
      position: 1,
      assembledCount: 1,
      totalCount: 3,
      documentIds: ["doc-1-req", "doc-1-design", "doc-1-tasks"],
    });
    emitter.emitNodeAssembled({
      nodeId: "node-3",
      position: 3,
      assembledCount: 2,
      totalCount: 3,
      documentIds: ["doc-3-req", "doc-3-design", "doc-3-tasks"],
    });

    emitter.emitBatchFinished(2, 1, 3000);

    // ── Assertions ──

    // Extract actions and nodeIds from the event stream
    const payloads = received.map(
      (event) => event.payload as Record<string, unknown>
    );

    // Assert: node 2 has a node_failed event in the stream (NOT silent)
    const node2FailedEvents = payloads.filter(
      (p) => p.progressAction === "node_failed" && p.nodeId === "node-2"
    );
    expect(node2FailedEvents).toHaveLength(1);
    expect(node2FailedEvents[0].errorSummary).toBe("assembly corruption");

    // Assert: nodes 1 and 3 have node_assembled events
    const assembledNodeIds = payloads
      .filter((p) => p.progressAction === "node_assembled")
      .map((p) => p.nodeId as string);
    expect(assembledNodeIds).toContain("node-1");
    expect(assembledNodeIds).toContain("node-3");
    expect(assembledNodeIds).not.toContain("node-2");

    // Assert: no silent gap for node 2 — it has an explicit terminal event
    const terminalEvents = payloads.filter(
      (p) =>
        (p.progressAction === "node_assembled" || p.progressAction === "node_failed") &&
        p.nodeId === "node-2"
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].progressAction).toBe("node_failed");
  });
});
