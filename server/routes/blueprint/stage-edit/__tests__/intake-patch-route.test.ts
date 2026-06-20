import { describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintIntake,
} from "../../../../../shared/blueprint/contracts.js";
import type { BlueprintJobStore } from "../../job-store.js";
import { createIntakePatchHandler } from "../intake-patch-route.js";

function buildIntake(overrides: Partial<BlueprintIntake> = {}): BlueprintIntake {
  return {
    id: "intake-a",
    targetText: "Original target",
    githubUrls: ["https://github.com/example/a"],
    sources: [],
    duplicateGithubUrls: [],
    domainNotes: [],
    assets: [],
    evidence: [],
    readiness: {
      status: "ready",
      score: 1,
      answeredRequired: 0,
      requiredTotal: 0,
      missingQuestionIds: [],
    },
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

function buildArtifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
): BlueprintGenerationArtifact {
  return {
    id,
    type,
    title: id,
    summary: id,
    createdAt: "2026-05-23T00:00:00.000Z",
  };
}

function buildJob(overrides: Partial<BlueprintGenerationJob> = {}): BlueprintGenerationJob {
  return {
    id: "job-a",
    request: { intakeId: "intake-a", targetText: "Original target" },
    status: "completed",
    stage: "engineering_landing",
    version: "v1",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    artifacts: [
      buildArtifact("artifact-input", "intake"),
      buildArtifact("artifact-route", "route_set"),
      buildArtifact("artifact-spec", "requirements"),
    ],
    events: [],
    ...overrides,
  };
}

function buildStore(
  jobs: BlueprintGenerationJob[],
  saved: BlueprintGenerationJob[] = [],
): BlueprintJobStore {
  return {
    list: () => jobs,
    get: (jobId) => saved.find((job) => job.id === jobId) ?? jobs.find((job) => job.id === jobId) ?? null,
    save: (job) => {
      saved.push(job);
    },
    latest: () => jobs[0] ?? null,
  };
}

async function callHandler(input: {
  intake?: BlueprintIntake;
  jobs?: BlueprintGenerationJob[];
  body: unknown;
  intakeId?: string;
}) {
  const savedJobs: BlueprintGenerationJob[] = [];
  const intakes = new Map<string, BlueprintIntake>();
  if (input.intake) {
    intakes.set(input.intake.id, input.intake);
  }

  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const handler = createIntakePatchHandler({
    blueprintStores: {
      intakes,
      clarificationSessions: new Map(),
      projectContexts: new Map(),
    },
    jobStore: buildStore(input.jobs ?? [], savedJobs),
    ctx: {
      logger,
      now: () => new Date("2026-05-23T02:00:00.000Z"),
    },
  });

  await handler(
    {
      params: { intakeId: input.intakeId ?? "intake-a" },
      body: input.body,
    } as any,
    { status, json } as any,
    vi.fn(),
  );

  return { status, json, logger, intakes, savedJobs };
}

describe("createIntakePatchHandler", () => {
  it("returns 404 when the intake id is unknown", async () => {
    const result = await callHandler({ body: { targetText: "Updated" } });

    expect(result.status).toHaveBeenCalledWith(404);
    expect(result.json).toHaveBeenCalledWith({ error: "intake_not_found" });
  });

  it("returns 400 for invalid patch bodies", async () => {
    const result = await callHandler({
      intake: buildIntake(),
      body: { githubUrls: "not-array" },
    });

    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({
      error: "invalid_intake_patch",
      message: "githubUrls must be an array of strings when provided.",
    });
  });

  it("updates intake and returns staleEdit when a linked job is invalidated", async () => {
    const result = await callHandler({
      intake: buildIntake(),
      jobs: [buildJob()],
      body: { targetText: "Updated target" },
    });

    expect(result.status).toHaveBeenCalledWith(200);
    expect(result.intakes.get("intake-a")).toMatchObject({
      targetText: "Updated target",
      updatedAt: "2026-05-23T02:00:00.000Z",
    });
    expect(result.json).toHaveBeenCalledWith({
      intake: expect.objectContaining({ targetText: "Updated target" }),
      staleEdit: {
        fromStage: "input",
        newlyStaleArtifactIds: ["artifact-route", "artifact-spec"],
        newlyStaleArtifactCount: 2,
        staleArtifactIdsSnapshot: ["artifact-route", "artifact-spec"],
      },
    });
    expect(result.savedJobs.at(-1)?.artifacts[1]).toMatchObject({
      id: "artifact-route",
      staleSince: "2026-05-23T02:00:00.000Z",
      invalidatedBy: {
        stage: "input",
        artifactId: "artifact-input",
        artifactType: "intake",
        reason: "upstream_target_changed",
        triggeredAt: "2026-05-23T02:00:00.000Z",
      },
    });
  });

  it("persists the updated intake payload into linked job artifacts", async () => {
    const intake = buildIntake();
    const result = await callHandler({
      intake,
      jobs: [
        buildJob({
          artifacts: [
            {
              ...buildArtifact("artifact-input", "intake"),
              payload: intake,
            },
            buildArtifact("artifact-route", "route_set"),
          ],
        }),
      ],
      body: { targetText: "Updated target" },
    });

    expect(result.status).toHaveBeenCalledWith(200);
    const persistedJob = result.savedJobs.at(-1);
    expect(
      persistedJob?.artifacts.find((artifact) => artifact.type === "intake")
        ?.payload,
    ).toMatchObject({
      id: "intake-a",
      targetText: "Updated target",
      updatedAt: "2026-05-23T02:00:00.000Z",
    });
  });

  it("blocks before mutating intake when any linked downstream job is running", async () => {
    const result = await callHandler({
      intake: buildIntake(),
      jobs: [
        buildJob({
          stage: "spec_tree",
          status: "running",
        }),
      ],
      body: { targetText: "Updated target" },
    });

    expect(result.status).toHaveBeenCalledWith(409);
    expect(result.json).toHaveBeenCalledWith({
      error: "downstream_running",
      runningStage: "spec_tree",
    });
    expect(result.intakes.get("intake-a")?.targetText).toBe("Original target");
    expect(result.logger.warn).toHaveBeenCalledWith(
      "stage_edit.blocked",
      expect.objectContaining({
        jobId: "job-a",
        triggeringEndpoint: "intake_patch",
        runningStage: "spec_tree",
      }),
    );
  });

  it("omits staleEdit for structurally equivalent no-op patches", async () => {
    const result = await callHandler({
      intake: buildIntake(),
      jobs: [buildJob()],
      body: {
        targetText: "Original target",
        githubUrls: ["https://github.com/example/a"],
      },
    });

    expect(result.status).toHaveBeenCalledWith(200);
    expect(result.json).toHaveBeenCalledWith({
      intake: expect.objectContaining({ targetText: "Original target" }),
    });
    expect(result.logger.info).not.toHaveBeenCalled();
  });

  it("allows structurally equivalent no-op patches even when downstream work is running", async () => {
    const result = await callHandler({
      intake: buildIntake(),
      jobs: [
        buildJob({
          stage: "spec_tree",
          status: "running",
        }),
      ],
      body: {
        targetText: "Original target",
        githubUrls: ["https://github.com/example/a"],
      },
    });

    expect(result.status).toHaveBeenCalledWith(200);
    expect(result.json).toHaveBeenCalledWith({
      intake: expect.objectContaining({ targetText: "Original target" }),
    });
    expect(result.logger.warn).not.toHaveBeenCalled();
    expect(result.logger.info).not.toHaveBeenCalled();
  });
});
