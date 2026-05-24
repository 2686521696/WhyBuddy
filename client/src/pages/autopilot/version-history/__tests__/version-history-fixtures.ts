import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint";
import type { BlueprintFamilyResponse } from "@shared/blueprint/contracts";

import type { VersionHistoryJob } from "../types";

export type StaleArtifact = BlueprintGenerationArtifact & {
  staleSince?: string;
};

export function artifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
  createdAt: string,
  stale?: Pick<StaleArtifact, "staleSince" | "invalidatedBy">,
): StaleArtifact {
  return {
    id,
    type,
    title: `${type} ${id}`,
    summary: `${type} summary`,
    createdAt,
    ...stale,
  };
}

export function job(
  id: string,
  overrides: Partial<VersionHistoryJob> = {},
): VersionHistoryJob {
  return {
    id,
    request: {
      githubUrl: "https://github.com/example/repo",
      projectName: "Example",
    },
    status: "completed",
    stage: "spec_tree",
    version: "v1",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    artifacts: [],
    events: [],
    ...overrides,
  } as VersionHistoryJob;
}

export function family(jobs: VersionHistoryJob[]): BlueprintFamilyResponse {
  return {
    rootJobId: jobs[0]?.id ?? "root",
    jobs,
    replanEvents: [],
  };
}

export function event(
  id: string,
  type: string,
  occurredAt: string,
  message: string,
  payload?: unknown,
  jobId = "job-root",
): BlueprintGenerationEvent {
  return {
    id,
    jobId,
    type,
    family: "job",
    stage: "spec_tree" as BlueprintGenerationStage,
    status: "completed",
    message,
    occurredAt,
    payload,
  } as unknown as BlueprintGenerationEvent;
}
