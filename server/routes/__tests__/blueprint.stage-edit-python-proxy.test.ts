import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintIntake,
} from "../../../shared/blueprint/contracts.js";
import {
  BLUEPRINT_STAGE_EDIT_PYTHON_CONTRACT_VERSION,
  previewIntakePatchContract,
} from "../blueprint/stage-edit/intake-patch-preview-contract.js";

const FIXED_NOW = "2026-06-20T00:00:00.000Z";

function makeIntake(overrides: Partial<BlueprintIntake> = {}): BlueprintIntake {
  return {
    id: "intake-1",
    targetText: "Original target",
    githubUrls: ["https://github.com/example/original"],
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
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function makeArtifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
  overrides: Partial<BlueprintGenerationArtifact> = {},
): BlueprintGenerationArtifact {
  return {
    id,
    type,
    title: id,
    summary: id,
    createdAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function makeJob(
  overrides: Partial<BlueprintGenerationJob> = {},
): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {
      intakeId: "intake-1",
      targetText: "Original target",
      githubUrls: ["https://github.com/example/original"],
    },
    status: "completed",
    stage: "engineering_landing",
    version: "v1",
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    artifacts: [
      makeArtifact("artifact-input", "intake", { payload: makeIntake() }),
      makeArtifact("artifact-route", "route_set"),
      makeArtifact("artifact-spec", "requirements", {
        staleSince: "2026-06-19T01:00:00.000Z",
        invalidatedBy: {
          stage: "route_generation",
          artifactId: "artifact-route",
          artifactType: "route_set",
          reason: "upstream_route_changed",
          triggeredAt: "2026-06-19T01:00:00.000Z",
        },
      }),
    ],
    events: [],
    staleArtifactIds: ["artifact-spec"],
    ...overrides,
  };
}

describe("Blueprint stage-edit Python proxy contract projection", () => {
  it("projects accepted intake patches with staleness and invalidation fields intact", () => {
    const intake = makeIntake();
    const job = makeJob();

    const result = previewIntakePatchContract({
      intake,
      patchBody: { targetText: "Updated target" },
      jobs: [job],
      now: FIXED_NOW,
    });

    expect(intake.targetText).toBe("Original target");
    expect(job.artifacts[1].staleSince).toBeUndefined();
    expect(result).toMatchObject({
      contractVersion: BLUEPRINT_STAGE_EDIT_PYTHON_CONTRACT_VERSION,
      kind: "blueprint.stage_edit.preview",
      ok: true,
      outcome: "accepted",
      status: 200,
      preview: {
        stateAuthority: "node",
        persistenceOwner: "node",
        stateMutation: "none",
        appliesMutation: false,
      },
      staleEdit: {
        fromStage: "input",
        newlyStaleArtifactIds: ["artifact-route"],
        newlyStaleArtifactCount: 1,
        staleArtifactIdsSnapshot: ["artifact-route", "artifact-spec"],
      },
    });
    expect(result.intake?.targetText).toBe("Updated target");
    expect(result.jobs?.[0]?.request.targetText).toBe("Updated target");
    expect(result.jobs?.[0]?.artifacts[1]).toMatchObject({
      id: "artifact-route",
      staleSince: FIXED_NOW,
      invalidatedBy: {
        stage: "input",
        artifactId: "artifact-input",
        artifactType: "intake",
        reason: "upstream_target_changed",
        triggeredAt: FIXED_NOW,
      },
    });
    expect(result.jobs?.[0]?.artifacts[2]).toMatchObject({
      id: "artifact-spec",
      staleSince: "2026-06-19T01:00:00.000Z",
      invalidatedBy: {
        reason: "upstream_route_changed",
      },
    });
  });

  it("projects rejected patches with the Node validator error shape", () => {
    const result = previewIntakePatchContract({
      intake: makeIntake(),
      patchBody: { githubUrls: "not-an-array" },
      jobs: [makeJob()],
      now: FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      status: 400,
      error: "invalid_intake_patch",
      message: "githubUrls must be an array of strings when provided.",
    });
  });

  it("projects conflicts before patch application when downstream work is active", () => {
    const result = previewIntakePatchContract({
      intake: makeIntake(),
      patchBody: { targetText: "Updated target" },
      jobs: [makeJob({ stage: "spec_tree", status: "running" })],
      now: FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: "conflict",
      status: 409,
      error: "downstream_running",
      runningStage: "spec_tree",
    });
    expect(result.intake?.targetText).toBe("Original target");
    expect(result.jobs?.[0]?.request.targetText).toBe("Original target");
    expect(result).not.toHaveProperty("staleEdit");
  });

  it("projects no-op patches without conflict checks or stale edits", () => {
    const result = previewIntakePatchContract({
      intake: makeIntake(),
      patchBody: {
        targetText: "Original target",
        githubUrls: ["https://github.com/example/original"],
      },
      jobs: [makeJob({ stage: "spec_tree", status: "running" })],
      now: FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      outcome: "noop",
      status: 200,
    });
    expect(result.intake?.updatedAt).toBe("2026-06-19T00:00:00.000Z");
    expect(result).not.toHaveProperty("staleEdit");
  });
});
