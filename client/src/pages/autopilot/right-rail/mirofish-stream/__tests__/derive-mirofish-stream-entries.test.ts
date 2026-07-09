/**
 * autopilot-mirofish-stream / Wave 0
 *
 * deriveMiroFishStreamEntries 单测。
 *
 * 覆盖范围：
 * - 6 类 entry 各自能从 input 派生出来
 * - id 去重（后到覆盖先到）
 * - timestamp 升序排序（stable）
 * - 缺失 input slice / null 不抛错
 * - capability 缺 timestamp 时跳过（不造假）
 * - node_completed 仅在 lifecycle === "complete" 时派生
 * - source 多数派折算（template > fallback > llm）
 * - artifact.type → stageId 全表映射
 */

import { describe, expect, it } from "vitest";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { CapabilityStatus } from "@/lib/blueprint-realtime-store";
import type { SpecDocumentTreeStats } from "@/lib/blueprint-spec-document-stats";

import {
  __testing__,
  deriveMiroFishStreamEntries,
} from "../derive-mirofish-stream-entries";

const {
  artifactTypeToStageId,
  reasoningTone,
  capabilityTone,
  capabilityStatusFromMap,
  combineGenerationSource,
} = __testing__;

// ─── 工厂函数 ─────────────────────────────────────────────────────────────

function makeReasoning(
  partial: Partial<AgentReasoningEntry> & {
    id: string;
    phase: AgentReasoningEntry["phase"];
  }
): AgentReasoningEntry {
  return {
    id: partial.id,
    jobId: "job-1",
    iteration: 1,
    iterationLabel: "#1",
    phase: partial.phase,
    timestamp: "2026-05-17T07:00:00.000Z",
    ...partial,
  } as AgentReasoningEntry;
}

function makeArtifact(
  partial: Partial<BlueprintGenerationArtifact> & {
    id: string;
    type: BlueprintGenerationArtifact["type"];
  }
): BlueprintGenerationArtifact {
  return {
    id: partial.id,
    type: partial.type,
    title: partial.title ?? `${partial.type} title`,
    summary: partial.summary ?? `${partial.type} summary`,
    createdAt: partial.createdAt ?? "2026-05-17T07:00:00.000Z",
    payload: partial.payload,
  };
}

function makeRouteSet(
  partial: Partial<BlueprintRouteSet> & { primaryRouteId?: string } = {}
): BlueprintRouteSet {
  return {
    id: "rs-1",
    primaryRouteId: partial.primaryRouteId ?? "route-1",
    routes: partial.routes ?? [
      {
        id: "route-1",
        title: "Primary route",
        kind: "primary",
        steps: [],
      } as unknown as BlueprintRouteSet["routes"][0],
      {
        id: "route-2",
        title: "Alt route",
        kind: "alternative",
        steps: [],
      } as unknown as BlueprintRouteSet["routes"][0],
    ],
  } as unknown as BlueprintRouteSet;
}

function makeRouteSelection(
  partial: Partial<BlueprintRouteSelection> & { id?: string } = {}
): BlueprintRouteSelection {
  return {
    id: partial.id ?? "sel-1",
    routeSetId: "rs-1",
    routeId: partial.routeId ?? "route-1",
    routeTitle: partial.routeTitle ?? "Primary route",
    selectedAt: partial.selectedAt ?? "2026-05-17T07:01:00.000Z",
    selectedBy: partial.selectedBy ?? "user-1",
    reason: partial.reason,
    mergedAlternativeRouteIds: [],
    status: "selected",
    provenance: {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
    },
  } as unknown as BlueprintRouteSelection;
}

function makeSpecTree(nodeIds: string[]): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: nodeIds[0] ?? "n-0",
    version: 1,
    status: "reviewing",
    createdAt: "2026-05-17T07:00:00.000Z",
    updatedAt: "2026-05-17T07:00:00.000Z",
    alternativeRouteIds: [],
    nodes: nodeIds.map(id => ({
      id,
      title: `Node ${id}`,
      summary: `Node ${id} summary`,
      type: "route_step",
      status: "draft",
      priority: 1,
      dependencies: [],
      outputs: [],
      children: [],
    })),
    provenance: {
      jobId: "job-1",
      githubUrls: [],
    },
  } as unknown as BlueprintSpecTree;
}

function makeDoc(
  nodeId: string,
  type: "requirements" | "design" | "tasks",
  source:
    | BlueprintSpecDocument["provenance"]["generationSource"]
    | undefined = "llm",
  createdAt: string = "2026-05-17T07:02:00.000Z"
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status: "reviewing",
    title: `${type} ${nodeId}`,
    summary: "summary",
    content: "",
    format: "markdown",
    createdAt,
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "route_step",
      nodeTitle: nodeId,
      nodeSummary: "x",
      dependencies: [],
      outputs: [],
      generationSource: source,
    },
  } as unknown as BlueprintSpecDocument;
}

function makeStats(
  byNodeId: Record<
    string,
    {
      lifecycle: "complete" | "partial" | "empty" | "generating";
      documents: BlueprintSpecDocument[];
    }
  >
): SpecDocumentTreeStats {
  const map = new Map();
  let generated = 0;
  let complete = 0;
  for (const [nodeId, info] of Object.entries(byNodeId)) {
    map.set(nodeId, {
      nodeId,
      total: 3,
      generated: info.documents.length,
      documents: info.documents,
      missingTypes: [],
      lifecycle: info.lifecycle,
    });
    generated += info.documents.length;
    if (info.lifecycle === "complete") complete += 1;
  }
  return {
    totalNodes: map.size,
    totalDocuments: map.size * 3,
    generatedDocuments: generated,
    completeNodes: complete,
    documents: Object.values(byNodeId).flatMap(v => v.documents),
    byNodeId: map,
  };
}

// ─── helpers 单测 ─────────────────────────────────────────────────────────

describe("deriveMiroFishStreamEntries / helpers", () => {
  it("artifactTypeToStageId 全 known type 映射", () => {
    expect(artifactTypeToStageId("intake")).toBe("intake_created");
    expect(artifactTypeToStageId("clarification_session")).toBe("clarification");
    expect(artifactTypeToStageId("route_set")).toBe("route_generation");
    expect(artifactTypeToStageId("route_selection")).toBe("route_selection");
    expect(artifactTypeToStageId("spec_tree")).toBe("spec_tree");
    expect(artifactTypeToStageId("requirements")).toBe("spec_docs");
    expect(artifactTypeToStageId("design")).toBe("spec_docs");
    expect(artifactTypeToStageId("tasks")).toBe("spec_docs");
    expect(artifactTypeToStageId("effect_preview")).toBe("effect_preview");
    expect(artifactTypeToStageId("prompt_pack")).toBe("prompt_packaging");
    expect(artifactTypeToStageId("agent_crew")).toBe("agent_crew_fabric");
    expect(artifactTypeToStageId("engineering_plan")).toBe("engineering_handoff");
    expect(artifactTypeToStageId("capability_registry")).toBe("runtime_capability");
  });

  it("artifactTypeToStageId unknown 返回 undefined", () => {
    expect(artifactTypeToStageId("replay")).toBeUndefined();
    expect(artifactTypeToStageId("feedback")).toBeUndefined();
    expect(artifactTypeToStageId("unknown_xyz")).toBeUndefined();
  });

  it("reasoningTone 5 类 phase 映射", () => {
    const base = makeReasoning({ id: "x", phase: "thinking" });
    expect(reasoningTone({ ...base, phase: "thinking" })).toBe("info");
    expect(reasoningTone({ ...base, phase: "acting" })).toBe("info");
    expect(
      reasoningTone({ ...base, phase: "observing", observationSuccess: true })
    ).toBe("success");
    expect(
      reasoningTone({ ...base, phase: "observing", observationSuccess: false })
    ).toBe("warning");
    expect(reasoningTone({ ...base, phase: "completed" })).toBe("success");
    expect(reasoningTone({ ...base, phase: "error" })).toBe("danger");
  });

  it("capabilityTone 3 类 status 映射", () => {
    expect(capabilityTone("invoking")).toBe("info");
    expect(capabilityTone("completed")).toBe("success");
    expect(capabilityTone("failed")).toBe("danger");
  });

  it("capabilityStatusFromMap idle 返回 null（不入流）", () => {
    expect(capabilityStatusFromMap("idle")).toBeNull();
    expect(capabilityStatusFromMap("invoking")).toBe("invoking");
    expect(capabilityStatusFromMap("completed")).toBe("completed");
    expect(capabilityStatusFromMap("failed")).toBe("failed");
  });

  it("combineGenerationSource template > fallback > llm", () => {
    expect(combineGenerationSource(["llm", "llm"])).toBe("llm");
    expect(combineGenerationSource(["llm", "llm_fallback"])).toBe("fallback");
    expect(combineGenerationSource(["llm_fallback", "template"])).toBe("template");
    expect(combineGenerationSource(["template", "llm", "llm_fallback"])).toBe(
      "template"
    );
    expect(combineGenerationSource([undefined, undefined])).toBeUndefined();
    expect(combineGenerationSource([])).toBeUndefined();
    // undefined 折算为 llm
    expect(combineGenerationSource([undefined, "llm"])).toBe("llm");
  });
});

// ─── 主派生函数 ──────────────────────────────────────────────────────────

describe("deriveMiroFishStreamEntries", () => {
  it("空 input 返回空数组", () => {
    expect(deriveMiroFishStreamEntries({})).toEqual([]);
  });

  it("undefined / null 输入不抛错", () => {
    const result = deriveMiroFishStreamEntries({
      agentReasoning: undefined,
      capabilityStatuses: undefined,
      artifacts: undefined,
      routeSelection: null,
      routeSet: null,
      specTree: null,
      specDocumentTreeStats: null,
    });
    expect(result).toEqual([]);
  });

  it("agentReasoning entries 派生为 reasoning kind", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "evt-1",
          phase: "thinking",
          thought: "正在分析仓库",
        }),
        makeReasoning({
          id: "evt-2",
          phase: "acting",
          actionToolId: "github.scan",
          timestamp: "2026-05-17T07:00:01.000Z",
        }),
        makeReasoning({
          id: "evt-3",
          phase: "observing",
          observationSuccess: true,
          observationSummary: "扫描完成",
          timestamp: "2026-05-17T07:00:02.000Z",
        }),
      ],
    });
    expect(entries).toHaveLength(3);
    expect(entries.every(e => e.kind === "reasoning")).toBe(true);
    expect(entries[0].id).toBe("evt-1");
    expect(entries[2].tone).toBe("success");
  });

  it("iteration_started / iteration_completed 被过滤掉", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({ id: "i-1", phase: "iteration_started" }),
        makeReasoning({ id: "i-2", phase: "iteration_completed" }),
        makeReasoning({
          id: "t-1",
          phase: "thinking",
          thought: "x",
        }),
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("t-1");
  });

  it("routeSelection + routeSet 派生 route_decision entry", () => {
    const entries = deriveMiroFishStreamEntries({
      routeSelection: makeRouteSelection({
        id: "sel-1",
        routeId: "route-2",
        routeTitle: "Alt route",
        selectedAt: "2026-05-17T07:01:00.000Z",
      }),
      routeSet: makeRouteSet(),
    });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kind).toBe("route_decision");
    expect(entry.id).toBe("route-decision-sel-1");
    expect(entry.stageId).toBe("route_selection");
    if (entry.kind === "route_decision") {
      expect(entry.routeKind).toBe("alternative");
      expect(entry.routeTitle).toBe("Alt route");
    }
  });

  it("routeSelection 缺 routeSet 时 routeKind undefined,但仍派生 entry", () => {
    const entries = deriveMiroFishStreamEntries({
      routeSelection: makeRouteSelection(),
    });
    expect(entries).toHaveLength(1);
    if (entries[0].kind === "route_decision") {
      expect(entries[0].routeKind).toBeUndefined();
    }
  });

  it("capability_invocation 优先用 reasoning acting 时间戳", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "act-1",
          phase: "acting",
          actionToolId: "docker-analysis-sandbox",
          timestamp: "2026-05-17T07:05:00.000Z",
          stageId: "spec_tree",
        }),
      ],
      capabilityStatuses: {
        "docker-analysis-sandbox": "completed",
      } as Record<string, CapabilityStatus>,
    });
    const cap = entries.find(e => e.kind === "capability_invocation");
    expect(cap).toBeDefined();
    expect(cap!.timestamp).toBe("2026-05-17T07:05:00.000Z");
    expect(cap!.stageId).toBe("spec_tree");
    if (cap!.kind === "capability_invocation") {
      expect(cap!.capabilityId).toBe("docker-analysis-sandbox");
      expect(cap!.status).toBe("completed");
      expect(cap!.tone).toBe("success");
    }
  });

  it("capability_invocation 找不到 acting timestamp 时跳过（避免造假）", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [],
      capabilityStatuses: {
        "missing-cap": "invoking",
      } as Record<string, CapabilityStatus>,
    });
    expect(entries.filter(e => e.kind === "capability_invocation")).toHaveLength(0);
  });

  it("capabilityStatuses idle 不入流", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "act-1",
          phase: "acting",
          actionToolId: "cap-1",
        }),
      ],
      capabilityStatuses: {
        "cap-1": "idle",
      } as Record<string, CapabilityStatus>,
    });
    expect(entries.filter(e => e.kind === "capability_invocation")).toHaveLength(0);
  });

  it("artifacts 派生 artifact_created entry", () => {
    const entries = deriveMiroFishStreamEntries({
      artifacts: [
        makeArtifact({
          id: "artifact-1",
          type: "spec_tree",
          title: "Derived SPEC tree",
          createdAt: "2026-05-17T07:03:00.000Z",
        }),
        makeArtifact({
          id: "artifact-2",
          type: "requirements",
          title: "Auth req",
          createdAt: "2026-05-17T07:04:00.000Z",
        }),
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("artifact-1");
    expect(entries[0].stageId).toBe("spec_tree");
    expect(entries[1].id).toBe("artifact-2");
    expect(entries[1].stageId).toBe("spec_docs");
  });

  it("artifact 缺 createdAt 时被跳过", () => {
    const entries = deriveMiroFishStreamEntries({
      artifacts: [
        makeArtifact({
          id: "no-ts",
          type: "spec_tree",
          createdAt: "",
        }),
      ],
    });
    expect(entries).toHaveLength(0);
  });

  it("specTree + specDocumentTreeStats 派生 node_completed（仅 lifecycle=complete）", () => {
    const tree = makeSpecTree(["n-1", "n-2", "n-3"]);
    const stats = makeStats({
      "n-1": {
        lifecycle: "complete",
        documents: [
          makeDoc("n-1", "requirements", "llm", "2026-05-17T07:10:00.000Z"),
          makeDoc("n-1", "design", "llm", "2026-05-17T07:10:01.000Z"),
          makeDoc("n-1", "tasks", "llm_fallback", "2026-05-17T07:10:02.000Z"),
        ],
      },
      "n-2": {
        lifecycle: "partial",
        documents: [
          makeDoc("n-2", "requirements", "llm", "2026-05-17T07:11:00.000Z"),
        ],
      },
      "n-3": {
        lifecycle: "complete",
        documents: [
          makeDoc("n-3", "requirements", "template", "2026-05-17T07:12:00.000Z"),
          makeDoc("n-3", "design", "template", "2026-05-17T07:12:01.000Z"),
          makeDoc("n-3", "tasks", "template", "2026-05-17T07:12:02.000Z"),
        ],
      },
    });

    const entries = deriveMiroFishStreamEntries({
      specTree: tree,
      specDocumentTreeStats: stats,
    });

    const nodeEntries = entries.filter(e => e.kind === "node_completed");
    expect(nodeEntries).toHaveLength(2);
    const n1 = nodeEntries.find(e => e.id === "node-completed-n-1");
    const n3 = nodeEntries.find(e => e.id === "node-completed-n-3");
    expect(n1).toBeDefined();
    expect(n3).toBeDefined();
    if (n1?.kind === "node_completed") {
      expect(n1.nodeTitle).toBe("Node n-1");
      expect(n1.timestamp).toBe("2026-05-17T07:10:02.000Z");
      expect(n1.generationSource).toBe("fallback"); // mixed llm + llm_fallback
      expect(n1.tone).toBe("warning");
    }
    if (n3?.kind === "node_completed") {
      expect(n3.generationSource).toBe("template");
      expect(n3.tone).toBe("warning");
    }
  });

  it("node_completed 全 llm source → tone success", () => {
    const tree = makeSpecTree(["n-1"]);
    const stats = makeStats({
      "n-1": {
        lifecycle: "complete",
        documents: [
          makeDoc("n-1", "requirements", "llm"),
          makeDoc("n-1", "design", "llm"),
          makeDoc("n-1", "tasks", "llm"),
        ],
      },
    });
    const entries = deriveMiroFishStreamEntries({
      specTree: tree,
      specDocumentTreeStats: stats,
    });
    const node = entries.find(e => e.kind === "node_completed");
    if (node?.kind === "node_completed") {
      expect(node.generationSource).toBe("llm");
      expect(node.tone).toBe("success");
    }
  });

  it("id 去重：同 id 后到覆盖前到", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "evt-1",
          phase: "thinking",
          thought: "first",
          timestamp: "2026-05-17T07:00:00.000Z",
        }),
        makeReasoning({
          id: "evt-1",
          phase: "completed",
          timestamp: "2026-05-17T07:00:05.000Z",
        }),
      ],
    });
    expect(entries).toHaveLength(1);
    if (entries[0].kind === "reasoning") {
      expect(entries[0].phase).toBe("completed");
    }
  });

  it("混合多 kind 时按 timestamp 升序排序", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "evt-2",
          phase: "thinking",
          thought: "x",
          timestamp: "2026-05-17T07:01:00.000Z",
        }),
      ],
      routeSelection: makeRouteSelection({
        id: "sel-1",
        selectedAt: "2026-05-17T07:00:30.000Z",
      }),
      routeSet: makeRouteSet(),
      artifacts: [
        makeArtifact({
          id: "a-1",
          type: "spec_tree",
          createdAt: "2026-05-17T07:02:00.000Z",
        }),
      ],
    });
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe("route_decision"); // 07:00:30
    expect(entries[1].kind).toBe("reasoning"); // 07:01:00
    expect(entries[2].kind).toBe("artifact_created"); // 07:02:00
  });

  it("非法 timestamp 落到流尾", () => {
    const entries = deriveMiroFishStreamEntries({
      agentReasoning: [
        makeReasoning({
          id: "good",
          phase: "thinking",
          thought: "x",
          timestamp: "2026-05-17T07:00:00.000Z",
        }),
        makeReasoning({
          id: "bad",
          phase: "thinking",
          thought: "y",
          timestamp: "not-a-date",
        }),
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("good");
    expect(entries[1].id).toBe("bad");
  });
});
