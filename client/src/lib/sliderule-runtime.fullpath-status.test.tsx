/**
 * SlideRule V5.1 Full-Path Acceptance — Batch 1 S2 STATUS conclusion binding.
 * Spec: docs/V5.1-full-path-test-plan.md (S2 STATUS conclusion badge binding).
 *
 * 2026-07-10 用户裁决：顶栏 STATUS 状态盒退役（换 Work/Code 模式切换），
 * S2 的「STATUS 条结论徽章绑定 sessionState.goal.status」下沉到
 * deriveStatusBarFacts（状态条事实推导层）持有：staging 仍用真实运行时
 * 走 GCOV-pass 写入路径（commitArtifact + applyGoalConclusion 单一写入者），
 * 断言 conclusionLabel 转录 goal.status。
 */

import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import * as rt from "@/lib/sliderule-runtime";
import { deriveStatusBarFacts } from "@/pages/sliderule/derive-status-bar";

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

describe("S2 STATUS · conclusion binds to sessionState.goal.status (clear)", () => {
  it('derives "已收敛 / clear" when goal.status === "clear"（GCOV-pass 写入路径）', () => {
    let staged = rt.createInitialSessionState(
      "分析权限系统的风险并给出最终报告",
      "status-s2-clear"
    );
    staged = commitTrusted(
      staged,
      "risk-1",
      "risk.analyze",
      "安全",
      "risk",
      "s-r0"
    );
    staged = commitTrusted(
      staged,
      "synth-1",
      "synthesis.merge",
      "综合",
      "synthesis",
      "s-r1"
    );
    staged = commitTrusted(
      staged,
      "report-1",
      "report.write",
      "综合",
      "report",
      "s-r2",
      rt.findInputsForCapability(staged, "report.write")
    );
    // Converged conclusion written through the single writer (mirrors the GCOV-pass write).
    staged = rt.applyGoalConclusion(staged, "clear");

    const facts = deriveStatusBarFacts(staged, {
      turnCount: 1,
      isRunning: false,
      immersion: true,
    });
    expect(facts.conclusionLabel).toBe("已收敛 / clear");
    expect(facts.conclusionLabel).not.toContain("待细化");
    // immersion 阶段标签同样转录收敛态
    expect(facts.phaseLabel).toBe("已收敛");
  });
});
