import { describe, expect, it } from "vitest";

import { BlueprintEventName } from "../../../../shared/blueprint/events.js";
import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../../blueprint.js";

import { buildBlueprintServiceContext } from "../context.js";
import { createArtifactMemoryService } from "./service.js";

function makeEvent(id: string): BlueprintGenerationEvent {
  return {
    id,
    jobId: "job-1",
    type: BlueprintEventName.EvidenceRecorded,
    family: "evidence",
    stage: "engineering_handoff",
    status: "completed",
    message: "evidence recorded",
    occurredAt: "2026-05-07T01:00:00.000Z",
  };
}

function makeJob(events: BlueprintGenerationEvent[] = []): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    artifacts: [],
    events,
  };
}

describe("createArtifactMemoryService", () => {
  it("lists events only through ctx.replayStore", async () => {
    const job = makeJob([makeEvent("evt-1"), makeEvent("evt-2")]);
    const jobStore = createMemoryBlueprintJobStore([job]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createArtifactMemoryService(ctx);

    const events = await service.listEvents("job-1");

    expect(events.map(e => e.id)).toEqual(["evt-1", "evt-2"]);
    expect(await service.listEvents("missing")).toEqual([]);
  });

  it("returns empty arrays for unknown jobId", async () => {
    const jobStore = createMemoryBlueprintJobStore();
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createArtifactMemoryService(ctx);

    expect(await service.listLedger("missing")).toEqual([]);
    expect(await service.listReplays("missing")).toEqual([]);
    expect(await service.listFeedback("missing")).toEqual([]);
    expect(await service.listEvents("missing")).toEqual([]);
  });

  it("uses the same event stream as jobStore via replayStore", async () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob([makeEvent("evt-1")])]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createArtifactMemoryService(ctx);

    const fromReplayStore = await service.listEvents("job-1");
    const fromJobStore = ctx.jobStore.get("job-1")?.events ?? [];

    expect(fromReplayStore).toEqual(fromJobStore);
  });

  it("writeFeedback is a local no-op contract and does not persist artifacts", async () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob()]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createArtifactMemoryService(ctx);

    const result = await service.writeFeedback("job-1", {
      message: "review note",
      kind: "feedback",
    });

    expect(result).toMatchObject({
      jobId: "job-1",
      action: "write",
      resource: "feedback",
      persistenceOwner: "node",
      writeAccepted: false,
      request: {
        message: "review note",
        kind: "feedback",
      },
    });
    expect(jobStore.get("job-1")?.artifacts).toEqual([]);
  });
});
