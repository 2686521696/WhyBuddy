/**
 * Integration — SlideRule V5.1 GOAL Conclusion Gate (Task 4，投影层形式)
 * Spec: .kiro/specs/sliderule-goal-conclusion-gate/
 *
 * 2026-07-10 用户裁决：顶栏 STATUS 状态盒退役，结论徽标无页面级 DOM。
 * 两条全链路 flow（真实 orchestrateReasoningTurn 驱动）保持不变，断言层
 * 从页面 SSR 下沉到 projectConclusionBadge 投影：
 *
 *   1. CLEAR flow:      普通轮 + converge 轮驱动真实 GCOV-pass →
 *                       goal.status === "clear" → 投影「已收敛 / clear」。
 *   2. HARD-BLOCK flow: 缺前置的 converge 轮停泊在 partial AWAIT →
 *                       goal.status 保持 "needs_refinement" → 投影「待细化」。
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 3.1, 3.6（投影层等价形式）
 */

import { describe, it, expect, beforeAll } from "vitest";
import type {
  V5SessionState,
  Artifact,
  CoverageGateResult,
} from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";
import { commitGroundedEvidence } from "@/lib/sliderule-fullpath-fixtures";
import * as rt from "@/lib/sliderule-runtime";
import { projectConclusionBadge } from "./sliderule/conclusion-badge";

function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact["kind"],
  content = `${roleId} 通过 ${capabilityId} 贡献了内容。`
): Omit<Artifact, "trustLevel" | "passedGates"> {
  return {
    id,
    kind,
    provenance: "ai_generated",
    producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
    title: content.split("\n")[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

/** Commit a trusted (gated_pass) capability run so its required pre-req is satisfied for GCOV. */
function commitTrusted(
  state: V5SessionState,
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact["kind"],
  runId: string
): V5SessionState {
  const { updatedState } = rt.commitArtifact(
    state,
    createRawArtifact(id, capabilityId, roleId, kind),
    runId,
    false,
    []
  );
  const art = (updatedState.artifacts || []).find(
    a => a.producedBy?.capabilityId === capabilityId && a.id === id
  );
  if (art) {
    (art as { trustLevel: string }).trustLevel = "gated_pass";
    (art as { passedGates: string[] }).passedGates = ["commit"];
  }
  return updatedState;
}

/** Drive a full flow to a real GCOV-pass and return the resulting state (goal.status === "clear"). */
function buildClearFlowState(): V5SessionState {
  const goalText = "分析权限系统的风险并给出最终报告";
  let s = rt.createInitialSessionState(goalText, "integration-clear");

  // Ordinary upstream turns produce trusted required pre-reqs (incl. grounded evidence for
  // G-GROUND). The complex CoverageContract also requires critique.generate
  // (V5.2/V5.3 面板质疑纳入合约), so the flow commits a trusted critique run before converging.
  s = commitTrusted(s, "risk-1", "risk.analyze", "安全", "risk", "int-r0");
  s = commitTrusted(
    s,
    "crit-1",
    "critique.generate",
    "挑刺",
    "risk",
    "int-r0c"
  );
  s = commitGroundedEvidence(s, "ev-ground-1", "int-r0b");
  s = commitTrusted(
    s,
    "synth-1",
    "synthesis.merge",
    "综合",
    "synthesis",
    "int-r1"
  );

  // Converge turn drives the GCOV-gated conclusion write.
  const { newState } = rt.orchestrateReasoningTurn(s, {
    turnId: "int-converge",
    userText: "现在可以出最终报告了",
  });
  return newState;
}

/** Drive a converge turn with missing pre-reqs to a hard-block partial AWAIT (goal.status unchanged). */
function buildHardBlockFlowState(): V5SessionState {
  const goalText = "有风险的权限系统最终可行性报告";
  let s = rt.createInitialSessionState(goalText, "integration-hardblock");

  const { updatedState: sWithRisk } = rt.commitArtifact(
    s,
    createRawArtifact("untrusted-risk", "risk.analyze", "安全", "risk"),
    "int-hb-run-risk",
    true,
    []
  );
  s = commitTrusted(
    sWithRisk,
    "trusted-synth",
    "synthesis.merge",
    "综合",
    "synthesis",
    "int-hb-run-synth"
  );
  s = { ...s, openQuestions: [{ id: "q1", text: "边界？" }] } as V5SessionState;

  const { newState } = rt.orchestrateReasoningTurn(s, {
    turnId: "int-hardblock",
    userText: "路线对比 拆解结构 预览效果",
  });
  return newState;
}

describe("INTEGRATION (Task 4): full flow surfaces the GCOV conclusion via the badge projection", () => {
  let clearState: V5SessionState;
  let hardBlockState: V5SessionState;

  beforeAll(() => {
    clearState = buildClearFlowState();
    hardBlockState = buildHardBlockFlowState();
  });

  it('CLEAR flow: converge → GCOV-pass → goal.status "clear" → 投影已收敛', () => {
    // The flow genuinely reached a GCOV-pass and wrote the conclusion.
    const gate = clearState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(true);
    expect(clearState.goal.status).toBe("clear");

    const badge = projectConclusionBadge(clearState);
    expect(badge.label).toBe("已收敛 / clear");
    expect(badge.tone).toBe("clear");
  });

  it("HARD-BLOCK flow: converge with missing pre-reqs → partial AWAIT → 投影保持待细化", () => {
    // The flow hard-blocked into a partial AWAIT and left goal.status unchanged.
    const gate = hardBlockState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    expect(hardBlockState.runtimePhase).toBe("awaiting");
    expect(hardBlockState.goal.status).toBe("needs_refinement");

    const badge = projectConclusionBadge(hardBlockState);
    expect(badge.label).toBe("待细化");
    expect(badge.tone).toBe("idle");
  });
});
