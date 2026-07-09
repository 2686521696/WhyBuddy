import { describe, expect, it } from "vitest";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BrainstormReasoningGraph } from "@shared/blueprint";

import { deriveBlueprintWallReasoningGraph } from "../blueprint-wall-reasoning-graph";

function makeJob(
  overrides: Partial<BlueprintGenerationJob> = {}
): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {
      mode: "spec_tree",
    },
    status: "reviewing",
    stage: "spec_tree",
    version: "v1",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    artifacts: [],
    events: [],
    ...overrides,
  } as unknown as BlueprintGenerationJob;
}

function makeEntry(
  id: string,
  phase: AgentReasoningEntry["phase"],
  overrides: Partial<AgentReasoningEntry> & { roleId?: string } = {}
): AgentReasoningEntry {
  return {
    id,
    jobId: "job-1",
    iteration: 1,
    iterationLabel: "#1",
    phase,
    timestamp: `2026-06-08T00:00:${String(id.length).padStart(2, "0")}.000Z`,
    stageId: "spec_tree",
    ...overrides,
  } as AgentReasoningEntry;
}

function makeStructuredGraph(
  overrides: Partial<BrainstormReasoningGraph> = {}
): BrainstormReasoningGraph {
  return {
    id: "graph-1",
    jobId: "job-1",
    stage: "spec_tree",
    centralQuestion: {
      id: "question-1",
      title: "Which SPEC path should be used?",
    },
    nodes: [
      {
        id: "question-1",
        type: "question",
        title: "Which SPEC path should be used?",
        status: "open",
        order: 0,
      },
      {
        id: "evidence-1",
        type: "evidence",
        title: "Runtime evidence supports the route",
        roleId: "runtime-role",
        roleLabel: "Runtime Role",
        status: "supported",
        order: 1,
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "question-1",
        target: "evidence-1",
        type: "supports",
        label: "evidence",
        sourceKind: "llm",
      },
    ],
    consoleLines: [
      {
        id: "console-1",
        kind: "Ask",
        text: "Ask runtime role.",
      },
    ],
    telemetry: {
      tokenBurn: 12,
      sourceCount: 2,
      elapsedMs: 3000,
      remainingBudget: 88,
      activeRoleCount: 1,
    },
    source: "llm",
    ...overrides,
  };
}

describe("deriveBlueprintWallReasoningGraph", () => {
  it("prefers valid structured graph payloads over fallback entries", () => {
    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      activeSubStage: "spec_tree",
      structuredGraphs: [makeStructuredGraph()],
      agentReasoningEntries: [
        makeEntry("fallback-thinking", "thinking", {
          thought: "fallback should not win",
          roleId: "fallback-role",
        }),
      ],
    });

    expect(result.mode).toBe("structured");
    expect(result.visibleNodes.map(node => node.id)).toEqual([
      "question-1",
      "evidence-1",
    ]);
    expect(result.consoleLines[0]?.text).toBe("Ask runtime role.");
    expect(result.telemetry.tokenBurn).toBe(12);
  });

  it("prefers spec_documents graphs when the active stage is spec_docs", () => {
    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob({ stage: "spec_docs" }),
      activeSubStage: "spec_docs",
      structuredGraphs: [
        makeStructuredGraph({
          id: "graph-effect",
          stage: "effect_preview",
          nodes: [
            {
              id: "effect-question",
              type: "question",
              title: "Effect preview question",
              status: "open",
            },
          ],
          edges: [],
        }),
        makeStructuredGraph({
          id: "graph-spec-docs",
          stage: "spec_documents",
          subStage: undefined,
        }),
      ],
    });

    expect(result.mode).toBe("structured");
    expect(result.graph?.id).toBe("graph-spec-docs");
    expect(result.graph?.stage).toBe("spec_documents");
  });

  it("ignores wrong-job structured graphs and falls back to current-job entries", () => {
    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      activeSubStage: "spec_tree",
      structuredGraphs: [makeStructuredGraph({ jobId: "job-other" })],
      agentReasoningEntries: [
        makeEntry("entry-thinking", "thinking", {
          thought: "derive a role-specific hypothesis",
          roleId: "role-runtime-executor",
        }),
      ],
      roleLabels: {
        "role-runtime-executor": "Runtime Executor",
      },
    });

    expect(result.mode).toBe("fallback");
    expect(
      result.visibleNodes.some(node => node.roleLabel === "Runtime Executor")
    ).toBe(true);
    expect(
      result.visibleNodes.some(node => node.title.includes("hypothesis"))
    ).toBe(true);
  });

  it("uses selected SPEC node as the fallback central question", () => {
    const specTree = {
      id: "tree-1",
      rootNodeId: "node-auth",
      nodes: [
        {
          id: "node-auth",
          title: "Permission model",
          summary: "Decide role-based permission boundaries",
          type: "feature",
          status: "ready",
          priority: 1,
          dependencies: [],
          outputs: [],
          children: [],
        },
      ],
    } as unknown as BlueprintSpecTree;

    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      activeSubStage: "spec_tree",
      specTree,
      selectedSpecNodeId: "node-auth",
      agentReasoningEntries: [
        makeEntry("entry-observe", "observing", {
          observationSummary: "Existing roles already map to permission scopes",
          observationSuccess: true,
        }),
      ],
    });

    expect(result.graph?.centralQuestion?.title).toBe("Permission model");
    expect(result.visibleNodes[0]?.title).toBe("Permission model");
  });

  it("builds semantic fallback nodes instead of fixed role-only branches", () => {
    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      activeSubStage: "spec_tree",
      roleLabels: {
        "llm-market-scout": "Market Scout",
        "repo-risk-cartographer": "Risk Cartographer",
      },
      agentReasoningEntries: [
        makeEntry("entry-a", "thinking", {
          thought: "Check whether the route has a product hypothesis",
          roleId: "llm-market-scout",
        }),
        makeEntry("entry-b", "observing", {
          observationSummary: "Repository boundary creates implementation risk",
          observationSuccess: false,
          roleId: "repo-risk-cartographer",
        }),
      ],
    });

    expect(result.mode).toBe("fallback");
    expect(result.visibleNodes.map(node => node.type)).toContain("hypothesis");
    expect(result.visibleNodes.map(node => node.type)).toContain("risk");
    expect(result.visibleNodes.map(node => node.roleLabel)).toContain(
      "Market Scout"
    );
    expect(result.visibleNodes.map(node => node.roleLabel)).toContain(
      "Risk Cartographer"
    );
    expect(
      result.visibleNodes.some(node => node.title === "Market Scout")
    ).toBe(false);
  });

  it("omits invalid structured graphs with edges that reference missing nodes", () => {
    const invalidGraph = makeStructuredGraph({
      edges: [
        {
          id: "edge-bad",
          source: "question-1",
          target: "missing",
          type: "supports",
        },
      ],
    });

    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      structuredGraphs: [invalidGraph],
    });

    expect(result.mode).toBe("empty");
    expect(result.emptyReason).toBe("no-reasoning-data");
  });

  it("caps visible nodes and exposes hiddenNodeCount", () => {
    const graph = makeStructuredGraph({
      nodes: Array.from({ length: 5 }, (_, index) => ({
        id: `node-${index}`,
        type: index === 0 ? "question" : "hypothesis",
        title: `Node ${index}`,
        status: "open",
        order: index,
      })),
      edges: [],
    });

    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      structuredGraphs: [graph],
      maxVisibleNodes: 3,
    });

    expect(result.visibleNodes).toHaveLength(3);
    expect(result.hiddenNodeCount).toBe(2);
  });

  it("returns a safe empty state when no job exists", () => {
    const result = deriveBlueprintWallReasoningGraph({
      job: null,
      structuredGraphs: [makeStructuredGraph()],
    });

    expect(result.mode).toBe("empty");
    expect(result.emptyReason).toBe("no-job");
    expect(result.visibleNodes).toEqual([]);
  });

  it("strips debate protocol nodes (critique/rebuttal) from structured graphs so they never enter Effect/Reasoning Flow", () => {
    // A structured graph that (incorrectly) contains first-class debate nodes mixed in,
    // as could happen while server projection still emits them (see reasoning-graph-projection).
    const mixedGraph = makeStructuredGraph({
      nodes: [
        {
          id: "question-1",
          type: "question",
          title: "Main question",
          status: "open",
          order: 0,
        },
        {
          id: "evidence-1",
          type: "evidence",
          title: "Some evidence",
          status: "supported",
          order: 1,
        },
        {
          id: "critique-1",
          type: "critique",
          title: "质疑 claim",
          body: "针对 evidence-1 的问题",
          status: "challenged",
          order: 2,
        },
        {
          id: "rebuttal-1",
          type: "rebuttal",
          title: "反驳",
          body: "坚持原立场",
          status: "supported",
          order: 3,
        },
      ],
      edges: [
        {
          id: "e1",
          source: "question-1",
          target: "evidence-1",
          type: "supports",
          label: "",
          sourceKind: "llm",
        },
        {
          id: "e2",
          source: "evidence-1",
          target: "critique-1",
          type: "conflicts",
          label: "",
          sourceKind: "llm",
        },
        {
          id: "e3",
          source: "critique-1",
          target: "rebuttal-1",
          type: "supports",
          label: "",
          sourceKind: "llm",
        },
      ],
      consoleLines: [
        {
          id: "c1",
          kind: "Report",
          text: "debate console should be ignored by Effect wall",
        },
      ],
    });

    const result = deriveBlueprintWallReasoningGraph({
      job: makeJob(),
      structuredGraphs: [mixedGraph],
    });

    // Must refuse debate nodes for the Effect path.
    const types = result.visibleNodes.map(n => n.type);
    expect(types).not.toContain("critique");
    expect(types).not.toContain("rebuttal");
    expect(result.visibleNodes.map(n => n.id)).toEqual([
      "question-1",
      "evidence-1",
    ]);

    // Edges involving debate nodes must also be dropped.
    expect(
      result.visibleEdges.some(
        e => e.source === "critique-1" || e.target === "critique-1"
      )
    ).toBe(false);
    expect(
      result.visibleEdges.some(
        e => e.source === "rebuttal-1" || e.target === "rebuttal-1"
      )
    ).toBe(false);

    // The graph is still accepted as "structured" (after stripping), not forced to fallback.
    expect(result.mode).toBe("structured");

    // Console isolation: debate-sourced consoleLines must not leak into the Effect/Reasoning
    // wall's consoleLines (they are dropped in stripDebateProtocolNodes when debate nodes present).
    expect(result.consoleLines).toHaveLength(0);
    expect(
      result.consoleLines.some(l => l.text.includes("debate console"))
    ).toBe(false);
  });
});
