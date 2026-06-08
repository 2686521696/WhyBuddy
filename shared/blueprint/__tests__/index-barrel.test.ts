import { describe, expect, it } from "vitest";

import { BlueprintEventName, isBrainstormRuntimeGraphEvent } from "../index.js";
import type {
  BlueprintAgentCrew,
  BlueprintArtifactMemoryEntry,
  BlueprintClarificationSession,
  BlueprintEffectPreview,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  BlueprintFamilyResponse,
  BrainstormReasoningGraph,
  BrainstormReasoningGraphArtifactPayload,
  BrainstormRuntimeGraphEvent,
  BlueprintImplementationPromptPackage,
  BlueprintIntake,
  BlueprintIntakePatchRequest,
  BlueprintReviewSpecDocumentResponse,
  BlueprintRouteSet,
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintStaleEditResultSummary,
} from "../index.js";

/**
 * `shared/blueprint/index.ts` barrel 的 smoke 测试。
 *
 * 这里只做一件事：确认 8 个子域 `types.ts` re-export 的代表性符号可以通过 barrel 拿到，
 * 并且 `BlueprintEventName` 常量也可以从 barrel 取到。
 *
 * 任何子域 re-export 出错都会让这个文件在编译期立刻失败。
 */
describe("shared/blueprint/index.ts barrel", () => {
  it("re-exports BlueprintEventName runtime constants", () => {
    expect(BlueprintEventName.JobCreated).toBe("job.created");
    expect(BlueprintEventName.RouteSelected).toBe("route.selected");
    expect(BlueprintEventName.SpecTreeUpdated).toBe("spec.tree.updated");
    expect(BlueprintEventName.ReplanTriggered).toBe("replan.triggered");
  });

  it("can be used to type-annotate representative subdomain objects", () => {
    // 这些 `as` 仅用于让 TS 校验类型引用能被解析到；运行期不构造它们。
    const intake = undefined as unknown as BlueprintIntake;
    const clarification = undefined as unknown as BlueprintClarificationSession;
    const job = undefined as unknown as BlueprintGenerationJob;
    const event = undefined as unknown as BlueprintGenerationEvent;
    const crew = undefined as unknown as BlueprintAgentCrew;
    const routeSet = undefined as unknown as BlueprintRouteSet;
    const specTree = undefined as unknown as BlueprintSpecTree;
    const specDocument = undefined as unknown as BlueprintSpecDocument;
    const specDocumentReview =
      undefined as unknown as BlueprintReviewSpecDocumentResponse;
    const preview = undefined as unknown as BlueprintEffectPreview;
    const prompt = undefined as unknown as BlueprintImplementationPromptPackage;
    const ledger = undefined as unknown as BlueprintArtifactMemoryEntry;
    const family = undefined as unknown as BlueprintFamilyResponse;
    const intakePatch = undefined as unknown as BlueprintIntakePatchRequest;
    const staleEdit =
      undefined as unknown as BlueprintStaleEditResultSummary;

    expect(
      [
        intake,
        clarification,
        job,
        event,
        crew,
        routeSet,
        specTree,
        specDocument,
        specDocumentReview,
        preview,
        prompt,
        ledger,
        family,
        intakePatch,
        staleEdit,
      ].every(value => value === undefined)
    ).toBe(true);
  });

  it("allows branch metadata and stale edit summaries on generation jobs", () => {
    const job = {
      id: "job-branch",
      request: {
        intakeId: "intake-1",
        clarificationSessionId: "clarification-1",
        routeSetId: "route-set-1",
        mode: "autopilot_route",
      },
      status: "pending",
      stage: "spec_tree",
      version: "v1",
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      artifacts: [],
      events: [],
      parentJobId: "job-parent",
      branchedAt: "2026-05-23T00:01:00.000Z",
      branchedFromStage: "route_generation",
      staleArtifactIds: [],
    } satisfies BlueprintGenerationJob;
    const summary = {
      fromStage: "input",
      newlyStaleArtifactIds: ["artifact-spec"],
      newlyStaleArtifactCount: 1,
      staleArtifactIdsSnapshot: ["artifact-spec"],
    } satisfies BlueprintStaleEditResultSummary;

    expect(job.parentJobId).toBe("job-parent");
    expect(summary.newlyStaleArtifactCount).toBe(1);
  });

  it("re-exports brainstorm reasoning graph contracts", () => {
    const stages: BrainstormReasoningGraph["stage"][] = [
      "spec_tree",
      "spec_documents",
      "effect_preview",
    ];
    const graph = {
      id: "graph-spec-tree",
      jobId: "job-graph",
      stage: stages[0],
      centralQuestion: {
        id: "question-root",
        title: "How should this SPEC node be implemented?",
      },
      nodes: [
        {
          id: "question-root",
          type: "question",
          title: "How should this SPEC node be implemented?",
          status: "open",
          order: 0,
        },
        {
          id: "evidence-runtime",
          type: "evidence",
          title: "Runtime event supports the route",
          roleId: "runtime-executor",
          roleLabel: "Runtime Executor",
          status: "supported",
          sourceRefs: [{ kind: "reasoning_entry", id: "entry-1" }],
          order: 1,
        },
        {
          id: "synthesis-final",
          type: "synthesis",
          title: "Use the staged SPEC graph",
          status: "resolved",
          order: 2,
        },
      ],
      edges: [
        {
          id: "edge-evidence-synthesis",
          source: "evidence-runtime",
          target: "synthesis-final",
          type: "supports",
          label: "runtime evidence",
          sourceKind: "llm",
        },
      ],
      consoleLines: [
        {
          id: "console-ask",
          kind: "Ask",
          text: "Ask current role for evidence.",
        },
      ],
      source: "llm",
    } satisfies BrainstormReasoningGraph;
    const artifact = {
      type: "brainstorm_reasoning_graph",
      stage: "spec_tree",
      graph,
    } satisfies BrainstormReasoningGraphArtifactPayload;

    expect(stages).toEqual(["spec_tree", "spec_documents", "effect_preview"]);
    expect(artifact.graph.nodes.map((node) => node.type)).toEqual([
      "question",
      "evidence",
      "synthesis",
    ]);
    expect(artifact.graph.edges[0]?.type).toBe("supports");
  });

  it("re-exports autonomous brainstorm runtime graph contracts", () => {
    const event = {
      id: "runtime-event-1",
      type: "decision.marker.emitted",
      jobId: "job-runtime",
      sessionId: "brainstorm-session-runtime",
      stage: "spec_tree",
      occurredAt: "2026-06-08T14:29:44.959Z",
      roleId: "planner",
      nodeId: "node-planner-1",
      marker: "BRANCH",
      rationale: "Planner split the SPEC work into independent branches.",
      confidence: 0.84,
    } satisfies BrainstormRuntimeGraphEvent;

    expect(isBrainstormRuntimeGraphEvent(event)).toBe(true);
    expect(event.marker).toBe("BRANCH");
  });
});


describe("RoleCapabilityPackage barrel re-export（autopilot-role-container-loader Task 2.3）", () => {
  it("可从 @shared/blueprint 直接拿到 RoleCapabilityPackage 类型", () => {
    // 纯类型断言：让 TS 校验 barrel 可以解析到 RoleCapabilityPackage 符号。
    // 若任务 2 的 re-export 丢失，本文件会在 compile 期失败。
    const pkg: import("../index.js").RoleCapabilityPackage = {
      alwaysBound: [{ kind: "mcp", id: "github" }],
      onDemand: {
        aigcNodes: [{ kind: "aigc_node", id: "summary-gen" }],
      },
      resourceBudget: {
        provisionTimeoutMs: 20_000,
        maxConcurrentAigcNodes: 2,
        orchestrationMode: "serial",
      },
      containerImage: "lobster-executor:ai",
    };
    const binding: import("../index.js").RoleCapabilityPackageBinding = {
      kind: "skill",
      id: "summarize",
      optional: true,
    };
    const budget: import("../index.js").RoleResourceBudget = {
      memoryMiB: 1024,
    };

    // 运行期 smoke：字段可读且 shape 稳定。
    expect(pkg.alwaysBound?.[0]?.id).toBe("github");
    expect(pkg.onDemand?.aigcNodes?.[0]?.kind).toBe("aigc_node");
    expect(binding.optional).toBe(true);
    expect(budget.memoryMiB).toBe(1024);
  });
});

describe("BlueprintHandoffState / BlueprintReviewingHandoff", () => {
  it("BlueprintHandoffState 覆盖 5 个显式值", () => {
    const expected: import("../index.js").BlueprintHandoffState[] = [
      "idle",
      "reviewing",
      "confirmed",
      "reset",
      "failed",
    ];
    // 运行期仅验证枚举字面量可在 TS 里逐项赋值，防止未来误改为 union 缩小。
    expect(expected).toHaveLength(5);
  });

  it("BlueprintReviewingHandoff 至少包含被选中路径的 provenance 字段", () => {
    const sample = {
      state: "reviewing",
      stage: "spec_tree",
      selectedPathId: "path-a",
      routeId: "route-a",
      specTreeId: "tree-a",
      enteredAt: "2026-05-07T12:00:00.000Z",
      confirmable: true,
    } satisfies import("../index.js").BlueprintReviewingHandoff;
    expect(sample.state).toBe("reviewing");
    expect(sample.confirmable).toBe(true);
    expect(sample.selectedPathId).toBe("path-a");
    expect(sample.routeId).toBe("route-a");
    expect(sample.specTreeId).toBe("tree-a");
  });
});
