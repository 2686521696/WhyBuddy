/**
 * Autopilot 驾驶舱右栏 — 流式时间线布局单元测试
 *
 * 对应 spec：`.kiro/specs/autopilot-fabric-streaming-timeline/`
 *
 * 覆盖 4 个 case:
 * - case 1: activeSubStage="spec_tree" + 数据就绪,断言 completed + active 节点共存
 * - case 2: activeSubStage="spec_tree" + specTree=null,断言活跃节点展示等待状态
 * - case 3: activeSubStage="agent_crew_fabric",断言未来子阶段不渲染 placeholder
 * - case 4: 时间线节点结构正确
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

    // agent_crew_fabric 作为已完成节点
    expect(markup).toContain('data-timeline-status="completed"');
    // spec_tree 作为活跃节点
    expect(markup).toContain('data-timeline-status="active"');
    // 活跃节点有 aria-current="step"
    expect(markup).toContain('aria-current="step"');
    // 活跃节点有 sub-stage placeholder
    expect(markup).toContain('data-sub-stage-placeholder="spec_tree"');
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

    // 活跃节点存在
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

    // 时间线节点存在
    expect(markup).toContain('data-testid="timeline-node"');
    // 有 index 属性
    expect(markup).toContain('data-timeline-index="0"');
    expect(markup).toContain('data-timeline-index="1"');
    // 有 future 状态节点
    expect(markup).toContain('data-timeline-status="future"');
  });
});
