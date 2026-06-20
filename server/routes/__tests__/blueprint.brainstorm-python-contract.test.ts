import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_BRAINSTORM_PYTHON_CONTRACT_VERSION,
  isBlueprintBrainstormPythonContractInput,
  isBlueprintBrainstormPythonContractOutput,
} from "../../../shared/blueprint/brainstorm-contracts.js";
import type { BrainstormReasoningGraph } from "../../../shared/blueprint/brainstorm-reasoning-graph.js";

function makeGraph(): BrainstormReasoningGraph {
  return {
    id: "graph-job-brainstorm-spec-tree",
    jobId: "job-brainstorm",
    stage: "spec_tree",
    subStage: "early-intake",
    centralQuestion: {
      id: "q-root",
      title: "Which migration boundary should the brainstorm explore?",
      body: "Lock the reasoning graph contract before moving runtime code.",
      sourceRefs: [{ kind: "job", id: "job-brainstorm", label: "Job" }],
    },
    nodes: [
      {
        id: "q-root",
        type: "question",
        title: "Which migration boundary should the brainstorm explore?",
        body: "Lock the reasoning graph contract before moving runtime code.",
        roleId: "planner",
        roleLabel: "Planner",
        conclusionBadge: "question",
        capabilityId: "brainstorm.contract",
        status: "open",
        confidence: 0.72,
        sourceRefs: [{ kind: "job", id: "job-brainstorm" }],
        order: 0,
        turnId: "turn-1",
        round: 1,
        capabilityRunId: "cap-run-1",
        producedRunId: "run-1",
        producedArtifactId: "artifact-1",
        derivedFrom: ["input-1"],
      },
      {
        id: "hypothesis-contract",
        type: "hypothesis",
        title: "Keep Node as runtime owner for this slice",
        body: "Python only proves graph/input/output/error compatibility.",
        roleId: "architect",
        roleLabel: "Architect",
        status: "supported",
        confidence: 0.84,
        sourceRefs: [{ kind: "stage", id: "spec_tree" }],
        order: 1,
        turnId: "turn-1",
        round: 1,
        capabilityRunId: "cap-run-1",
        producedRunId: "run-1",
        producedArtifactId: "artifact-1",
        derivedFrom: ["q-root"],
      },
    ],
    edges: [
      {
        id: "edge-q-hypothesis",
        source: "q-root",
        target: "hypothesis-contract",
        type: "refines",
        label: "contract boundary",
        confidence: 0.81,
        sourceKind: "llm",
        capabilityId: "brainstorm.contract",
      },
    ],
    telemetry: {
      tokenBurn: 128,
      sourceCount: 2,
      elapsedMs: 42,
      remainingBudget: 4096,
      activeRoleCount: 2,
    },
    consoleLines: [
      {
        id: "console-1",
        kind: "Thinking",
        text: "Projecting brainstorm reasoning graph shape.",
        roleId: "architect",
        timestamp: "2026-06-20T00:00:00.000Z",
      },
    ],
    source: "llm",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:01.000Z",
  };
}

describe("Blueprint brainstorm Python contract", () => {
  it("maps graph/input without dropping reasoning graph fields", () => {
    const graph = makeGraph();
    const input = {
      contractVersion: BLUEPRINT_BRAINSTORM_PYTHON_CONTRACT_VERSION,
      jobId: "job-brainstorm",
      stageId: "spec_tree",
      stageContext: "Generate a spec tree from early intake.",
      request: {
        targetText: "Migrate only the contract boundary.",
        locale: "en-US",
      },
      graph,
    };

    expect(isBlueprintBrainstormPythonContractInput(input)).toBe(true);

    const node = graph.nodes[0];
    expect(node.conclusionBadge).toBe("question");
    expect(node.capabilityId).toBe("brainstorm.contract");
    expect(node.turnId).toBe("turn-1");
    expect(node.round).toBe(1);
    expect(node.capabilityRunId).toBe("cap-run-1");
    expect(node.producedRunId).toBe("run-1");
    expect(node.producedArtifactId).toBe("artifact-1");
    expect(node.derivedFrom).toEqual(["input-1"]);
    expect(graph.edges[0].capabilityId).toBe("brainstorm.contract");
  });

  it("maps completed output and keeps graph compatibility", () => {
    const output = {
      contractVersion: BLUEPRINT_BRAINSTORM_PYTHON_CONTRACT_VERSION,
      ok: true,
      status: "completed",
      graph: makeGraph(),
      decision: "Keep this task at the contract boundary.",
      reasoning: "The runtime remains Node-owned while Python locks the graph shape.",
      metadata: {
        source: "python-contract",
        promptId: "blueprint.brainstorm.reasoning-graph.v1",
        promptFingerprint: "sha256:contract",
        responseDigest: "sha256:response",
      },
    };

    expect(isBlueprintBrainstormPythonContractOutput(output)).toBe(true);
  });

  it("keeps partial and error outputs from pretending to be completed success", () => {
    const partial = {
      contractVersion: BLUEPRINT_BRAINSTORM_PYTHON_CONTRACT_VERSION,
      ok: false,
      status: "partial",
      graph: makeGraph(),
      partialReason: "reasoning graph projected, synthesis incomplete",
    };
    const error = {
      contractVersion: BLUEPRINT_BRAINSTORM_PYTHON_CONTRACT_VERSION,
      ok: false,
      status: "error",
      error: {
        code: "invalid_graph",
        message: "nodes must be non-empty",
        retryable: false,
      },
    };

    expect(isBlueprintBrainstormPythonContractOutput(partial)).toBe(true);
    expect(isBlueprintBrainstormPythonContractOutput(error)).toBe(true);
    expect(
      isBlueprintBrainstormPythonContractOutput({
        ...partial,
        ok: true,
        status: "completed",
      }),
    ).toBe(false);
    expect(
      isBlueprintBrainstormPythonContractOutput({
        ...error,
        ok: true,
        status: "completed",
      }),
    ).toBe(false);
  });
});
