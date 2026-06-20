import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintArtifactFeedback,
  BlueprintArtifactMemoryEntry,
  BlueprintArtifactReplaySnapshot,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../shared/blueprint/events.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";
import { buildBlueprintServiceContext } from "../blueprint/context.js";
import { createArtifactMemoryService } from "../blueprint/artifact-memory/service.js";

const FIXED_TIMESTAMP = "2026-06-20T00:00:00.000Z";

function makeLedgerEntry(id = "entry-python"): BlueprintArtifactMemoryEntry {
  return {
    id,
    jobId: "job-1",
    artifactId: "artifact-python",
    artifactType: "requirements",
    stage: "spec_docs",
    title: "Python ledger",
    summary: "Python-proxied ledger entry",
    createdAt: FIXED_TIMESTAMP,
    sourceIds: {
      routeIds: [],
      specTreeNodeIds: ["node-1"],
      specDocumentIds: ["doc-1"],
      effectPreviewIds: [],
      promptPackageIds: [],
      capabilityIds: [],
      roleIds: [],
      crewIds: [],
    },
    version: 1,
    tags: ["requirements"],
    payloadSummary: { status: "draft" },
  };
}

function makeEvent(id = "event-python"): BlueprintGenerationEvent {
  return {
    id,
    jobId: "job-1",
    type: BlueprintEventName.EvidenceRecorded,
    family: "evidence",
    stage: "engineering_handoff",
    status: "completed",
    message: "evidence recorded",
    occurredAt: FIXED_TIMESTAMP,
  };
}

function makeReplay(id = "replay-python"): BlueprintArtifactReplaySnapshot {
  return {
    id,
    jobId: "job-1",
    createdAt: FIXED_TIMESTAMP,
    timelineEntries: [],
    stageCounts: {
      input: 0,
      clarification: 0,
      route_generation: 0,
      spec_tree: 0,
      spec_docs: 1,
      preview: 0,
      effect_preview: 0,
      prompt_packaging: 0,
      runtime_capability: 0,
      engineering_handoff: 0,
      engineering_landing: 0,
    },
    lineageEdges: [],
  };
}

function makeFeedback(id = "feedback-python"): BlueprintArtifactFeedback {
  return {
    id,
    jobId: "job-1",
    entryId: "entry-python",
    artifactId: "artifact-python",
    artifactType: "requirements",
    kind: "feedback",
    message: "Looks good",
    summary: "Feedback recorded",
    createdAt: FIXED_TIMESTAMP,
    tags: ["review"],
    sourceIds: {
      routeIds: [],
      specTreeNodeIds: [],
      specDocumentIds: ["doc-1"],
      effectPreviewIds: [],
      promptPackageIds: [],
      capabilityIds: [],
      roleIds: [],
      crewIds: [],
    },
    payloadSummary: { review: "accepted" },
  };
}

function makeJob(): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    artifacts: [
      {
        id: "artifact-node",
        type: "replay",
        title: "Node replay",
        summary: "Node-owned replay payload",
        createdAt: FIXED_TIMESTAMP,
        payload: makeLedgerEntry("entry-node"),
      },
      {
        id: "feedback-node",
        type: "feedback",
        title: "Node feedback",
        summary: "Node-owned feedback payload",
        createdAt: FIXED_TIMESTAMP,
        payload: makeFeedback("feedback-node"),
      },
    ],
    events: [makeEvent("event-node")],
  };
}

function makeService() {
  const jobStore = createMemoryBlueprintJobStore([makeJob()]);
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const ctx = buildBlueprintServiceContext({ jobStore, logger });
  return { service: createArtifactMemoryService(ctx), logger };
}

describe("Blueprint artifact memory Python proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates artifact list shapes to Python when the proxy switch is enabled", async () => {
    vi.stubEnv("BLUEPRINT_ARTIFACT_MEMORY_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test/");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
          jobId: "job-1",
          action: "list",
          resource: "all",
          source: "node-artifact-store",
          ledger: [makeLedgerEntry()],
          events: [makeEvent()],
          replays: [makeReplay()],
          feedback: [makeFeedback()],
            counts: { ledger: 1, events: 1, replays: 1, feedback: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const { service } = makeService();

    await expect(service.listLedger("job-1")).resolves.toEqual([makeLedgerEntry()]);
    await expect(service.listReplays("job-1")).resolves.toEqual([makeReplay()]);
    await expect(service.listFeedback("job-1")).resolves.toEqual([makeFeedback()]);

    expect(await service.listEvents("job-1")).toEqual([makeEvent("event-node")]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://python.test/api/blueprint/spec-documents/artifact-memory/contract");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      jobId: "job-1",
      action: "list",
      resource: "ledger",
    });
    expect(body.ledger[0].id).toBe("entry-node");
    expect(body.events[0].id).toBe("event-node");
  });

  it("keeps Node artifact memory as fallback and persistence owner when Python fails", async () => {
    vi.stubEnv("BLUEPRINT_ARTIFACT_MEMORY_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://python.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("down", { status: 503 }),
    );
    const { service, logger } = makeService();

    await expect(service.listLedger("job-1")).resolves.toEqual([
      makeLedgerEntry("entry-node"),
    ]);
    await expect(service.listFeedback("job-1")).resolves.toEqual([
      makeFeedback("feedback-node"),
    ]);
    await expect(
      service.writeFeedback("job-1", { message: "Node still owns writes" }),
    ).resolves.toMatchObject({
      persistenceOwner: "node",
      writeAccepted: false,
      request: { message: "Node still owns writes" },
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("uses the local Node projection when the proxy switch is disabled", async () => {
    vi.stubEnv("BLUEPRINT_ARTIFACT_MEMORY_PYTHON_PROXY", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { service } = makeService();

    expect(await service.listLedger("job-1")).toEqual([
      makeLedgerEntry("entry-node"),
    ]);
    expect(await service.listEvents("job-1")).toEqual([makeEvent("event-node")]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
