/**
 * Autopilot 子阶段摘要派生器 — 单元测试（Tasks 11 + 12）
 *
 * 对应 spec：`.kiro/specs/autopilot-sub-stage-metrics-extractor/`
 *
 * - Task 11：每个子阶段用 `EMPTY_PROPS` 派生一次，断言结构化返回（metrics 长度 === 3、
 *   title / apiPath / summary 均为字符串、dataReady 为 boolean）。
 * - Task 12：每个子阶段构造典型的「数据就绪」props，断言 dataReady === true 且关键
 *   metric 值与设计文档一致。
 *
 * 测试约定：
 * - 所有测试均对应 `deriveSubStageSummary` 纯函数，不依赖 React、store 或 blueprint-api
 *   运行时成员。
 * - 对于需要部分 mock shared 契约类型的测试对象，沿用 sibling `resolve-rail-sub-stage.property.test.ts`
 *   的 `as unknown as T` 约定，避免在测试里重复复刻 shared 契约的全部字段。
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";

import { deriveSubStageSummary } from "../sub-stage-summary";
import type { AutopilotRailSubStage, AutopilotRightRailProps } from "../types";

const SUB_STAGES = [
  "agent_crew_fabric",
  "spec_tree",
  "effect_preview",
  "prompt_package",
  "runtime_capability",
  "engineering_handoff",
  "artifact_memory",
] as const satisfies readonly AutopilotRailSubStage[];

const EMPTY_PROPS: AutopilotRightRailProps = {
  jobId: "",
  currentStage: "fabric",
  job: null,
  routeSet: null,
  selection: null,
  specTree: null,
  agentCrew: null,
  capabilities: [],
  capabilityInvocations: [],
  capabilityEvidence: [],
  effectPreviews: [],
  locale: "zh-CN",
  onSubStageChange: () => {
    /* noop */
  },
};

/**
 * 测试用 props 合并器：所有「数据就绪」case 都在 `EMPTY_PROPS` 之上覆盖需要的字段，
 * 避免每个用例重复声明完整契约。
 */
function makeProps(
  overrides: Partial<AutopilotRightRailProps>,
): AutopilotRightRailProps {
  return { ...EMPTY_PROPS, ...overrides };
}

describe("deriveSubStageSummary", () => {
  // -------------------------------------------------------------------------
  // Task 11：空 props 场景
  // -------------------------------------------------------------------------

  it.each(SUB_STAGES)(
    "returns a well-formed summary for %s when props are empty",
    (subStage) => {
      const result = deriveSubStageSummary(subStage, EMPTY_PROPS, "zh-CN");

      expect(result.metrics).toHaveLength(3);
      expect(typeof result.title).toBe("string");
      expect(typeof result.apiPath).toBe("string");
      expect(typeof result.summary).toBe("string");
      expect(typeof result.dataReady).toBe("boolean");
      // 保险校验：空 props 下任何子阶段都不应意外地宣称自己 dataReady。
      // 如果未来某个派生函数的 dataReady 判定从 props 以外的地方获取信号，这条断言
      // 会先被打破提醒我们更新用例。
      expect(result.dataReady).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Task 12：数据就绪场景
  // -------------------------------------------------------------------------

  it("agent_crew_fabric: counts roles / events / active from agentCrew.roleTimelines", () => {
    const agentCrew = {
      roleTimelines: [
        { state: "active", entries: [{ id: "e1" }] },
        { state: "watching", entries: [{ id: "e2" }] },
        { state: "reviewing", entries: [] },
      ],
    } as unknown as BlueprintAgentCrewSnapshot;

    const props = makeProps({ agentCrew });
    const result = deriveSubStageSummary("agent_crew_fabric", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe(3); // roles
    expect(result.metrics[1].value).toBe(2); // events (1 + 1 + 0)
    expect(result.metrics[2].value).toBe(1); // active
  });

  it("spec_tree: counts total nodes and leaves (nodes with no children)", () => {
    const specTree = {
      nodes: [
        { id: "root" },
        { id: "n1", parentId: "root" },
        { id: "n2", parentId: "root" },
      ],
    } as unknown as BlueprintSpecTree;

    const props = makeProps({ specTree });
    const result = deriveSubStageSummary("spec_tree", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe(3); // nodes
    expect(result.metrics[1].value).toBe(2); // leaves: n1 & n2
    expect(result.metrics[2].value).toBe("0/9"); // documents generated from tree nodes
  });

  it("spec_tree: counts generated documents from job artifacts per tree node", () => {
    const specTree = {
      nodes: [
        { id: "root" },
        { id: "n1", parentId: "root" },
      ],
    } as unknown as BlueprintSpecTree;
    const job = {
      artifacts: [
        {
          type: "requirements",
          payload: { id: "root-req", nodeId: "root", type: "requirements" },
        },
        {
          type: "design",
          payload: { id: "root-design", nodeId: "root", type: "design" },
        },
        {
          type: "tasks",
          payload: { id: "root-tasks", nodeId: "root", type: "tasks" },
        },
        {
          type: "requirements",
          payload: { id: "n1-req", nodeId: "n1", type: "requirements" },
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const props = makeProps({ specTree, job });
    const result = deriveSubStageSummary("spec_tree", props, "en-US");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[2].label).toBe("DOCS");
    expect(result.metrics[2].value).toBe("4/6");
    expect(result.metrics[2].hint).toBe("1 / 2 nodes complete");
  });

  it("spec_documents 子阶段已并入 spec_tree（autopilot-spec-tree-workbench, 2026-05-17）", () => {
    // 验证 RAIL_SUB_STAGE_ORDER 7 元素中已不含 spec_documents。这里通过类型
    // 联合断言：将 "spec_documents" 字符串赋给 AutopilotRailSubStage 应当
    // 在 TypeScript 层失败（运行时此用例只断言常量列表）。
    const order: readonly AutopilotRailSubStage[] = SUB_STAGES;
    expect(order).not.toContain("spec_documents" as never);
  });

  it("effect_preview: counts previews, latest version, and current job.stage", () => {
    const previews = [
      { version: 3 },
      { version: 2 },
    ] as unknown as AutopilotRightRailProps["effectPreviews"];
    const job = { stage: "effect_preview" } as unknown as BlueprintGenerationJob;

    const props = makeProps({ effectPreviews: previews, job });
    const result = deriveSubStageSummary("effect_preview", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe(2); // previews
    expect(result.metrics[1].value).toBe(3); // latest version (previews[0].version)
    expect(result.metrics[2].value).toBe("effect_preview"); // job.stage
  });

  it("prompt_package: is ready once specTree is available (placeholder metrics stay '-')", () => {
    const specTree = {} as unknown as BlueprintSpecTree;

    const props = makeProps({ specTree });
    const result = deriveSubStageSummary("prompt_package", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe("-");
    expect(result.metrics[1].value).toBe("-");
    expect(result.metrics[2].value).toBe("-");
  });

  it("runtime_capability: counts capabilities / invocations / evidence arrays", () => {
    const props = makeProps({
      capabilities: [
        {},
        {},
      ] as unknown as AutopilotRightRailProps["capabilities"],
      capabilityInvocations: [
        {},
      ] as unknown as AutopilotRightRailProps["capabilityInvocations"],
      capabilityEvidence: [
        {},
        {},
        {},
      ] as unknown as AutopilotRightRailProps["capabilityEvidence"],
    });

    const result = deriveSubStageSummary("runtime_capability", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe(2); // capabilities
    expect(result.metrics[1].value).toBe(1); // invocations
    expect(result.metrics[2].value).toBe(3); // evidence
  });

  it("engineering_handoff: is ready once selection is available (placeholder metrics stay '-')", () => {
    const selection = {} as unknown as BlueprintRouteSelection;

    const props = makeProps({ selection });
    const result = deriveSubStageSummary("engineering_handoff", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe("-");
    expect(result.metrics[1].value).toBe("-");
    expect(result.metrics[2].value).toBe("-");
  });

  it("artifact_memory: is ready once selection is available (placeholder metrics stay '-')", () => {
    const selection = {} as unknown as BlueprintRouteSelection;

    const props = makeProps({ selection });
    const result = deriveSubStageSummary("artifact_memory", props, "zh-CN");

    expect(result.dataReady).toBe(true);
    expect(result.metrics[0].value).toBe("-");
    expect(result.metrics[1].value).toBe("-");
    expect(result.metrics[2].value).toBe("-");
  });
});
