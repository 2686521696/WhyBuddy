import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintSpecTree,
} from "../../../../shared/blueprint/index.js";

import {
  buildReviewingHandoff,
  inferHandoffState,
  projectHandoffOntoJob,
} from "./handoff-projection.js";

/**
 * `handoff-projection.ts` 的 co-located 单测。
 *
 * 覆盖：
 * 1. `inferHandoffState` 状态表（failed / reviewing / confirmed / idle）；
 * 2. `buildReviewingHandoff` 返回 undefined 当非 reviewing；
 * 3. `buildReviewingHandoff` 填充 selectedPathId / routeId / specTreeId 等字段；
 * 4. `projectHandoffOntoJob` 不修改入参；
 * 5. stageState 存在时 reviewing 会写入 `reviewingHandoff`。
 */

function makeJob(
  overrides: Partial<BlueprintGenerationJob> = {}
): BlueprintGenerationJob {
  return {
    id: overrides.id ?? "job-1",
    request: overrides.request ?? {},
    status: overrides.status ?? "pending",
    stage: overrides.stage ?? "input",
    version: overrides.version ?? "v1",
    createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-07T01:00:00.000Z",
    artifacts: overrides.artifacts ?? [],
    events: overrides.events ?? [],
    stageState: overrides.stageState,
    nextAction: overrides.nextAction,
    error: overrides.error,
  };
}

function selectionArtifact(selection: BlueprintRouteSelection) {
  return {
    id: "art-sel",
    type: "route_selection" as const,
    title: "sel",
    summary: "",
    createdAt: "2026-05-07T00:00:00.000Z",
    payload: selection,
  };
}

function specTreeArtifact(tree: BlueprintSpecTree) {
  return {
    id: "art-tree",
    type: "spec_tree" as const,
    title: "tree",
    summary: "",
    createdAt: "2026-05-07T00:00:00.000Z",
    payload: tree,
  };
}

describe("inferHandoffState", () => {
  it("returns 'failed' when job.error present", () => {
    const job = makeJob({
      error: {
        code: "E",
        message: "x",
        stage: "route_generation",
      },
    });
    expect(inferHandoffState(job)).toBe("failed");
  });

  it("returns 'failed' when status === failed", () => {
    expect(inferHandoffState(makeJob({ status: "failed" }))).toBe("failed");
  });

  it("returns 'reviewing' when status === reviewing", () => {
    expect(inferHandoffState(makeJob({ status: "reviewing" }))).toBe("reviewing");
  });

  it("returns 'confirmed' when completed AND stage is downstream", () => {
    expect(
      inferHandoffState(
        makeJob({ status: "completed", stage: "spec_docs" })
      )
    ).toBe("confirmed");
    expect(
      inferHandoffState(
        makeJob({ status: "completed", stage: "engineering_handoff" })
      )
    ).toBe("confirmed");
  });

  it("returns 'idle' when completed but still at early stage", () => {
    expect(
      inferHandoffState(
        makeJob({ status: "completed", stage: "route_generation" })
      )
    ).toBe("idle");
  });

  it("returns 'idle' by default", () => {
    expect(inferHandoffState(makeJob())).toBe("idle");
  });
});

describe("buildReviewingHandoff", () => {
  it("returns undefined when not in reviewing", () => {
    expect(
      buildReviewingHandoff(makeJob({ status: "running" }))
    ).toBeUndefined();
  });

  it("returns undefined when reviewing but no route_selection artifact", () => {
    expect(
      buildReviewingHandoff(
        makeJob({ status: "reviewing", stage: "spec_tree", artifacts: [] })
      )
    ).toBeUndefined();
  });

  it("returns structured handoff with selectedPathId / routeId / specTreeId", () => {
    const selection = {
      id: "sel-1",
      routeSetId: "rs-1",
      routeId: "route-a",
      selectedPathId: "path-a",
      routeTitle: "Title",
      selectedAt: "2026-05-07T01:00:00.000Z",
      mergedAlternativeRouteIds: [],
      status: "selected" as const,
      provenance: { jobId: "job-1" },
    };
    const tree = { id: "tree-1" } as BlueprintSpecTree;
    const job = makeJob({
      status: "reviewing",
      stage: "spec_tree",
      artifacts: [selectionArtifact(selection), specTreeArtifact(tree)],
    });

    const handoff = buildReviewingHandoff(job);
    expect(handoff).toEqual({
      state: "reviewing",
      stage: "spec_tree",
      selectedPathId: "path-a",
      routeId: "route-a",
      selectionId: "sel-1",
      specTreeId: "tree-1",
      enteredAt: job.updatedAt,
      confirmable: true,
    });
  });

  it("falls back to routeId when selectedPathId is absent", () => {
    const selection = {
      id: "sel-2",
      routeSetId: "rs-1",
      routeId: "route-b",
      routeTitle: "Title",
      selectedAt: "2026-05-07T01:00:00.000Z",
      mergedAlternativeRouteIds: [],
      status: "selected" as const,
      provenance: { jobId: "job-1" },
    };
    const job = makeJob({
      status: "reviewing",
      stage: "route_generation",
      artifacts: [selectionArtifact(selection)],
    });
    const handoff = buildReviewingHandoff(job);
    expect(handoff?.selectedPathId).toBe("route-b");
    expect(handoff?.routeId).toBe("route-b");
  });
});

describe("projectHandoffOntoJob", () => {
  it("does not mutate the input", () => {
    const job = makeJob({ status: "reviewing", stage: "spec_tree" });
    const before = JSON.stringify(job);
    projectHandoffOntoJob(job);
    expect(JSON.stringify(job)).toBe(before);
  });

  it("writes handoffState into the returned job", () => {
    const job = makeJob({ status: "reviewing", stage: "spec_tree" });
    const projected = projectHandoffOntoJob(job);
    expect(projected.handoffState).toBe("reviewing");
  });

  it("attaches reviewingHandoff into existing stageState", () => {
    const selection = {
      id: "sel-3",
      routeSetId: "rs-1",
      routeId: "route-c",
      selectedPathId: "path-c",
      routeTitle: "T",
      selectedAt: "2026-05-07T01:00:00.000Z",
      mergedAlternativeRouteIds: [],
      status: "selected" as const,
      provenance: { jobId: "job-1" },
    };
    const job = makeJob({
      status: "reviewing",
      stage: "spec_tree",
      artifacts: [selectionArtifact(selection)],
      stageState: {
        stage: "spec_tree",
        status: "reviewing",
        payloadKind: "spec_tree",
        artifactIds: [],
      },
    });
    const projected = projectHandoffOntoJob(job);
    expect(projected.stageState?.reviewingHandoff?.state).toBe("reviewing");
    expect(projected.stageState?.reviewingHandoff?.selectedPathId).toBe(
      "path-c"
    );
  });

  it("does not touch stageState when status is not reviewing", () => {
    const job = makeJob({
      status: "running",
      stage: "route_generation",
      stageState: {
        stage: "route_generation",
        status: "running",
        payloadKind: "route_set",
        artifactIds: [],
      },
    });
    const projected = projectHandoffOntoJob(job);
    expect(projected.handoffState).toBe("idle");
    expect(projected.stageState?.reviewingHandoff).toBeUndefined();
  });
});


describe("reset detection", () => {
  it("returns 'reset' when last event message contains 'reset' on route_generation", () => {
    const job = makeJob({
      status: "completed",
      stage: "route_generation",
      events: [
        {
          id: "e-1",
          jobId: "job-1",
          type: "job.stage",
          family: "job",
          stage: "route_generation",
          status: "completed",
          message: "Route selection reset and RouteSet returned to draft.",
          occurredAt: "2026-05-07T01:00:00.000Z",
        },
      ],
    });
    expect(inferHandoffState(job)).toBe("reset");
  });

  it("does not mistake an old reset event at a different stage", () => {
    const job = makeJob({
      status: "completed",
      stage: "spec_tree",
      events: [
        {
          id: "e-1",
          jobId: "job-1",
          type: "job.stage",
          family: "job",
          stage: "route_generation",
          status: "completed",
          message: "Route selection reset earlier.",
          occurredAt: "2026-05-07T01:00:00.000Z",
        },
        {
          id: "e-2",
          jobId: "job-1",
          type: "job.stage",
          family: "job",
          stage: "spec_tree",
          status: "running",
          message: "Selected route Path A and started SPEC tree derivation.",
          occurredAt: "2026-05-07T02:00:00.000Z",
        },
      ],
    });
    expect(inferHandoffState(job)).toBe("idle");
  });
});
