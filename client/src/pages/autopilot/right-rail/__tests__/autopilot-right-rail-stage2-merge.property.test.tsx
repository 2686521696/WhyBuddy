/**
 * Regression guard — Autopilot Stage-2 SPEC workspace merge.
 *
 * spec: `.kiro/specs/autopilot-stage2-merge-regression/`
 *
 * 锁住"第二阶段（规格树 + 规格文档）始终渲染同一个合并工作区
 * （StreamingDocRenderer），永不退回旧的 SpecTreeWorkbench 拆分视图"。
 *
 * P1（合并工作区恒在）：对 job.stage ∈ {spec_tree, spec_docs} ×
 *   currentSubStage ∈ {undefined, "spec_tree"} × specTree ∈ {空树, null}
 *   的所有组合，输出恒含 streaming-doc-renderer 且恒不含 spec-tree-workbench。
 * P2（stage-key 稳定）：上述组合下 data-stage-key="spec_tree" 恒成立，
 *   data-stage-key="spec_documents" 恒不出现。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import { AutopilotRightRail } from "../AutopilotRightRail";
import type { AutopilotRightRailProps } from "../types";

const EMPTY_SPEC_TREE = {
  id: "spec-tree-empty",
  nodes: [],
  documents: [],
} as unknown as BlueprintSpecTree;

function baseProps(
  overrides: Partial<AutopilotRightRailProps>,
): AutopilotRightRailProps {
  return {
    jobId: "job-stage2",
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
    onSubStageChange: () => {},
    ...overrides,
  };
}

describe("AutopilotRightRail · Stage-2 merge regression guard", () => {
  const jobStages = ["spec_tree", "spec_docs"] as const;
  const subStages = [undefined, "spec_tree"] as const;
  const specTrees = ["empty", "null"] as const;

  it("P1/P2: stage-2 always renders the merged StreamingDocRenderer under spec_tree stage-key", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...jobStages),
        fc.constantFrom(...subStages),
        fc.constantFrom(...specTrees),
        (jobStage, subStage, specTreeKind) => {
          const job = {
            id: "job-stage2",
            stage: jobStage,
            status: "reviewing",
            artifacts: [],
            events: [],
          } as unknown as BlueprintGenerationJob;

          const markup = renderToStaticMarkup(
            <AutopilotRightRail
              {...baseProps({
                job,
                currentSubStage: subStage,
                specTree: specTreeKind === "empty" ? EMPTY_SPEC_TREE : null,
              })}
            />,
          );

          // P1: merged workspace always present, old split view never.
          expect(markup).toContain('data-testid="streaming-doc-renderer"');
          expect(markup).not.toContain('data-testid="spec-tree-workbench"');

          // P2: stage-key stays spec_tree, never spec_documents.
          expect(markup).toContain('data-stage-key="spec_tree"');
          expect(markup).not.toContain('data-stage-key="spec_documents"');
        },
      ),
      { numRuns: 50 },
    );
  });
});
