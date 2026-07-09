/**
 * autopilot-scene-fusion / blueprint-wall-process-data 纯函数测试。
 *
 * 沿用本仓 example-based 测试模式（vitest 内置 describe / it / expect），
 * 不引入 PBT、不引入 React、不引入 jsdom / happy-dom / @testing-library。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type { BlueprintEffectPreviewSnapshot } from "@/lib/blueprint-api";
import type {
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

import {
  BLUEPRINT_SCENE_STAGES,
  getBlueprintSceneStageSignal,
} from "../blueprint-stage-signal";
import {
  deriveBlueprintWallProcessData,
  type BlueprintWallArtifactInput,
} from "../blueprint-wall-process-data";

/** 构造一个最小可用的 BlueprintGenerationJob mock。 */
function makeJob(
  overrides: Partial<BlueprintGenerationJob> = {}
): BlueprintGenerationJob {
  return {
    id: "job-1",
    request: {},
    status: "running",
    stage: "spec_tree",
    ...overrides,
  } as unknown as BlueprintGenerationJob;
}

/** 构造一个最小可用的 AgentReasoningEntry mock。 */
function makeReasoning(
  overrides: Partial<AgentReasoningEntry> & { id: string; jobId: string }
): AgentReasoningEntry {
  return {
    iteration: 0,
    iterationLabel: "#0",
    phase: "thinking",
    timestamp: "2026-05-31T00:00:00.000Z",
    ...overrides,
  } as AgentReasoningEntry;
}

describe("deriveBlueprintWallProcessData / null job safe output", () => {
  it("job: null 返回安全空数据，不抛错", () => {
    const result = deriveBlueprintWallProcessData({ job: null });

    expect(result).toBeDefined();
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.emptyReason).toBe("no-job");
    expect(result.stageSignal).toBeDefined();
    expect(result.stageSignal.stageKey).toBe("input");
  });

  it("job: undefined 返回安全空数据，不抛错", () => {
    const result = deriveBlueprintWallProcessData({ job: undefined });

    expect(result).toBeDefined();
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.emptyReason).toBe("no-job");
    expect(result.stageSignal).toBeDefined();
    expect(result.stageSignal.stageKey).toBe("input");
  });
});

describe("deriveBlueprintWallProcessData / stageSignal consistency", () => {
  it("null job 的 stageSignal 与 getBlueprintSceneStageSignal(null) 一致", () => {
    const result = deriveBlueprintWallProcessData({ job: null });
    const expected = getBlueprintSceneStageSignal(null);

    expect(result.stageSignal).toEqual(expected);
  });

  it("undefined job 的 stageSignal 与 getBlueprintSceneStageSignal(undefined) 一致", () => {
    const result = deriveBlueprintWallProcessData({ job: undefined });
    const expected = getBlueprintSceneStageSignal(undefined);

    expect(result.stageSignal).toEqual(expected);
  });

  it("valid job 的 stageSignal 与 getBlueprintSceneStageSignal(job) 完全一致", () => {
    const job = makeJob({ stage: "spec_tree" } as unknown as Partial<BlueprintGenerationJob>);
    const result = deriveBlueprintWallProcessData({ job });
    const expected = getBlueprintSceneStageSignal(job);

    expect(result.stageSignal).toEqual(expected);
  });

  it("backend alias stage 的 stageSignal 与 getBlueprintSceneStageSignal(job) 一致", () => {
    const job = makeJob({ stage: "preview" } as unknown as Partial<BlueprintGenerationJob>);
    const result = deriveBlueprintWallProcessData({ job });
    const expected = getBlueprintSceneStageSignal(job);

    expect(result.stageSignal).toEqual(expected);
    // preview 应映射到 effect_preview
    expect(result.stageSignal.stageKey).toBe("effect_preview");
  });
});

describe("deriveBlueprintWallProcessData / stage graph nodes", () => {
  it("阶段节点数量等于 BLUEPRINT_SCENE_STAGES.length", () => {
    const job = makeJob();
    const result = deriveBlueprintWallProcessData({ job });

    const stageNodes = result.nodes.filter((node) => node.type === "stage");
    expect(stageNodes).toHaveLength(BLUEPRINT_SCENE_STAGES.length);
    // 当前阶段节点总数应为 9（input..engineering_handoff）
    expect(stageNodes).toHaveLength(9);
  });

  it("阶段节点使用稳定 id `stage:${stageKey}`，覆盖全部 BLUEPRINT_SCENE_STAGES", () => {
    const job = makeJob();
    const result = deriveBlueprintWallProcessData({ job });

    const stageNodeIds = result.nodes
      .filter((node) => node.type === "stage")
      .map((node) => node.id);

    for (const stageKey of BLUEPRINT_SCENE_STAGES) {
      expect(stageNodeIds).toContain(`stage:${stageKey}`);
    }
  });

  it("active 阶段节点由 stageSignal.stageIndex 决定（spec_tree → index 4）", () => {
    const job = makeJob({ stage: "spec_tree" } as unknown as Partial<BlueprintGenerationJob>);
    const result = deriveBlueprintWallProcessData({ job });
    const { stageIndex } = result.stageSignal;

    // spec_tree 的 stageIndex 应为 4（input=0..spec_tree=4）
    expect(stageIndex).toBe(4);

    const stageNodes = result.nodes.filter((node) => node.type === "stage");

    // 当前 active 节点对应 stage:spec_tree
    const activeNodes = stageNodes.filter((node) => node.status === "active");
    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.id).toBe(`stage:${BLUEPRINT_SCENE_STAGES[stageIndex]}`);
    expect(activeNodes[0]?.id).toBe("stage:spec_tree");

    // 每个阶段节点的状态严格由 stageIndex 派生：前 completed / 当前 active / 后 queued
    BLUEPRINT_SCENE_STAGES.forEach((stageKey, index) => {
      const node = stageNodes.find((n) => n.id === `stage:${stageKey}`);
      expect(node).toBeDefined();
      if (index < stageIndex) {
        expect(node?.status).toBe("completed");
      } else if (index === stageIndex) {
        expect(node?.status).toBe("active");
      } else {
        expect(node?.status).toBe("queued");
      }
    });
  });

  it("后端别名 stage `preview` 的 active 节点匹配 getBlueprintSceneStageSignal（effect_preview，无第二套阶段公式）", () => {
    const job = makeJob({ stage: "preview" } as unknown as Partial<BlueprintGenerationJob>);
    const result = deriveBlueprintWallProcessData({ job });
    const expected = getBlueprintSceneStageSignal(job);

    // 复用同一阶段信号源：preview → effect_preview（index 6）
    expect(result.stageSignal).toEqual(expected);
    expect(result.stageSignal.stageKey).toBe("effect_preview");
    expect(result.stageSignal.stageIndex).toBe(6);

    const stageNodes = result.nodes.filter((node) => node.type === "stage");
    const activeNodes = stageNodes.filter((node) => node.status === "active");
    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.id).toBe(
      `stage:${BLUEPRINT_SCENE_STAGES[expected.stageIndex]}`
    );
    expect(activeNodes[0]?.id).toBe("stage:effect_preview");
  });
});

describe("deriveBlueprintWallProcessData / reasoning nodes and console lines", () => {
  it("作业隔离：reasoning 节点与 console 行只引用当前 job 的 entries（Req 3.1）", () => {
    const job = makeJob(); // id "job-1"
    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: [
        makeReasoning({ id: "a1", jobId: "job-1", iterationLabel: "#1" }),
        makeReasoning({ id: "b1", jobId: "job-2", iterationLabel: "#1" }),
        makeReasoning({ id: "a2", jobId: "job-1", iterationLabel: "#2" }),
        makeReasoning({ id: "b2", jobId: "job-2", iterationLabel: "#2" }),
      ],
    });

    const reasoningNodes = result.nodes.filter(
      (node) => node.type === "reasoning"
    );
    // 仅 job-1 的两条 entry 生成 reasoning 节点
    expect(reasoningNodes).toHaveLength(2);
    expect(reasoningNodes.map((node) => node.id)).toEqual([
      "reasoning:a1",
      "reasoning:a2",
    ]);

    // job-2 的 entry id 不应出现在任何 reasoning 节点 id 中
    const nodeIds = result.nodes.map((node) => node.id);
    expect(nodeIds.some((id) => id.includes("b1"))).toBe(false);
    expect(nodeIds.some((id) => id.includes("b2"))).toBe(false);

    // job-2 的 entry id 不应出现在任何 console 行 id 中
    const consoleIds = result.consoleLines.map((line) => line.id);
    expect(consoleIds).toEqual([
      "console:reasoning:a1",
      "console:reasoning:a2",
    ]);
    expect(consoleIds.some((id) => id.includes("b1"))).toBe(false);
    expect(consoleIds.some((id) => id.includes("b2"))).toBe(false);

    // 计数器只反映 job-1 的过滤数量
    expect(result.compatibility.counters.reasoningEntries).toBe(2);
  });

  it("max reasoning node cap：保留最近的若干条（tail），计数仍为全量（Req 4.5）", () => {
    const job = makeJob(); // id "job-1"
    const entries = Array.from({ length: 20 }, (_, index) =>
      makeReasoning({
        id: `r${index}`,
        jobId: "job-1",
        iteration: index,
        iterationLabel: `#${index}`,
      })
    );

    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: entries,
      maxReasoningNodes: 5,
    });

    const reasoningNodes = result.nodes.filter(
      (node) => node.type === "reasoning"
    );
    // 上限裁剪到 5 个 reasoning 节点
    expect(reasoningNodes).toHaveLength(5);
    // 保留的是输入数组尾部最后 5 条（r15..r19）
    expect(reasoningNodes.map((node) => node.id)).toEqual([
      "reasoning:r15",
      "reasoning:r16",
      "reasoning:r17",
      "reasoning:r18",
      "reasoning:r19",
    ]);

    // 计数器仍反映全量过滤数（20）
    expect(result.compatibility.counters.reasoningEntries).toBe(20);
  });

  it("max console line cap：合并后裁剪到上限并保留 tail（Req 6.6）", () => {
    const job = makeJob(); // id "job-1"
    const entries = Array.from({ length: 12 }, (_, index) =>
      makeReasoning({
        id: `c${index}`,
        jobId: "job-1",
        iteration: index,
        iterationLabel: `#${index}`,
        thought: `thought-${index}`,
      })
    );

    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: entries,
      maxConsoleLines: 4,
    });

    // console 行裁剪到 4 条
    expect(result.consoleLines).toHaveLength(4);
    // 保留的是输入尾部最后 4 条（c8..c11）
    expect(result.consoleLines.map((line) => line.id)).toEqual([
      "console:reasoning:c8",
      "console:reasoning:c9",
      "console:reasoning:c10",
      "console:reasoning:c11",
    ]);
    // 计数器与裁剪后的 console 行数一致
    expect(result.compatibility.counters.consoleLines).toBe(4);
  });

  it("error phase：reasoning 节点状态 failed，console 行 tone error（Req 4.5 / 6.4）", () => {
    const job = makeJob(); // id "job-1"
    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: [
        makeReasoning({
          id: "err1",
          jobId: "job-1",
          iterationLabel: "#1",
          phase: "error",
          error: "boom",
        }),
      ],
    });

    const reasoningNodes = result.nodes.filter(
      (node) => node.type === "reasoning"
    );
    expect(reasoningNodes).toHaveLength(1);
    expect(reasoningNodes[0]?.status).toBe("failed");

    expect(result.consoleLines).toHaveLength(1);
    expect(result.consoleLines[0]?.id).toBe("console:reasoning:err1");
    expect(result.consoleLines[0]?.tone).toBe("error");
  });
});

describe("deriveBlueprintWallProcessData / user_goal node", () => {
  it("job.request.targetText 生成单一 user_goal 节点（Req 4.7）", () => {
    const targetText = "build a todo app";
    const job = makeJob({
      request: { targetText },
    } as unknown as Partial<BlueprintGenerationJob>);

    const result = deriveBlueprintWallProcessData({ job });

    const userGoalNodes = result.nodes.filter(
      (node) => node.type === "user_goal"
    );
    expect(userGoalNodes).toHaveLength(1);
    expect(userGoalNodes[0]?.id).toBe(`user_goal:${job.id}`);
    expect(userGoalNodes[0]?.body).toContain(targetText);
  });

  it("makeJob()（request:{}）不产出 user_goal 节点", () => {
    const job = makeJob(); // request: {}
    const result = deriveBlueprintWallProcessData({ job });

    const userGoalNodes = result.nodes.filter(
      (node) => node.type === "user_goal"
    );
    expect(userGoalNodes).toHaveLength(0);
  });
});

describe("deriveBlueprintWallProcessData / route and spec nodes", () => {
  it("routeSet 生成 route 节点：主路线 active、其余 queued，并保留 routeSummary（Req 4.6）", () => {
    const job = makeJob();
    const routeSet = {
      id: "rs1",
      requestId: "req1",
      createdAt: "2026-05-31T00:00:00.000Z",
      primaryRouteId: "r1",
      routes: [
        { id: "r1", title: "Primary route", summary: "main path" },
        { id: "r2", title: "Alternate route", summary: "backup path" },
      ],
      nextAsset: null,
      provenance: {},
    } as unknown as BlueprintRouteSet;

    const result = deriveBlueprintWallProcessData({ job, routeSet });

    const routeNodes = result.nodes.filter((node) => node.type === "route");
    expect(routeNodes.map((node) => node.id)).toEqual([
      "route:r1",
      "route:r2",
    ]);

    const primary = routeNodes.find((node) => node.id === "route:r1");
    const alternate = routeNodes.find((node) => node.id === "route:r2");
    expect(primary?.status).toBe("active");
    expect(alternate?.status).toBe("queued");

    expect(result.compatibility.routeSummary.totalRoutes).toBe(2);
    expect(result.compatibility.routeSummary.primaryRouteTitle).toBe(
      "Primary route"
    );
  });

  it("specTree 生成 root + 直接子节点的 spec_node 节点，并保留 specSummary（Req 4.6）", () => {
    const job = makeJob();
    const specTree = {
      id: "st1",
      rootNodeId: "root",
      nodes: [
        { id: "root", title: "Spec Root", summary: "root summary", status: "ready" },
        {
          id: "child",
          parentId: "root",
          title: "Spec Child",
          summary: "child summary",
          status: "accepted",
        },
      ],
    } as unknown as BlueprintSpecTree;

    const result = deriveBlueprintWallProcessData({ job, specTree });

    const specNodes = result.nodes.filter((node) => node.type === "spec_node");
    expect(specNodes.map((node) => node.id)).toEqual(["spec:root", "spec:child"]);

    expect(result.compatibility.specSummary.totalNodes).toBe(2);
    expect(result.compatibility.specSummary.rootTitle).toBe("Spec Root");
  });
});

describe("deriveBlueprintWallProcessData / capability nodes and counts", () => {
  it("capabilityStatuses 生成 capability 节点并正确计数（Req 4.6）", () => {
    const job = makeJob();
    const capabilityStatuses: Record<string, CapabilityStatus> = {
      c1: "invoking",
      c2: "completed",
      c3: "failed",
    };

    const result = deriveBlueprintWallProcessData({ job, capabilityStatuses });

    const capabilityNodes = result.nodes.filter(
      (node) => node.type === "capability"
    );
    // 按 id 升序排序后输出
    expect(capabilityNodes.map((node) => node.id)).toEqual([
      "capability:c1",
      "capability:c2",
      "capability:c3",
    ]);

    expect(result.compatibility.capabilitySummary).toEqual({
      total: 3,
      running: 1,
      completed: 1,
      failed: 1,
    });

    // status 映射：running -> active, completed -> completed, failed -> failed
    const byId = new Map(capabilityNodes.map((node) => [node.id, node]));
    expect(byId.get("capability:c1")?.status).toBe("active");
    expect(byId.get("capability:c2")?.status).toBe("completed");
    expect(byId.get("capability:c3")?.status).toBe("failed");
  });
});

describe("deriveBlueprintWallProcessData / preview summary and node", () => {
  it("stale preview 被 runtimeProjection.jobId 排除（Req 3.2）", () => {
    const job = makeJob(); // id "job-1"
    const stalePreview = {
      id: "p-stale",
      architectureSvgDraft: null,
      runtimeProjection: {
        jobId: "other-job",
        browserPreview: { url: "https://example.com/app", title: "App" },
      },
    } as unknown as BlueprintEffectPreviewSnapshot;

    const result = deriveBlueprintWallProcessData({
      job,
      effectPreviews: [stalePreview],
    });

    expect(result.previewSummary.status).toBe("empty");
    expect(result.emptyReason).toBe("no-blueprint-data");
    expect(result.nodes.some((node) => node.type === "preview")).toBe(false);
  });

  it("当前 job 的 browser preview 生成 browser previewSummary 与 preview 节点（Req 7.1/7.2）", () => {
    const job = makeJob(); // id "job-1"
    const preview = {
      id: "p-current",
      architectureSvgDraft: null,
      runtimeProjection: {
        jobId: "job-1",
        browserPreview: { url: "https://example.com/app", title: "App" },
      },
    } as unknown as BlueprintEffectPreviewSnapshot;

    const result = deriveBlueprintWallProcessData({
      job,
      effectPreviews: [preview],
    });

    expect(result.previewSummary.status).toBe("ready");
    expect(result.previewSummary.kind).toBe("browser");
    const previewNodes = result.nodes.filter((node) => node.type === "preview");
    expect(previewNodes).toHaveLength(1);
    expect(previewNodes[0]?.id).toBe("preview:p-current");
  });

  it("空 browser URL 回退到 architecture preview（Req 7.3）", () => {
    const job = makeJob(); // id "job-1"
    const preview = {
      id: "p-arch",
      architectureSvgDraft: "<svg/>",
      runtimeProjection: {
        jobId: "job-1",
        browserPreview: { url: "", title: "App" },
      },
    } as unknown as BlueprintEffectPreviewSnapshot;

    const result = deriveBlueprintWallProcessData({
      job,
      effectPreviews: [preview],
    });

    expect(result.previewSummary.status).toBe("ready");
    expect(result.previewSummary.kind).toBe("architecture");
    const previewNodes = result.nodes.filter((node) => node.type === "preview");
    expect(previewNodes).toHaveLength(1);
    expect(previewNodes[0]?.id).toBe("preview:p-arch");
  });
});

describe("deriveBlueprintWallProcessData / artifact and final nodes", () => {
  it("artifact 输入生成 artifact 节点并计数（Req 4.8 / 6.2）", () => {
    const job = makeJob();
    const artifacts: BlueprintWallArtifactInput[] = [
      { id: "a1", title: "Report", kind: "document" },
    ];

    const result = deriveBlueprintWallProcessData({ job, artifacts });

    const artifactNodes = result.nodes.filter(
      (node) => node.type === "artifact"
    );
    expect(artifactNodes).toHaveLength(1);
    expect(artifactNodes[0]?.id).toBe("artifact:a1");

    expect(result.metrics.artifacts).toBe(1);
    expect(result.compatibility.counters.artifacts).toBe(1);
  });

  it("terminal artifact 生成 final 节点，非 final artifact 仍是 artifact 节点（Req 4.9）", () => {
    const job = makeJob();
    const artifacts: BlueprintWallArtifactInput[] = [
      { id: "a1", title: "Report", kind: "document" },
      { id: "a2", title: "Handoff", kind: "document", isFinal: true },
    ];

    const result = deriveBlueprintWallProcessData({ job, artifacts });

    const finalNodes = result.nodes.filter((node) => node.type === "final");
    expect(finalNodes).toHaveLength(1);
    expect(finalNodes[0]?.id).toBe("final:a2");

    const artifactNodes = result.nodes.filter(
      (node) => node.type === "artifact"
    );
    expect(artifactNodes.map((node) => node.id)).toEqual(["artifact:a1"]);
    // a2 不应同时作为 artifact 节点出现
    expect(artifactNodes.some((node) => node.id === "artifact:a2")).toBe(false);

    // included artifact 总数（artifact + final）= 2
    expect(result.compatibility.counters.artifacts).toBe(2);
  });
});

describe("deriveBlueprintWallProcessData / graph edges", () => {
  /** 从输出中筛出阶段主干（spine）edges：id 前缀 `edge:stage-order:`。 */
  function getStageOrderEdges(
    result: ReturnType<typeof deriveBlueprintWallProcessData>
  ) {
    return result.edges.filter((edge) =>
      edge.id.startsWith("edge:stage-order:")
    );
  }

  it("阶段主干 edges 覆盖相邻阶段、kind depends_on，且恰好 8 条（Req 5.1-5.4）", () => {
    const job = makeJob();
    const routeSet = {
      id: "rs1",
      requestId: "req1",
      createdAt: "2026-05-31T00:00:00.000Z",
      primaryRouteId: "r1",
      routes: [{ id: "r1", title: "Primary route", summary: "main path" }],
      nextAsset: null,
      provenance: {},
    } as unknown as BlueprintRouteSet;

    const result = deriveBlueprintWallProcessData({ job, routeSet });

    // 每对相邻阶段都存在一条 depends_on 的主干边，方向 prev -> next。
    for (let index = 0; index < BLUEPRINT_SCENE_STAGES.length - 1; index += 1) {
      const prev = BLUEPRINT_SCENE_STAGES[index];
      const next = BLUEPRINT_SCENE_STAGES[index + 1];
      const edge = result.edges.find(
        (e) =>
          e.from === `stage:${prev}` &&
          e.to === `stage:${next}` &&
          e.kind === "depends_on"
      );
      expect(edge).toBeDefined();
      expect(edge?.id).toBe(`edge:stage-order:${prev}->${next}`);
      expect(edge?.priority).toBe("primary");
    }

    // 阶段主干边恰好 BLUEPRINT_SCENE_STAGES.length - 1 = 8 条。
    const stageOrderEdges = getStageOrderEdges(result);
    expect(stageOrderEdges).toHaveLength(BLUEPRINT_SCENE_STAGES.length - 1);
    expect(stageOrderEdges).toHaveLength(8);
  });

  it("no-job 路径无任何 edge（edges === []）", () => {
    const result = deriveBlueprintWallProcessData({ job: null });
    expect(result.edges).toEqual([]);
  });

  it("当前 job 的 preview 节点存在时产出预览生产边 stage:effect_preview -> preview（Req 5.5）", () => {
    const job = makeJob(); // id "job-1"
    const preview = {
      id: "p-current",
      architectureSvgDraft: null,
      runtimeProjection: {
        jobId: "job-1",
        browserPreview: { url: "https://example.com/app", title: "App" },
      },
    } as unknown as BlueprintEffectPreviewSnapshot;

    const result = deriveBlueprintWallProcessData({
      job,
      effectPreviews: [preview],
    });

    const previewNodes = result.nodes.filter((node) => node.type === "preview");
    expect(previewNodes).toHaveLength(1);
    const previewId = previewNodes[0]?.id.slice("preview:".length);

    const produceEdge = result.edges.find(
      (edge) =>
        edge.from === "stage:effect_preview" &&
        edge.to === `preview:${previewId}` &&
        edge.kind === "produces"
    );
    expect(produceEdge).toBeDefined();
    expect(produceEdge?.id).toBe(`edge:preview-stage:${previewId}`);
  });

  it("存在已知终端结果时，final 节点收到来自 artifact 的 answers 边（Req 5.8）", () => {
    const job = makeJob();
    const artifacts: BlueprintWallArtifactInput[] = [
      { id: "a1", title: "Report", kind: "document" },
      { id: "a2", title: "Handoff", kind: "document", isFinal: true },
    ];

    const result = deriveBlueprintWallProcessData({ job, artifacts });

    // a2 是终端 final 节点，a1 是普通 artifact 节点。
    const finalNodes = result.nodes.filter((node) => node.type === "final");
    expect(finalNodes).toHaveLength(1);
    expect(finalNodes[0]?.id).toBe("final:a2");

    const answersEdge = result.edges.find(
      (edge) => edge.from === "artifact:a1" && edge.to === "final:a2"
    );
    expect(answersEdge).toBeDefined();
    expect(answersEdge?.id).toBe("edge:answers-artifact:a1->a2");
    expect(answersEdge?.kind).toBe("answers");
  });

  it("capability owner 不臆造：capability 节点不会连到任何阶段节点（Req 5.6 / 5.7）", () => {
    const job = makeJob();
    const capabilityStatuses: Record<string, CapabilityStatus> = {
      c1: "invoking",
    };

    // 不提供 capabilityOwners：没有可靠的 capability->stage 映射。
    const result = deriveBlueprintWallProcessData({ job, capabilityStatuses });

    // capability 节点确实存在……
    expect(
      result.nodes.some((node) => node.id === "capability:c1")
    ).toBe(true);

    // ……但没有任何边把它连到阶段节点（capability->stage 整体省略）。
    const capabilityStageEdge = result.edges.find(
      (edge) =>
        (edge.from === "capability:c1" && edge.to.startsWith("stage:")) ||
        (edge.to === "capability:c1" && edge.from.startsWith("stage:"))
    );
    expect(capabilityStageEdge).toBeUndefined();

    // 更强：没有任何边引用 capability:c1。
    const anyCapabilityEdge = result.edges.find(
      (edge) => edge.from === "capability:c1" || edge.to === "capability:c1"
    );
    expect(anyCapabilityEdge).toBeUndefined();
  });

  it("不确定关系被省略：无已知 stage 的 reasoning 不连边，有已知 stage 的才连边（Req 5.5 / 5.7）", () => {
    const job = makeJob(); // id "job-1"

    // 无 stageId 的 reasoning：不应臆测其阶段，无 stage->reasoning 边。
    const withoutStage = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: [
        makeReasoning({ id: "noStage", jobId: "job-1", iterationLabel: "#1" }),
      ],
    });

    expect(
      withoutStage.nodes.some((node) => node.id === "reasoning:noStage")
    ).toBe(true);
    const orphanEdge = withoutStage.edges.find(
      (edge) => edge.id === "edge:reasoning-stage:reasoning:noStage"
    );
    expect(orphanEdge).toBeUndefined();
    expect(
      withoutStage.edges.some((edge) => edge.to === "reasoning:noStage")
    ).toBe(false);

    // 带已知 stageId 的 reasoning：连一条 stage -> reasoning 的 supports 边。
    const withStage = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: [
        makeReasoning({
          id: "spec1",
          jobId: "job-1",
          iterationLabel: "#1",
          stageId: "spec_tree",
        }),
      ],
    });

    const stageReasoningEdge = withStage.edges.find(
      (edge) =>
        edge.from === "stage:spec_tree" && edge.to === "reasoning:spec1"
    );
    expect(stageReasoningEdge).toBeDefined();
    expect(stageReasoningEdge?.id).toBe(
      "edge:reasoning-stage:reasoning:spec1"
    );
    expect(stageReasoningEdge?.kind).toBe("supports");
  });

  it("second-stage brainstorm activity fans out from spec tree and converges into spec docs", () => {
    const job = makeJob({ stage: "spec_docs" });
    const result = deriveBlueprintWallProcessData({
      job,
      rolePhases: {
        "route-planner": "thinking",
        "repository-analyst": "thinking",
        "spec-author": "acting",
        "runtime-quality-auditor": "reviewing",
      },
      agentReasoningEntries: [
        makeReasoning({
          id: "brainstorm-seed",
          jobId: "job-1",
          stageId: "spec_tree",
        }),
      ],
    });

    const brainstormNodes = result.nodes.filter(
      (node) => node.type === "brainstorm"
    );
    expect(brainstormNodes.map((node) => node.id)).toEqual([
      "brainstorm:route-planner",
      "brainstorm:repository-analyst",
      "brainstorm:spec-author",
      "brainstorm:runtime-quality-auditor",
    ]);
    expect(new Set(brainstormNodes.map((node) => node.row)).size).toBe(4);
    expect(
      result.edges.filter((edge) =>
        edge.id.startsWith("edge:brainstorm-fanout:")
      )
    ).toHaveLength(4);
    expect(
      result.edges.filter((edge) =>
        edge.id.startsWith("edge:brainstorm-converge:")
      )
    ).toHaveLength(4);
    expect(
      result.edges.some(
        (edge) =>
          edge.from === "stage:spec_tree" &&
          edge.to === "brainstorm:route-planner" &&
          edge.kind === "supports"
      )
    ).toBe(true);
    expect(
      result.edges.some(
        (edge) =>
          edge.from === "brainstorm:spec-author" &&
          edge.to === "stage:spec_docs" &&
          edge.kind === "refines"
      )
    ).toBe(true);
  });

  it("uses runtime role ids for brainstorm branches instead of a fixed role list", () => {
    const job = makeJob({ stage: "spec_docs" });
    const result = deriveBlueprintWallProcessData({
      job,
      rolePhases: {
        "llm-market-scout": "thinking",
        "repo-risk-cartographer": "acting",
        "prompt-contract-negotiator": "reviewing",
      },
      agentReasoningEntries: [
        makeReasoning({
          id: "dynamic-brainstorm-seed",
          jobId: "job-1",
          stageId: "spec_tree",
        }),
      ],
    });

    expect(
      result.nodes
        .filter((node) => node.type === "brainstorm")
        .map((node) => node.id)
    ).toEqual([
      "brainstorm:llm-market-scout",
      "brainstorm:repo-risk-cartographer",
      "brainstorm:prompt-contract-negotiator",
    ]);
  });

  it("keeps spec-doc brainstorm branches visible from current-job reasoning history", () => {
    const job = makeJob({ stage: "runtime_capability" });
    const result = deriveBlueprintWallProcessData({
      job,
      rolePhases: {
        "role-runtime-executor": "acting",
      },
      agentReasoningEntries: [
        makeReasoning({
          id: "spec-planner",
          jobId: "job-1",
          roleId: "role-architecture-planner",
          stageId: "spec_docs",
        }),
        makeReasoning({
          id: "spec-auditor",
          jobId: "job-1",
          roleId: "role-quality-auditor",
          stageId: "spec_docs",
        }),
        makeReasoning({
          id: "spec-presenter",
          jobId: "job-1",
          roleId: "role-experience-presenter",
          stageId: "spec_docs",
        }),
      ],
    });

    expect(
      result.nodes
        .filter((node) => node.type === "brainstorm")
        .map((node) => node.id)
    ).toEqual([
      "brainstorm:role-runtime-executor",
      "brainstorm:role-architecture-planner",
      "brainstorm:role-quality-auditor",
      "brainstorm:role-experience-presenter",
    ]);
  });
});

describe("deriveBlueprintWallProcessData / metrics and minimap", () => {
  /** 构造一个最小可用的 BlueprintRouteSet mock。 */
  function makeRouteSet(
    routes: Array<{ id: string; title: string; summary?: string }>,
    primaryRouteId?: string
  ): BlueprintRouteSet {
    return {
      id: "rs1",
      requestId: "req1",
      createdAt: "2026-05-31T00:00:00.000Z",
      primaryRouteId: primaryRouteId ?? routes[0]?.id ?? null,
      routes,
      nextAsset: null,
      provenance: {},
    } as unknown as BlueprintRouteSet;
  }

  /** 构造一个最小可用的 BlueprintSpecTree mock。 */
  function makeSpecTree(
    nodes: Array<{
      id: string;
      parentId?: string;
      title: string;
      summary?: string;
      status?: string;
    }>,
    rootNodeId = "root"
  ): BlueprintSpecTree {
    return {
      id: "st1",
      rootNodeId,
      nodes,
    } as unknown as BlueprintSpecTree;
  }

  it("capability 计数正确，且 metrics.capabilities 与 compatibility.capabilitySummary 同源一致（Req 6.1 / 8.2）", () => {
    const job = makeJob();
    const capabilityStatuses: Record<string, CapabilityStatus> = {
      c1: "invoking",
      c2: "completed",
      c3: "failed",
      // available 仅计入 total，不计入 running / completed / failed
      c4: "idle",
    };

    const result = deriveBlueprintWallProcessData({ job, capabilityStatuses });

    expect(result.metrics.capabilities).toEqual({
      total: 4,
      running: 1,
      completed: 1,
      failed: 1,
    });

    // metrics.capabilities 与 compatibility.capabilitySummary 来自同一份 capabilityStatuses
    expect(result.metrics.capabilities).toEqual(
      result.compatibility.capabilitySummary
    );
  });

  it("activeRoles 只统计 phase === \"active\" 的角色（Req 6.2）", () => {
    const job = makeJob();
    const rolePhases: Record<string, RolePhase> = {
      r1: "thinking",
      r2: "sleeping",
      r3: "acting",
    };

    // 提供 capabilityStatuses 命中 has-data 路径，确保 rolePhases 被消费
    const result = deriveBlueprintWallProcessData({
      job,
      rolePhases,
      capabilityStatuses: { c1: "invoking" },
    });

    expect(result.metrics.activeRoles).toBe(2);
  });

  it("缺失的 token / time 指标不臆造，保持 null（Req 6.3）", () => {
    const job = makeJob();
    const result = deriveBlueprintWallProcessData({
      job,
      capabilityStatuses: { c1: "invoking" },
    });

    expect(result.metrics.tokenBurn).toBeNull();
    expect(result.metrics.sourceCount).toBeNull();
    expect(result.metrics.remainingPoints).toBeNull();
    expect(result.metrics.elapsedMs).toBeNull();
  });

  it("minimap 节点镜像图节点的 id / column / row / status，viewport 反映真实 bounds（Req 7.5 / 7.6 / 7.7）", () => {
    const job = makeJob();
    const routeSet = makeRouteSet([
      { id: "r1", title: "Primary route", summary: "main path" },
      { id: "r2", title: "Alternate route", summary: "backup path" },
    ]);
    const capabilityStatuses: Record<string, CapabilityStatus> = {
      c1: "invoking",
      c2: "completed",
    };

    const result = deriveBlueprintWallProcessData({
      job,
      routeSet,
      capabilityStatuses,
    });

    // 数量一致：minimap 节点逐一镜像图节点
    expect(result.minimap.nodes).toHaveLength(result.nodes.length);

    // 每个 minimap 节点与同 id 的图节点的 column / row / status 一致
    const graphById = new Map(result.nodes.map((node) => [node.id, node]));
    for (const miniNode of result.minimap.nodes) {
      const graphNode = graphById.get(miniNode.id);
      expect(graphNode).toBeDefined();
      expect(miniNode.column).toBe(graphNode?.column);
      expect(miniNode.row).toBe(graphNode?.row);
      expect(miniNode.status).toBe(graphNode?.status);
    }

    // viewport 由真实 min/max column / row 精确推导
    const columns = result.nodes.map((node) => node.column);
    const rows = result.nodes.map((node) => node.row);
    expect(result.minimap.viewport).toEqual({
      columnStart: Math.min(...columns),
      columnEnd: Math.max(...columns),
      rowStart: Math.min(...rows),
      rowEnd: Math.max(...rows),
    });
  });

  it("无图节点时 minimap 为空且 viewport 回落到稳定默认窗口（Req 7.7）", () => {
    const result = deriveBlueprintWallProcessData({ job: null });

    expect(result.minimap.nodes).toEqual([]);
    expect(result.minimap.viewport).toEqual({
      columnStart: 0,
      columnEnd: 4,
      rowStart: 0,
      rowEnd: 0,
    });
  });

  it("compatibility 摘要与节点级数据同源于当前 job（Req 8.1 / 8.2）", () => {
    const job = makeJob();
    const routeSet = makeRouteSet([
      { id: "r1", title: "Primary route", summary: "main path" },
      { id: "r2", title: "Alternate route", summary: "backup path" },
    ]);
    const specTree = makeSpecTree([
      { id: "root", title: "Spec Root", summary: "root summary", status: "ready" },
      {
        id: "child",
        parentId: "root",
        title: "Spec Child",
        summary: "child summary",
        status: "accepted",
      },
    ]);
    const capabilityStatuses: Record<string, CapabilityStatus> = {
      c1: "invoking",
      c2: "completed",
      c3: "failed",
    };

    const result = deriveBlueprintWallProcessData({
      job,
      routeSet,
      specTree,
      capabilityStatuses,
    });

    // routeSummary.totalRoutes 与 routeSet.routes 数量一致
    expect(result.compatibility.routeSummary.totalRoutes).toBe(
      routeSet.routes.length
    );
    // specSummary.totalNodes 与 specTree.nodes 数量一致
    expect(result.compatibility.specSummary.totalNodes).toBe(
      specTree.nodes.length
    );
    // capabilitySummary 与 capabilityStatuses 计数一致
    expect(result.compatibility.capabilitySummary).toEqual({
      total: 3,
      running: 1,
      completed: 1,
      failed: 1,
    });
  });

  it("默认 maxReasoningNodes 为 12：未指定时 reasoning 节点裁剪到 12（Req 8.4）", () => {
    const job = makeJob(); // id "job-1"
    const entries = Array.from({ length: 15 }, (_, index) =>
      makeReasoning({
        id: `r${index}`,
        jobId: "job-1",
        iteration: index,
        iterationLabel: `#${index}`,
      })
    );

    // 不传 maxReasoningNodes，验证默认上限
    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: entries,
    });

    const reasoningNodes = result.nodes.filter(
      (node) => node.type === "reasoning"
    );
    expect(reasoningNodes).toHaveLength(12);
    // 计数器仍反映全量过滤数（15）
    expect(result.compatibility.counters.reasoningEntries).toBe(15);
  });

  it("默认 maxConsoleLines 为 8：未指定时 console 行裁剪到 8（Req 8.5）", () => {
    const job = makeJob(); // id "job-1"
    const entries = Array.from({ length: 12 }, (_, index) =>
      makeReasoning({
        id: `c${index}`,
        jobId: "job-1",
        iteration: index,
        iterationLabel: `#${index}`,
        thought: `thought-${index}`,
      })
    );

    // 不传 maxConsoleLines，验证默认上限
    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: entries,
    });

    expect(result.consoleLines).toHaveLength(8);
    expect(result.compatibility.counters.consoleLines).toBe(8);
  });
});

describe("deriveBlueprintWallProcessData / stale-only isolation", () => {
  it("stale-only reasoning does not make the graph look populated", () => {
    const job = makeJob(); // id "job-1"
    const result = deriveBlueprintWallProcessData({
      job,
      agentReasoningEntries: [
        makeReasoning({ id: "stale-r1", jobId: "job-2" }),
      ],
    });

    expect(result.emptyReason).toBe("no-blueprint-data");
    expect(result.nodes.some((node) => node.type === "reasoning")).toBe(false);
    expect(result.consoleLines).toEqual([]);
    expect(result.compatibility.counters.reasoningEntries).toBe(0);
  });

  it("stale-only artifact does not make the graph look populated", () => {
    const job = makeJob(); // id "job-1"
    const result = deriveBlueprintWallProcessData({
      job,
      artifacts: [
        {
          id: "stale-artifact",
          title: "Old artifact",
          kind: "document",
          jobId: "job-2",
        },
      ],
    });

    expect(result.emptyReason).toBe("no-blueprint-data");
    expect(result.nodes.some((node) => node.type === "artifact")).toBe(false);
    expect(result.compatibility.counters.artifacts).toBe(0);
    expect(result.metrics.artifacts).toBe(0);
  });
});

describe("deriveBlueprintWallProcessData / realtime store slice shapes", () => {
  it("uses capabilityOwners keyed by capabilityId with the real owner roleId", () => {
    const job = makeJob();
    const result = deriveBlueprintWallProcessData({
      job,
      capabilityStatuses: { "aigc-spec-node": "invoking" },
      capabilityOwners: {
        "aigc-spec-node": {
          roleId: "spec-architect",
          invocationId: "inv-1",
          updatedAt: 1,
        },
      },
    });

    const node = result.nodes.find(
      (candidate) => candidate.id === "capability:aigc-spec-node"
    );

    expect(node?.status).toBe("active");
    expect(node?.body).toBe("spec-architect");
  });

  it("counts realtime role phase strings without requiring role objects", () => {
    const job = makeJob();
    const result = deriveBlueprintWallProcessData({
      job,
      capabilityStatuses: { c1: "idle" },
      rolePhases: {
        r1: "activated",
        r2: "thinking",
        r3: "sleeping",
        r4: "completed",
        r5: "failed",
        r6: "acting",
      },
    });

    expect(result.metrics.activeRoles).toBe(3);
  });
});

describe("deriveBlueprintWallProcessData / data-only boundary guard", () => {
  // 源码级护栏：直接读取新模块的源文件文本，断言它没有引入任何被禁止的依赖。
  // 这条护栏锁定「纯数据层」边界：模块必须保持无 React、无 store、无可视化组件、
  // 无图布局引擎，只依赖共享契约类型、`@/lib` 与同目录的 stage-signal helper。
  // 对应 Req 1.2（无 React / store / 网络 / 副作用）、Req 3.5（不读 useSandboxStore）、
  // Req 9.1-9.7（不渲染墙面、不改 SandboxMonitor / MissionWallTaskPanel / Scene3D、
  // 不引入 React Flow / dagre / elkjs）。

  // 从测试文件位置解析出被测模块的源文件路径：__tests__ 目录的上一级即模块所在目录。
  const moduleSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../blueprint-wall-process-data.ts"
    ),
    "utf8"
  );

  // 仅抽取 import 语句相关的行做精确检查，避免对正文 / 注释里出现的同名词产生误报。
  // 收集两类行：以 `import` 开头的行，以及包含 `from "..."` / `from '...'` 的行
  // （覆盖多行 import 的 `} from "..."` 收尾行）。
  const importLines = moduleSource
    .split("\n")
    .filter(
      (line) =>
        line.trim().startsWith("import") || /\bfrom\s+["']/.test(line)
    );
  const importsText = importLines.join("\n");

  it("不从 \"react\" 引入任何东西（Req 1.2 / 9.1）", () => {
    // 精确匹配 `from "react"` / `from 'react'`，避免对 `react-...` 子串误报。
    expect(/from\s+["']react["']/.test(importsText)).toBe(false);
  });

  it("整个模块源码不出现 useSandboxStore 标识符（Req 3.5）", () => {
    // useSandboxStore 既不应被 import，也不应在正文任何位置出现——sandbox 日志不得
    // 成为墙面流程图数据的来源（避免跨 job 残留）。
    expect(moduleSource.includes("useSandboxStore")).toBe(false);
  });

  it("不引入可视化组件 SandboxMonitor / MissionWallTaskPanel / Scene3D（Req 9.2 / 9.3 / 9.4）", () => {
    // 这些是可见 3D UI 组件，纯数据层不应依赖它们。检查 import 语句行即可
    // （`scene-fusion` 目录名含 "scene" 但不含 "Scene3D"，故精确标识符匹配安全）。
    expect(importsText.includes("SandboxMonitor")).toBe(false);
    expect(importsText.includes("MissionWallTaskPanel")).toBe(false);
    expect(importsText.includes("Scene3D")).toBe(false);
  });

  it("不引入 React Flow / dagre / elkjs 等图布局引擎（Req 9.5）", () => {
    // 布局只产出确定性的 column / row，不依赖任何通用 DAG 布局引擎。
    expect(/reactflow|react-flow|@xyflow\/react/.test(importsText)).toBe(false);
    expect(/from\s+["']dagre["']/.test(importsText)).toBe(false);
    expect(/from\s+["']elkjs?/.test(importsText)).toBe(false);
  });
});
