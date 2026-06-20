import { describe, expect, it } from "vitest";

import { BlueprintEventName } from "../../../../shared/blueprint/events.js";
import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../../blueprint.js";

import { buildBlueprintServiceContext } from "../context.js";
import { createJobService } from "./service.js";

function makeJob(
  id: string,
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob {
  return {
    id,
    request: overrides.request ?? {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    artifacts: [],
    events: [],
    ...overrides,
  };
}

function makeEvent(id: string, jobId: string): BlueprintGenerationEvent {
  return {
    id,
    jobId,
    type: BlueprintEventName.JobStage,
    family: "job",
    stage: "input",
    status: "running",
    message: "test",
    occurredAt: "2026-05-07T01:00:00.000Z",
  };
}

describe("createJobService (shell)", () => {
  it("list / get / latest delegates to ctx.jobStore", () => {
    const jobStore = createMemoryBlueprintJobStore([
      makeJob("job-1"),
      makeJob("job-2"),
    ]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createJobService(ctx);
    expect(service.listJobs()).toHaveLength(2);
    expect(service.getJob("job-1")?.id).toBe("job-1");
    expect(service.getJob("unknown")).toBeNull();
    expect(service.getLatestJob()?.id).toBeDefined();
  });

  it("getLatestJob can scope the latest job by project id", () => {
    const jobStore = createMemoryBlueprintJobStore([
      makeJob("job-old", {
        projectId: "project-old",
        request: { projectId: "project-old" },
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
      makeJob("job-new", {
        projectId: "project-new",
        request: { projectId: "project-new" },
        createdAt: "2026-05-07T00:00:00.000Z",
      }),
    ]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createJobService(ctx);

    expect(service.getLatestJob({ projectId: "project-new" })?.id).toBe(
      "job-new",
    );
    expect(service.getLatestJob({ projectId: "project-empty" })).toBeNull();
    expect(service.getLatestJob()?.id).toBe("job-old");
  });

  it("emitJobEvent goes through ctx.eventBus", () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob("job-1")]);
    const ctx = buildBlueprintServiceContext({ jobStore });
    const service = createJobService(ctx);

    const received: string[] = [];
    ctx.eventBus.subscribe(event => received.push(event.id));

    service.emitJobEvent(makeEvent("evt-1", "job-1"));

    expect(received).toEqual(["evt-1"]);
    expect(ctx.jobStore.get("job-1")?.events).toHaveLength(1);
  });

  it("local cancel records cancellation as a failed Node job instead of completed", async () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob("job-1", { status: "running" })]);
    const ctx = buildBlueprintServiceContext({
      jobStore,
      now: () => new Date("2026-06-20T00:00:00.000Z"),
    });
    const service = createJobService(ctx);

    const result = await service.cancelJob("job-1", {
      reason: "user_cancelled",
      now: "2026-06-20T00:01:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.job.status : null).toBe("cancelled");
    expect(ctx.jobStore.get("job-1")?.status).toBe("failed");
    expect(ctx.jobStore.get("job-1")?.error?.code).toBe("cancelled");
  });
});
