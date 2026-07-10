/**
 * Reconverge badge — challenge 后结论必须降级（原 C-2 缺陷锁，投影层形式）.
 * Spec: .kiro/specs/sliderule-reconverge-loop-fix/ (Task 1, Property 1, C-2)
 *
 * 2026-07-10 用户裁决：顶栏 STATUS 状态盒退役，徽标无页面级 DOM。
 * 原属性下沉到运行时 + 投影层：converged（goal.status === "clear"）会话
 * 被质疑（invalidateForIntervention 使支撑报告失效）后，goal.status 必须
 * 经单一写入者降级为 needs_refinement，投影层随之给出「待细化」而不是
 * 陈旧的「已收敛 / clear」。staging 全部走真实运行时（commitArtifact /
 * applyGoalConclusion / invalidateForIntervention），与修复前的页面级
 * 测试完全同源。
 *
 * Validates: Requirements 1.6, 2.7（投影层等价形式）
 */

import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import * as rt from "@/lib/sliderule-runtime";
import { projectConclusionBadge } from "./sliderule/conclusion-badge";

function commitTrusted(
  st: V5SessionState,
  id: string,
  capabilityId: string,
  roleId: string,
  kind: string,
  runId: string,
  inputs: string[] = []
): V5SessionState {
  const { updatedState } = rt.commitArtifact(
    st,
    {
      id,
      kind,
      provenance: "ai_generated",
      producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
      passedGates: [],
      title: id,
      summary: id,
      content: `${roleId} 通过 ${capabilityId} 贡献了内容。`,
    } as never,
    runId,
    false,
    inputs
  );
  const a = (updatedState.artifacts || []).find(x => x.id === id);
  if (a) {
    (a as { trustLevel: string }).trustLevel = "gated_pass";
    (a as { passedGates: string[] }).passedGates = ["commit"];
  }
  return updatedState;
}

describe("challenge 后结论徽标不许说谎（C-2：陈旧 clear 必须降级为待细化）", () => {
  it("converged 会话被质疑后：goal.status 降级、投影层给出待细化", () => {
    let staged = rt.createInitialSessionState(
      "分析权限系统的风险并给出最终报告",
      "badge-reconverge"
    );
    staged = commitTrusted(
      staged,
      "risk-1",
      "risk.analyze",
      "安全",
      "risk",
      "b-r0"
    );
    staged = commitTrusted(
      staged,
      "synth-1",
      "synthesis.merge",
      "综合",
      "synthesis",
      "b-r1"
    );
    staged = commitTrusted(
      staged,
      "report-1",
      "report.write",
      "综合",
      "report",
      "b-r2",
      rt.findInputsForCapability(staged, "report.write")
    );
    staged = rt.applyGoalConclusion(staged, "clear");
    expect(projectConclusionBadge(staged).label).toBe("已收敛 / clear");

    // 用户质疑支撑报告——从这一刻起徽标不许再显示陈旧的 clear
    staged = rt.invalidateForIntervention(staged, {
      targetArtifactId: "report-1",
      intent: "challenge",
      text: "我质疑这个结论",
    } as never);

    expect(staged.goal.status).toBe("needs_refinement");
    const badge = projectConclusionBadge(staged);
    expect(badge.label).toBe("待细化");
    expect(badge.label).not.toContain("已收敛");
  });
});
