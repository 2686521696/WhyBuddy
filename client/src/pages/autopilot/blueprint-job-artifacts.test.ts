import { describe, expect, it } from "vitest";

import type { BrainstormReasoningGraph } from "@shared/blueprint";
import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import {
  readBrainstormReasoningGraphs,
  readJobArtifactPayloads,
  readLatestJobArtifactPayload,
} from "./blueprint-job-artifacts";

function makeGraph(overrides: Partial<BrainstormReasoningGraph> = {}): BrainstormReasoningGraph {
  return {
    id: "graph-1",
    jobId: "job-1",
    stage: "spec_tree",
    nodes: [
      {
        id: "question",
        type: "question",
        title: "What should the SPEC tree prove?",
        status: "open",
      },
      {
        id: "hypothesis",
        type: "hypothesis",
        title: "Split by trust boundary",
        status: "active",
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "question",
        target: "hypothesis",
        type: "refines",
      },
    ],
    source: "llm",
    ...overrides,
  };
}

function makeJob(artifacts: BlueprintGenerationJob["artifacts"]): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "reviewing",
    stage: "spec_tree",
    artifacts,
  } as BlueprintGenerationJob;
}

describe("blueprint job artifact readers", () => {
  it("reads payloads by artifact type and exposes the latest payload", () => {
    const job = makeJob([
      {
        id: "artifact-1",
        type: "spec_tree",
        title: "old",
        summary: "",
        createdAt: "2026-06-08T00:00:00.000Z",
        payload: { version: 1 },
      },
      {
        id: "artifact-2",
        type: "spec_tree",
        title: "new",
        summary: "",
        createdAt: "2026-06-08T00:01:00.000Z",
        payload: { version: 2 },
      },
    ]);

    expect(readJobArtifactPayloads(job, "spec_tree")).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    expect(readLatestJobArtifactPayload(job, "spec_tree")).toEqual({ version: 2 });
  });

  it("returns valid brainstorm reasoning graph artifacts", () => {
    const graph = makeGraph();
    const job = makeJob([
      {
        id: "artifact-graph",
        type: "brainstorm_reasoning_graph",
        title: "Reasoning graph",
        summary: "",
        createdAt: "2026-06-08T00:00:00.000Z",
        payload: {
          type: "brainstorm_reasoning_graph",
          stage: "spec_tree",
          graph,
        },
      },
    ]);

    expect(readBrainstormReasoningGraphs(job)).toEqual([graph]);
  });

  it("accepts legacy direct graph payloads for restored jobs", () => {
    const graph = makeGraph({ id: "legacy-direct" });
    const job = makeJob([
      {
        id: "artifact-graph",
        type: "brainstorm_reasoning_graph",
        title: "Reasoning graph",
        summary: "",
        createdAt: "2026-06-08T00:00:00.000Z",
        payload: graph,
      },
    ]);

    expect(readBrainstormReasoningGraphs(job)).toEqual([graph]);
  });

  it("ignores wrong artifact types and malformed graph payloads", () => {
    const job = makeJob([
      {
        id: "artifact-preview",
        type: "effect_preview",
        title: "Preview",
        summary: "",
        createdAt: "2026-06-08T00:00:00.000Z",
        payload: makeGraph(),
      },
      {
        id: "artifact-malformed",
        type: "brainstorm_reasoning_graph",
        title: "Malformed",
        summary: "",
        createdAt: "2026-06-08T00:00:01.000Z",
        payload: {
          type: "brainstorm_reasoning_graph",
          stage: "spec_tree",
          graph: makeGraph({
            edges: [
              {
                id: "bad-edge",
                source: "question",
                target: "missing-node",
                type: "refines",
              },
            ],
          }),
        },
      },
    ]);

    expect(readBrainstormReasoningGraphs(job)).toEqual([]);
  });
});
