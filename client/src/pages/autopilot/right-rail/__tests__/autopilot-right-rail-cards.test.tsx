/**
 * Autopilot 驾驶舱右栏 — 阶段独占视口布局单元测试
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 *
 * 覆盖 4 个 case:
 * - case 1: activeSubStage="spec_tree" + 数据就绪,断言 StageViewport 渲染 spec_tree 阶段
 * - case 2: activeSubStage="spec_tree" + specTree=null,断言活跃阶段展示等待状态
 * - case 3: activeSubStage="agent_crew_fabric",断言仅渲染当前阶段 placeholder
 * - case 4: StageViewport 结构正确（header + content + cta）
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";

import { AutopilotRightRail } from "../AutopilotRightRail";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
} from "../types";

function makeProps(
  overrides: Partial<AutopilotRightRailProps> = {},
): AutopilotRightRailProps {
  return {
    jobId: "job-test",
    currentStage: "fabric",
    job: { id: "job-test", stage: "spec_tree" } as unknown as BlueprintGenerationJob,
    routeSet: null,
    selection: null,
    specTree: null,
    agentCrew: null,
    capabilities: [],
    capabilityInvocations: [],
    capabilityEvidence: [],
    effectPreviews: [],
    locale: "zh-CN",
    onSubStageChange: () => {},
    ...overrides,
  };
}

const EMPTY_SPEC_TREE = {
  id: "spec-tree-test",
  nodes: [],
  documents: [],
} as unknown as BlueprintSpecTree;

const EMPTY_AGENT_CREW = {
  roleTimelines: [],
} as unknown as BlueprintAgentCrewSnapshot;

describe("AutopilotRightRail streaming timeline", () => {
  it("case 1: renders completed + active timeline nodes when activeSubStage=spec_tree and data is ready", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // StageViewport 渲染 spec_tree 阶段
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 活跃阶段有 data-timeline-status="active" 标记
    expect(markup).toContain('data-timeline-status="active"');
    // 活跃节点有 aria-current="step"
    expect(markup).toContain('aria-current="step"');
    // 活跃节点有 sub-stage placeholder
    expect(markup).toContain('data-sub-stage-placeholder="spec_tree"');
  });

  it("renders <StreamingDocRenderer /> in the spec_documents StageContent when job.stage === 'spec_docs' (autopilot-streaming-doc-renderer Task 6.1)", () => {
    // autopilot-streaming-doc-renderer 任务 6.1（2026-05-18）：
    // 当 `job.stage === "spec_docs"` 时，AutopilotRightRail 把 activeStageKey
    // 锁定到 `"spec_documents"`，StageContent 由 `<StreamingDocRenderer>` 接管，
    // 替代旧 autopilot-spec-tree-workbench (2026-05-17) 在该阶段渲染的
    // SpecTreeWorkbench accordion 折叠面板。
    const specTree = {
      id: "spec-tree-test",
      version: 1,
      nodes: [
        {
          id: "node-root",
          title: "Root SPEC",
          type: "root",
          children: ["node-docs"],
        },
        {
          id: "node-docs",
          parentId: "node-root",
          title: "Document node",
          type: "spec_document",
          children: [],
        },
      ],
    } as unknown as BlueprintSpecTree;
    const job = {
      id: "job-test",
      stage: "spec_docs",
      status: "reviewing",
      artifacts: [
        {
          type: "requirements",
          payload: {
            id: "doc-req",
            nodeId: "node-root",
            type: "requirements",
            title: "Requirements",
          },
        },
        {
          type: "design",
          payload: {
            id: "doc-design",
            nodeId: "node-root",
            type: "design",
            title: "Design",
          },
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          job,
          specTree,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // 锁定 activeStageKey === "spec_documents" 分支
    expect(markup).toContain('data-stage-key="spec_documents"');
    // StreamingDocRenderer 占据 StageContent 主区域
    expect(markup).toContain('data-testid="streaming-doc-renderer"');
    // 重构后侧边栏分组按 nodeId 渲染（替代旧的 DocTabBar 横向 tab），
    // 每份 SpecDocument 在分组展开后通过 streaming-doc-sidebar-doc-* 暴露
    expect(markup).toContain(
      'data-testid="streaming-doc-sidebar-group-node-root"'
    );
    expect(markup).toContain('data-testid="streaming-doc-sidebar-doc-doc-req"');
    expect(markup).toContain(
      'data-testid="streaming-doc-sidebar-doc-doc-design"'
    );
    // 不再走 SpecTreeWorkbench 分支
    expect(markup).not.toContain('data-testid="spec-tree-workbench"');
  });

  it("case 2: renders awaiting state when specTree is null", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: null,
        })}
        locale="en-US"
      />,
    );

    // StageViewport 渲染 spec_tree 阶段
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 活跃阶段有 data-timeline-status="active" 标记
    expect(markup).toContain('data-timeline-status="active"');
    // 等待上游数据提示
    expect(markup).toContain("Awaiting upstream data");
    // sub-stage placeholder 保留
    expect(markup).toContain('data-sub-stage-placeholder="spec_tree"');
  });

  it("case 3: future sub-stages do not get placeholder attributes when activeSubStage=agent_crew_fabric", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          job: { id: "job-test", stage: "agent_crew_fabric" } as unknown as BlueprintGenerationJob,
          currentSubStage: "agent_crew_fabric",
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // 起点子阶段作为 active
    expect(markup).toContain('data-sub-stage-placeholder="agent_crew_fabric"');

    // 未来 7 个子阶段不应有 placeholder 属性(只有 active 才有)
    const futureSubStages = RAIL_SUB_STAGE_ORDER.slice(1) as readonly AutopilotRailSubStage[];
    for (const sub of futureSubStages) {
      expect(markup).not.toContain(`data-sub-stage-placeholder="${sub}"`);
    }
  });

  it("case 4: timeline nodes have correct structure with testid and index", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // StageViewport 容器存在
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 有 stage-index 属性
    expect(markup).toContain('data-stage-index="3"');
    // StageHeader 存在
    expect(markup).toContain("STEP 04");
    expect(markup).toContain("SPEC TREE");
    // 2026-05-19：StageCTA 已被移除（CTA 由 SpecTreeWorkbench 顶部双按钮承担）。
    // 改为断言 StageHeader 内的 STEP 编号 + 中文标题仍存在。
    expect(markup).toContain("STEP 04");
  });
});
