/**
 * Autopilot 驾驶舱右栏收敛 — Spec 3 Task 6 / P1 fabric dispatch consistency PBT
 *
 * 对应 spec：`.kiro/specs/autopilot-advanced-workbench-inline/`
 * - Requirement 10.1（fabric 分支 dispatch 与 resolveRailSubStage 一致）
 * - Requirement 10.4 / 10.5（PBT 覆盖与最小 numRuns 预算）
 *
 * 属性语义：
 *   对任意合法 `(job, selection, specTree, agentCrew)` 快照，当 `<AutopilotRightRail>` 以
 *   `currentStage === "fabric"` 与该快照推导出的 `currentSubStage` 渲染时，组件根节点必须带上
 *   `data-autopilot-stage="fabric"`，且根节点的 `data-autopilot-sub-stage` 必须与
 *   `resolveRailSubStage({ currentStage: "fabric", job, selection, specTree, agentCrew })` 的
 *   返回值字符串严格一致。
 *
 * 为什么这是 PBT 而不是单测：
 *   - resolver 分支取决于 `job.stage`、`selection`、`specTree`、`agentCrew` 的多维组合；
 *   - 通过 fast-check 生成至少 50 组快照，可在一次运行内覆盖 `RAIL_SUB_STAGE_ORDER` 的全部 8 个
 *     分支以及非-fabric（不应触达此分支）的输入；
 *   - 任何未来对 `<AutopilotRightRail>` fabric switch 的改动，如果让派发偏离 resolver 结果，
 *     此 PBT 会立刻以反例形式暴露。
 */

import * as fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintRouteSelection,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";

import { AutopilotRightRail } from "../AutopilotRightRail";
import { resolveRailSubStage } from "../resolve-rail-sub-stage";
import { RAIL_SUB_STAGE_ORDER, type AutopilotRailSubStage } from "../types";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * 与 Spec 1 `resolve-rail-sub-stage.property.test.ts` 保持相同的 13 个 stage 过渡值，
 * 覆盖 resolver switch 的所有分支（含 spec 层过渡态 `route_selection` / `agent_crew_fabric`）。
 */
const arbJobStage: fc.Arbitrary<BlueprintGenerationStage> = fc.constantFrom(
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "agent_crew_fabric",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing"
) as fc.Arbitrary<BlueprintGenerationStage>;

const arbJobOrNull: fc.Arbitrary<BlueprintGenerationJob | null> = fc.oneof(
  fc.constant(null),
  fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 12 }),
      stage: arbJobStage,
    })
    .map(shape => shape as unknown as BlueprintGenerationJob)
);

const arbSelectionOrNull: fc.Arbitrary<BlueprintRouteSelection | null> =
  fc.oneof(
    fc.constant(null),
    fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 12 }),
        routeTitle: fc.string({ minLength: 0, maxLength: 24 }),
      })
      .map(shape => shape as unknown as BlueprintRouteSelection)
  );

const arbSpecTreeOrNull: fc.Arbitrary<BlueprintSpecTree | null> = fc.oneof(
  fc.constant(null),
  fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 12 }),
      nodes: fc.constant([]),
      documents: fc.constant([]),
    })
    .map(shape => shape as unknown as BlueprintSpecTree)
);

const arbAgentCrewOrNull: fc.Arbitrary<BlueprintAgentCrewSnapshot | null> =
  fc.oneof(
    fc.constant(null),
    fc
      .record({
        agents: fc.constant([]),
      })
      .map(shape => shape as unknown as BlueprintAgentCrewSnapshot)
  );

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("AutopilotRightRail fabric dispatch (Spec 3 PBT)", () => {
  it("P1 - dispatches the sub-stage resolved by resolveRailSubStage for any (job, selection, specTree, agentCrew)", () => {
    fc.assert(
      fc.property(
        arbJobOrNull,
        arbSelectionOrNull,
        arbSpecTreeOrNull,
        arbAgentCrewOrNull,
        (job, selection, specTree, agentCrew) => {
          const expected: AutopilotRailSubStage | undefined =
            resolveRailSubStage({
              currentStage: "fabric",
              job,
              selection,
              specTree,
              agentCrew,
            });

          // Under currentStage === "fabric" the resolver is total and always returns a
          // member of RAIL_SUB_STAGE_ORDER. Defend this contract inside the property so
          // any future resolver regression surfaces here rather than silently rendering
          // a bogus aside element.
          expect(expected).toBeDefined();
          expect(RAIL_SUB_STAGE_ORDER).toContain(expected!);

          const markup = renderToStaticMarkup(
            <AutopilotRightRail
              jobId={job?.id ?? ""}
              currentStage="fabric"
              currentSubStage={expected}
              job={job}
              routeSet={null}
              selection={selection}
              specTree={specTree}
              agentCrew={agentCrew}
              capabilities={[]}
              capabilityInvocations={[]}
              capabilityEvidence={[]}
              effectPreviews={[]}
              locale="zh-CN"
              onSubStageChange={() => {}}
            />
          );

          expect(markup).toContain('data-testid="autopilot-right-rail"');
          expect(markup).toContain('data-autopilot-stage="fabric"');
          expect(markup).toContain(`data-autopilot-sub-stage="${expected!}"`);
          expect(markup).toContain(`data-sub-stage-placeholder="${expected!}"`);
          // aria-current="step" is attached exactly to the active sub-stage block.
          expect(markup).toMatch(
            new RegExp(
              `data-sub-stage-placeholder="${expected!}"[^>]*aria-current="step"`
            )
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it("renders the merged SPEC workspace (tree + documents) on the spec_tree page", () => {
    const doc = {
      id: "doc-auth-requirements",
      jobId: "blueprint-job-docs",
      treeId: "tree-docs",
      nodeId: "node-auth",
      type: "requirements",
      status: "draft",
      title: "Requirements: 权限模型",
      summary: "权限模型需求",
      content: "## 权限模型\n\n定义角色、菜单、按钮权限。",
      format: "markdown",
      createdAt: "2026-06-01T00:00:00.000Z",
      provenance: {
        jobId: "blueprint-job-docs",
        githubUrls: [],
        treeVersion: 1,
        nodeType: "route_step",
        nodeTitle: "权限模型",
        nodeSummary: "权限模型节点",
        dependencies: [],
        outputs: [],
      },
    } satisfies BlueprintSpecDocument;
    const specTree = {
      id: "tree-docs",
      rootNodeId: "node-auth",
      nodes: [
        {
          id: "node-auth",
          title: "权限模型",
          summary: "权限模型节点",
          type: "route_step",
          status: "ready",
          priority: 1,
          dependencies: [],
          outputs: [],
          children: [],
        },
      ],
      documents: [doc],
    } as unknown as BlueprintSpecTree;
    const job = {
      id: "blueprint-job-docs",
      stage: "spec_docs",
      status: "reviewing",
      artifacts: [],
      events: [],
    } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        jobId={job.id}
        currentStage="fabric"
        currentSubStage="spec_tree"
        job={job}
        routeSet={null}
        selection={null}
        specTree={specTree}
        agentCrew={null}
        capabilities={[]}
        capabilityInvocations={[]}
        capabilityEvidence={[]}
        effectPreviews={[]}
        locale="zh-CN"
        onSubStageChange={() => {}}
      />
    );

    expect(markup).toContain('data-stage-key="spec_tree"');
    expect(markup).toContain('data-testid="streaming-doc-renderer"');
    expect(markup).toContain("权限模型");
    expect(markup).not.toContain('data-testid="spec-tree-workbench"');
    expect(markup).not.toContain('data-testid="autopilot-trust-section"');
    expect(markup).not.toContain(
      'data-testid="autopilot-workbench-action-enter-effect-preview"'
    );
  });
});
