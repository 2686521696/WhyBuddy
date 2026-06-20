import type {
  BlueprintGenerationArtifactType,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintIntake,
  BlueprintStaleEditResultSummary,
} from "../../../../shared/blueprint/contracts.js";
import { invalidateDownstream } from "../staleness/invalidate-downstream.js";
import { detectRunningDownstreamForEdit } from "./conflict-detection.js";
import { isIntakePatchNoop } from "./intake-noop-detector.js";
import { validateIntakePatch } from "./intake-patch-validator.js";

export const BLUEPRINT_STAGE_EDIT_PYTHON_CONTRACT_VERSION =
  "blueprint.stage-edit.proxy.v1";

export type BlueprintStageEditPreviewOutcome =
  | "accepted"
  | "rejected"
  | "conflict"
  | "noop";

export interface BlueprintStageEditPreviewContractInput {
  intake: BlueprintIntake;
  patchBody: unknown;
  jobs: BlueprintGenerationJob[];
  now: string;
}

export interface BlueprintStageEditPreviewContractResult {
  contractVersion: typeof BLUEPRINT_STAGE_EDIT_PYTHON_CONTRACT_VERSION;
  kind: "blueprint.stage_edit.preview";
  preview: {
    stateAuthority: "node";
    persistenceOwner: "node";
    stateMutation: "none";
    appliesMutation: false;
  };
  ok: boolean;
  outcome: BlueprintStageEditPreviewOutcome;
  status: 200 | 400 | 409;
  intake?: BlueprintIntake;
  jobs?: BlueprintGenerationJob[];
  staleEdit?: BlueprintStaleEditResultSummary;
  error?: "invalid_intake_patch" | "downstream_running";
  message?: string;
  runningStage?: BlueprintGenerationStage;
}

export function previewIntakePatchContract(
  input: BlueprintStageEditPreviewContractInput,
): BlueprintStageEditPreviewContractResult {
  const intake = clone(input.intake);
  const jobs = input.jobs.map((job) => clone(job));
  const parsed = validateIntakePatch(input.patchBody);
  if (!parsed.ok) {
    return {
      ...baseResult(),
      ok: false,
      outcome: "rejected",
      status: 400,
      error: parsed.error,
      message: parsed.message,
      intake,
      jobs,
    };
  }

  if (isIntakePatchNoop(intake, parsed.value)) {
    return {
      ...baseResult(),
      ok: true,
      outcome: "noop",
      status: 200,
      intake,
      jobs,
    };
  }

  for (const job of jobs) {
    const runningStage = detectRunningDownstreamForEdit(job, "input");
    if (runningStage) {
      return {
        ...baseResult(),
        ok: false,
        outcome: "conflict",
        status: 409,
        error: "downstream_running",
        runningStage,
        intake,
        jobs,
      };
    }
  }

  const updatedIntake: BlueprintIntake = {
    ...intake,
    targetText: parsed.value.targetText ?? intake.targetText,
    githubUrls: parsed.value.githubUrls ?? intake.githubUrls,
    updatedAt: input.now,
  };
  const newlyStaleArtifactIds = new Set<string>();
  const staleArtifactIdsSnapshot = new Set<string>();
  const previewJobs = jobs.map((job) => {
    const jobWithUpdatedIntake = replaceIntakeArtifact(job, updatedIntake);
    const triggeringArtifact = findTriggeringIntakeArtifact(jobWithUpdatedIntake);
    const invalidatedJob = invalidateDownstream(
      jobWithUpdatedIntake,
      "input",
      {
        reason: "upstream_target_changed",
        triggeringArtifactId: triggeringArtifact.id,
        triggeringArtifactType: triggeringArtifact.type,
        now: () => input.now,
      },
    );

    for (const artifactId of newlyStaleIds(jobWithUpdatedIntake, invalidatedJob)) {
      newlyStaleArtifactIds.add(artifactId);
    }
    for (const artifactId of invalidatedJob.staleArtifactIds ?? []) {
      staleArtifactIdsSnapshot.add(artifactId);
    }
    return invalidatedJob;
  });

  const result: BlueprintStageEditPreviewContractResult = {
    ...baseResult(),
    ok: true,
    outcome: "accepted",
    status: 200,
    intake: updatedIntake,
    jobs: previewJobs,
  };
  if (newlyStaleArtifactIds.size > 0) {
    result.staleEdit = {
      fromStage: "input",
      newlyStaleArtifactIds: [...newlyStaleArtifactIds],
      newlyStaleArtifactCount: newlyStaleArtifactIds.size,
      staleArtifactIdsSnapshot: [...staleArtifactIdsSnapshot],
    };
  }
  return result;
}

function baseResult(): Pick<
  BlueprintStageEditPreviewContractResult,
  "contractVersion" | "kind" | "preview"
> {
  return {
    contractVersion: BLUEPRINT_STAGE_EDIT_PYTHON_CONTRACT_VERSION,
    kind: "blueprint.stage_edit.preview",
    preview: {
      stateAuthority: "node",
      persistenceOwner: "node",
      stateMutation: "none",
      appliesMutation: false,
    },
  };
}

function replaceIntakeArtifact(
  job: BlueprintGenerationJob,
  intake: BlueprintIntake,
): BlueprintGenerationJob {
  let replaced = false;
  const artifacts = job.artifacts.map((artifact) => {
    if (artifact.type !== "intake") {
      return artifact;
    }

    replaced = true;
    return {
      ...artifact,
      summary:
        "Normalized target input and GitHub sources captured before route generation.",
      payload: intake,
    };
  });

  if (!replaced) {
    return job;
  }

  return {
    ...job,
    request: {
      ...job.request,
      targetText: intake.targetText,
      githubUrls: intake.githubUrls,
    },
    updatedAt: intake.updatedAt,
    artifacts,
  };
}

function findTriggeringIntakeArtifact(job: BlueprintGenerationJob): {
  id: string;
  type: BlueprintGenerationArtifactType;
} {
  const intakeArtifact = job.artifacts.find(
    (artifact) => artifact.type === "intake",
  );

  return {
    id: intakeArtifact?.id ?? job.request.intakeId ?? job.id,
    type: "intake",
  };
}

function newlyStaleIds(
  before: BlueprintGenerationJob,
  after: BlueprintGenerationJob,
): string[] {
  const beforeIds = new Set(before.staleArtifactIds ?? []);
  return (after.staleArtifactIds ?? []).filter(
    (artifactId) => !beforeIds.has(artifactId),
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
