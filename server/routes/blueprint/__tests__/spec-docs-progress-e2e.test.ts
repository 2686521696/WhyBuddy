/**
 * Integration tests for end-to-end event flow.
 *
 * **Feature: spec-docs-generation-progress-feedback**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * Tests the full pipeline: Emitter → EventBus → verify event structure.
 * Uses the REAL `createBlueprintEventBus` with a mock job store to verify
 * that events are correctly persisted and have the right structure.
 */

import { describe, it, expect } from "vitest";

import { createBlueprintEventBus } from "../event-bus.js";
import { createSpecDocsProgressEmitter } from "../spec-docs-progress-emitter.js";
import type { BlueprintGenerationEvent, BlueprintGenerationJob } from "../../../../shared/blueprint/index.js";
import type { BlueprintJobStore } from "../job-store.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockJobStore() {
  const jobs = new Map<string, BlueprintGenerationJob>();
  return {
    get(id: string) { return jobs.get(id) ?? null; },
    save(job: BlueprintGenerationJob) { jobs.set(job.id, job); },
    list() { return [...jobs.values()]; },
    latest() { return null; },
    // Pre-populate with a test job
    seed(job: BlueprintGenerationJob) { jobs.set(job.id, job); },
  } satisfies BlueprintJobStore & { seed: (job: BlueprintGenerationJob) => void };
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: spec-docs-generation-progress-feedback", () => {
  describe("End-to-end event flow (Integration)", () => {
    it("emitter events are persisted to job store via real event bus", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-1";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchInit(3, ["node-a", "node-b", "node-c"]);

      const job = jobStore.get(jobId)!;
      expect(job.events).toHaveLength(1);
      expect(job.events[0].type).toBe("role.agent.observing");
    });

    it("full batch lifecycle events are persisted in order", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-2";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      // Simulate a full batch lifecycle
      emitter.emitBatchInit(2, ["node-1", "node-2"]);
      emitter.emitNodeStarted("node-1", "用户认证模块", 1);
      emitter.emitNodeCompleted("node-1", 1);
      emitter.emitNodeStarted("node-2", "数据存储模块", 2);
      emitter.emitNodeFailed("node-2", "LLM 调用超时", 2);
      emitter.emitBatchFinished(1, 1, 5000);

      const job = jobStore.get(jobId)!;
      expect(job.events).toHaveLength(6);

      // All events should be role.agent.observing type
      for (const event of job.events) {
        expect(event.type).toBe("role.agent.observing");
        expect(event.family).toBe("role");
        expect(event.stage).toBe("spec_docs");
        expect(event.jobId).toBe(jobId);
      }
    });

    it("progress events survive a later job save based on a stale job snapshot", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-stale-save";
      const staleJob = createTestJob(jobId);
      jobStore.seed(staleJob);

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchInit(1, ["node-1"]);
      emitter.emitNodeStarted("node-1", "Node 1", 1);
      emitter.emitNodeCompleted("node-1", 1);
      emitter.emitBatchFinished(1, 0, 500);

      const persistedEvents = jobStore.get(jobId)?.events ?? [];
      const completionEvent = {
        id: "job-completed-event",
        jobId,
        type: "job.completed",
        family: "job",
        stage: "spec_docs",
        status: "completed",
        message: "SPEC documents generated from the selected SPEC tree.",
        occurredAt: new Date().toISOString(),
        payload: {},
      } as BlueprintGenerationEvent;

      jobStore.save({
        ...staleJob,
        status: "reviewing",
        stage: "spec_docs",
        events: persistedEvents.concat(completionEvent),
      });

      const actions = (jobStore.get(jobId)?.events ?? [])
        .map((event) => (event.payload as Record<string, unknown> | undefined)?.progressAction)
        .filter(Boolean);

      expect(actions).toEqual([
        "batch_init",
        "node_started",
        "node_completed",
        "batch_finished",
      ]);
    });

    it("event payload contains correct progressAction for each emitter method", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-3";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchInit(2, ["n1", "n2"]);
      emitter.emitNodeStarted("n1", "Module A", 1);
      emitter.emitNodeCompleted("n1", 1);
      emitter.emitNodeFailed("n2", "error msg", 2);
      emitter.emitBatchFinished(1, 1, 3000);

      const job = jobStore.get(jobId)!;
      const payloads = job.events.map(e => e.payload as Record<string, unknown>);

      expect(payloads[0].progressAction).toBe("batch_init");
      expect(payloads[1].progressAction).toBe("node_started");
      expect(payloads[2].progressAction).toBe("node_completed");
      expect(payloads[3].progressAction).toBe("node_failed");
      expect(payloads[4].progressAction).toBe("batch_finished");
    });

    it("batch_init event payload contains totalCount, nodeIds, stageId, roleId", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-4";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchInit(3, ["a", "b", "c"]);

      const job = jobStore.get(jobId)!;
      const payload = job.events[0].payload as Record<string, unknown>;

      expect(payload.progressAction).toBe("batch_init");
      expect(payload.totalCount).toBe(3);
      expect(payload.nodeIds).toEqual(["a", "b", "c"]);
      expect(payload.stageId).toBe("spec_docs");
      expect(payload.roleId).toBe("generator");
      expect(payload.iteration).toBe(1);
    });

    it("node_started event payload contains nodeId, nodeTitle, position", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-5";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitNodeStarted("node-x", "认证服务", 3);

      const job = jobStore.get(jobId)!;
      const payload = job.events[0].payload as Record<string, unknown>;

      expect(payload.progressAction).toBe("node_started");
      expect(payload.nodeId).toBe("node-x");
      expect(payload.nodeTitle).toBe("认证服务");
      expect(payload.position).toBe(3);
      expect(payload.observationSuccess).toBe(true);
    });

    it("node_failed event payload contains errorSummary and processedCount", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-6";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitNodeFailed("node-y", "Connection timeout", 4);

      const job = jobStore.get(jobId)!;
      const payload = job.events[0].payload as Record<string, unknown>;

      expect(payload.progressAction).toBe("node_failed");
      expect(payload.nodeId).toBe("node-y");
      expect(payload.errorSummary).toBe("Connection timeout");
      expect(payload.processedCount).toBe(4);
      expect(payload.observationSuccess).toBe(false);
    });

    it("batch_finished event payload contains completedCount, failedCount, elapsedMs", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-7";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchFinished(5, 2, 12345);

      const job = jobStore.get(jobId)!;
      const payload = job.events[0].payload as Record<string, unknown>;

      expect(payload.progressAction).toBe("batch_finished");
      expect(payload.completedCount).toBe(5);
      expect(payload.failedCount).toBe(2);
      expect(payload.elapsedMs).toBe(12345);
    });

    it("subscribers receive events emitted through the progress emitter", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-8";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const received: BlueprintGenerationEvent[] = [];
      eventBus.subscribe(event => received.push(event));

      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
      emitter.emitBatchInit(1, ["only-node"]);
      emitter.emitNodeStarted("only-node", "Single Node", 1);
      emitter.emitNodeCompleted("only-node", 1);
      emitter.emitBatchFinished(1, 0, 500);

      expect(received).toHaveLength(4);
      // Verify subscriber receives same events as persisted
      const job = jobStore.get(jobId)!;
      expect(received.length).toBe(job.events.length);
      for (let i = 0; i < received.length; i++) {
        expect(received[i].id).toBe(job.events[i].id);
      }
    });

    it("spec_docs progress events do not interfere with other stage events", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-9";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);

      // Emit a non-spec_docs event first (simulating another stage)
      eventBus.emit({
        id: "other-stage-event-1",
        jobId,
        type: "role.agent.thinking" as any,
        family: "role",
        stage: "route_generation",
        status: "running",
        message: "",
        occurredAt: new Date().toISOString(),
        roleId: "planner",
        stageId: "route_generation",
        payload: { thought: "Analyzing routes..." },
      } as any);

      // Now emit spec_docs progress events
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
      emitter.emitBatchInit(1, ["node-1"]);
      emitter.emitNodeStarted("node-1", "Test", 1);
      emitter.emitNodeCompleted("node-1", 1);
      emitter.emitBatchFinished(1, 0, 100);

      const job = jobStore.get(jobId)!;
      // Should have 5 events total: 1 route_generation + 4 spec_docs
      expect(job.events).toHaveLength(5);

      // First event is from route_generation
      expect(job.events[0].stage).toBe("route_generation");

      // Remaining 4 are spec_docs progress events
      for (let i = 1; i < 5; i++) {
        expect(job.events[i].stage).toBe("spec_docs");
        expect((job.events[i].payload as Record<string, unknown>).stageId).toBe("spec_docs");
      }
    });

    it("StageProgressEmitter.observing() with extraPayload produces correct merged event structure", () => {
      const jobStore = createMockJobStore();
      const jobId = "e2e-job-10";
      jobStore.seed(createTestJob(jobId));

      const eventBus = createBlueprintEventBus(jobStore);
      const emitter = createSpecDocsProgressEmitter(eventBus, jobId);

      emitter.emitBatchInit(2, ["x", "y"]);

      const job = jobStore.get(jobId)!;
      const event = job.events[0];
      const payload = event.payload as Record<string, unknown>;

      // Standard StageProgressEmitter fields (merged by observing())
      expect(payload.iteration).toBe(1);
      expect(payload.roleId).toBe("generator");
      expect(payload.stageId).toBe("spec_docs");
      expect(payload.observationSuccess).toBe(true);
      expect(typeof payload.observationSummary).toBe("string");

      // Extra payload fields (merged by observing(success, summary, extraPayload))
      expect(payload.progressAction).toBe("batch_init");
      expect(payload.totalCount).toBe(2);
      expect(payload.nodeIds).toEqual(["x", "y"]);
    });
  });
});
