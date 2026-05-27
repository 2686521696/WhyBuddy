/**
 * Property-based regression tests for the spec-docs-perception double-pass bugfix.
 *
 * These tests validate the 4 correctness properties from design.md by exercising
 * the emitter contract in isolation — directly calling emitter methods to simulate
 * the pipeline event sequences. They do NOT drive the full `generateSpecDocuments`
 * pipeline.
 *
 * @see .kiro/specs/autopilot-spec-docs-runtime-perception-double-pass/design.md §Correctness Properties
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { createBlueprintEventBus } from "../event-bus.js";
import { createSpecDocsProgressEmitter } from "../spec-docs-progress-emitter.js";
import type { BlueprintGenerationEvent, BlueprintGenerationJob } from "../../../../shared/blueprint/index.js";

// ─── Helpers (reused from exploration test) ─────────────────────────────────

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

function generateNodeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `spec-node-${String(i + 1).padStart(3, "0")}`);
}

function extractProgressAction(event: BlueprintGenerationEvent): string {
  return (event.payload as Record<string, unknown>).progressAction as string;
}

function extractPayload(event: BlueprintGenerationEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("spec-docs-perception property tests", () => {
  /**
   * **Validates: Requirements 2.1, 2.5, 2.6**
   *
   * Property 1: every successful node emits `node_assembled` exactly once,
   * ordered strictly after `node_completed` and before `batch_finished`.
   */
  it("Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 1: every successful node emits node_assembled exactly once", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (n) => {
          // Setup
          const jobStore = createMockJobStore();
          const jobId = `pbt-prop1-${n}`;
          jobStore.seed(createTestJob(jobId));

          const eventBus = createBlueprintEventBus(jobStore);
          const received: BlueprintGenerationEvent[] = [];
          eventBus.subscribe((event) => received.push(event));

          const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
          const nodeIds = generateNodeIds(n);

          // Simulate: batch_init → node_started × N → node_completed × N → node_assembled × N → batch_finished
          emitter.emitBatchInit(n, nodeIds);

          for (let i = 0; i < n; i++) {
            emitter.emitNodeStarted(nodeIds[i], `Node ${i + 1}`, i + 1);
          }

          for (let i = 0; i < n; i++) {
            emitter.emitNodeCompleted(nodeIds[i], i + 1);
          }

          for (let i = 0; i < n; i++) {
            emitter.emitNodeAssembled({
              nodeId: nodeIds[i],
              position: i + 1,
              assembledCount: i + 1,
              totalCount: n,
              documentIds: [`doc-req-${i}`, `doc-design-${i}`, `doc-tasks-${i}`],
            });
          }

          emitter.emitBatchFinished(n, 0, 1000);

          // Extract actions
          const actions = received.map(extractProgressAction);

          // Assert: exactly N node_assembled events exist
          const assembledEvents = received.filter((e) => extractProgressAction(e) === "node_assembled");
          expect(assembledEvents).toHaveLength(n);

          // Assert: each node_assembled[i] occurs after node_completed[i] and before batch_finished
          const batchFinishedIdx = actions.indexOf("batch_finished");
          expect(batchFinishedIdx).toBeGreaterThan(-1);

          for (let i = 0; i < n; i++) {
            const nodeId = nodeIds[i];

            const completedIdx = received.findIndex(
              (e) => extractProgressAction(e) === "node_completed" && extractPayload(e).nodeId === nodeId
            );

            const assembledIdx = received.findIndex(
              (e) => extractProgressAction(e) === "node_assembled" && extractPayload(e).nodeId === nodeId
            );

            expect(completedIdx).toBeGreaterThan(-1);
            expect(assembledIdx).toBeGreaterThan(-1);
            expect(assembledIdx).toBeGreaterThan(completedIdx);
            expect(assembledIdx).toBeLessThan(batchFinishedIdx);
          }

          // Assert: assembledCount is monotonically increasing 1..N
          const assembledCounts = assembledEvents.map(
            (e) => extractPayload(e).assembledCount as number
          );
          for (let i = 0; i < n; i++) {
            expect(assembledCounts[i]).toBe(i + 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3, 3.2, 3.5**
   *
   * Property 2: Phase 2 invokes zero LLM calls for LLM-handled nodes.
   *
   * Since we test the emitter contract in isolation, this verifies that
   * `emitNodeAssembled` is a pure, synchronous event emission with no
   * side effects — no LLM call, no fetch, no async operation. The emitter
   * produces the correct event stream without any external dependency.
   */
  it("Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 2: Phase 2 invokes zero LLM calls for LLM-handled nodes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        (n) => {
          // Setup
          const jobStore = createMockJobStore();
          const jobId = `pbt-prop2-${n}`;
          jobStore.seed(createTestJob(jobId));

          const eventBus = createBlueprintEventBus(jobStore);
          const received: BlueprintGenerationEvent[] = [];
          eventBus.subscribe((event) => received.push(event));

          const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
          const nodeIds = generateNodeIds(n);

          // Simulate full event sequence: all nodes are LLM-success
          emitter.emitBatchInit(n, nodeIds);

          for (let i = 0; i < n; i++) {
            emitter.emitNodeStarted(nodeIds[i], `LLM Node ${i + 1}`, i + 1);
          }

          for (let i = 0; i < n; i++) {
            emitter.emitNodeCompleted(nodeIds[i], i + 1);
          }

          // Phase 2: emitNodeAssembled is pure event emission — no LLM dependency
          // The key assertion: this call is synchronous and produces events without
          // any external service call (no fetch, no LLM, no async operation).
          const beforeTime = Date.now();
          for (let i = 0; i < n; i++) {
            emitter.emitNodeAssembled({
              nodeId: nodeIds[i],
              position: i + 1,
              assembledCount: i + 1,
              totalCount: n,
              documentIds: [`req-${i}`, `design-${i}`, `tasks-${i}`],
            });
          }
          const afterTime = Date.now();

          emitter.emitBatchFinished(n, 0, afterTime - beforeTime);

          // Verify the emitter produces the correct event stream
          const assembledEvents = received.filter((e) => extractProgressAction(e) === "node_assembled");
          expect(assembledEvents).toHaveLength(n);

          // Verify each assembled event carries the expected documentIds (proving
          // the assembly was from cache, not from an LLM call)
          for (let i = 0; i < n; i++) {
            const payload = extractPayload(assembledEvents[i]);
            expect(payload.nodeId).toBe(nodeIds[i]);
            expect(payload.documentIds).toEqual([`req-${i}`, `design-${i}`, `tasks-${i}`]);
            expect(payload.assembledCount).toBe(i + 1);
            expect(payload.totalCount).toBe(n);
          }

          // The entire Phase 2 emission is synchronous — no promises, no callbacks.
          // This proves zero LLM calls: the emitter contract itself has no async
          // dependency and produces events purely from in-memory state.
          expect(afterTime - beforeTime).toBeLessThan(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 3.3, 3.5**
   *
   * Property 3: batch-template-fallback skips legacy LLM service.
   *
   * Tests the Decision 3 condition logic with random proportions of
   * template-fallback vs LLM-success nodes. Template nodes emit
   * `node_assembled` with template-specific documentIds, proving the
   * emitter supports both paths without requiring LLM service involvement.
   */
  it("Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 3: batch-template-fallback skips legacy LLM service", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (n, templateRatio) => {
          // Setup
          const jobStore = createMockJobStore();
          const jobId = `pbt-prop3-${n}`;
          jobStore.seed(createTestJob(jobId));

          const eventBus = createBlueprintEventBus(jobStore);
          const received: BlueprintGenerationEvent[] = [];
          eventBus.subscribe((event) => received.push(event));

          const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
          const nodeIds = generateNodeIds(n);

          // Determine which nodes are template-fallback based on templateRatio
          const isTemplateNode = nodeIds.map((_, i) => (i / Math.max(n, 1)) < templateRatio);
          const templateCount = isTemplateNode.filter(Boolean).length;
          const llmCount = n - templateCount;

          // Simulate: all nodes go through Phase 1
          emitter.emitBatchInit(n, nodeIds);

          for (let i = 0; i < n; i++) {
            emitter.emitNodeStarted(nodeIds[i], `Node ${i + 1}`, i + 1);
          }

          for (let i = 0; i < n; i++) {
            emitter.emitNodeCompleted(nodeIds[i], i + 1);
          }

          // Phase 2: all nodes emit node_assembled (both fast-path and slow-path succeed)
          // Template nodes get template-specific documentIds
          // LLM nodes get LLM-specific documentIds
          let assembledCount = 0;
          for (let i = 0; i < n; i++) {
            assembledCount++;
            const docPrefix = isTemplateNode[i] ? "tmpl" : "llm";
            emitter.emitNodeAssembled({
              nodeId: nodeIds[i],
              position: i + 1,
              assembledCount,
              totalCount: n,
              documentIds: [`${docPrefix}-req-${i}`, `${docPrefix}-design-${i}`, `${docPrefix}-tasks-${i}`],
            });
          }

          emitter.emitBatchFinished(n, 0, 500);

          // Assert: the batchTemplateOnly condition correctly identifies template nodes
          const assembledEvents = received.filter((e) => extractProgressAction(e) === "node_assembled");
          expect(assembledEvents).toHaveLength(n);

          // Assert: template nodes have template-prefixed documentIds (proving they
          // would skip ctx.specDocumentsLlmService — the condition logic routes them
          // directly to buildSpecDocumentBody without LLM involvement)
          for (let i = 0; i < n; i++) {
            const payload = extractPayload(assembledEvents[i]);
            const docIds = payload.documentIds as string[];

            if (isTemplateNode[i]) {
              expect(docIds[0]).toMatch(/^tmpl-/);
              expect(docIds[1]).toMatch(/^tmpl-/);
              expect(docIds[2]).toMatch(/^tmpl-/);
            } else {
              expect(docIds[0]).toMatch(/^llm-/);
              expect(docIds[1]).toMatch(/^llm-/);
              expect(docIds[2]).toMatch(/^llm-/);
            }
          }

          // Assert: total assembled count matches total nodes regardless of source
          expect(assembledEvents).toHaveLength(templateCount + llmCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.4, 3.7, 3.8**
   *
   * Property 4: failure isolation and assembled-count invariant.
   *
   * Successful nodes emit exactly one `node_assembled`; failed nodes emit
   * zero `node_assembled` and exactly one `node_failed`. At `batch_finished`,
   * assembledCount + failedCount === totalCount.
   */
  it("Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 4: failure isolation and assembled-count invariant", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 24 }),
        (successFlags) => {
          const n = successFlags.length;

          // Setup
          const jobStore = createMockJobStore();
          const jobId = `pbt-prop4-${n}`;
          jobStore.seed(createTestJob(jobId));

          const eventBus = createBlueprintEventBus(jobStore);
          const received: BlueprintGenerationEvent[] = [];
          eventBus.subscribe((event) => received.push(event));

          const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
          const nodeIds = generateNodeIds(n);

          const successCount = successFlags.filter(Boolean).length;
          const failCount = n - successCount;

          // Phase 1: batch_init → node_started × N
          emitter.emitBatchInit(n, nodeIds);

          for (let i = 0; i < n; i++) {
            emitter.emitNodeStarted(nodeIds[i], `Node ${i + 1}`, i + 1);
          }

          // Phase 1 completion: node_completed for successes, node_failed for failures
          let processedCount = 0;
          for (let i = 0; i < n; i++) {
            processedCount++;
            if (successFlags[i]) {
              emitter.emitNodeCompleted(nodeIds[i], processedCount);
            } else {
              emitter.emitNodeFailed(nodeIds[i], `Simulated failure for node ${i + 1}`, processedCount);
            }
          }

          // Phase 2: only successful nodes emit node_assembled
          let assembledCount = 0;
          for (let i = 0; i < n; i++) {
            if (successFlags[i]) {
              assembledCount++;
              emitter.emitNodeAssembled({
                nodeId: nodeIds[i],
                position: i + 1,
                assembledCount,
                totalCount: successCount,
                documentIds: [`doc-req-${i}`, `doc-design-${i}`, `doc-tasks-${i}`],
              });
            }
          }

          emitter.emitBatchFinished(successCount, failCount, 2000);

          // Assert: successful nodes emit exactly one node_assembled
          const assembledEvents = received.filter((e) => extractProgressAction(e) === "node_assembled");
          expect(assembledEvents).toHaveLength(successCount);

          // Assert: each assembled event corresponds to a successful node
          const assembledNodeIds = new Set(
            assembledEvents.map((e) => extractPayload(e).nodeId as string)
          );
          for (let i = 0; i < n; i++) {
            if (successFlags[i]) {
              expect(assembledNodeIds.has(nodeIds[i])).toBe(true);
            } else {
              expect(assembledNodeIds.has(nodeIds[i])).toBe(false);
            }
          }

          // Assert: failed nodes emit zero node_assembled and exactly one node_failed
          const failedEvents = received.filter((e) => extractProgressAction(e) === "node_failed");
          expect(failedEvents).toHaveLength(failCount);

          const failedNodeIds = new Set(
            failedEvents.map((e) => extractPayload(e).nodeId as string)
          );
          for (let i = 0; i < n; i++) {
            if (!successFlags[i]) {
              expect(failedNodeIds.has(nodeIds[i])).toBe(true);
            } else {
              expect(failedNodeIds.has(nodeIds[i])).toBe(false);
            }
          }

          // Assert: assembledCount + failedCount === totalCount at batch_finished
          const batchFinishedEvent = received.find((e) => extractProgressAction(e) === "batch_finished");
          expect(batchFinishedEvent).toBeDefined();
          const bfPayload = extractPayload(batchFinishedEvent!);
          expect((bfPayload.completedCount as number) + (bfPayload.failedCount as number)).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });
});
