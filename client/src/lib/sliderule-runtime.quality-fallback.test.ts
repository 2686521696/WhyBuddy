/**
 * U1 验厚回退 (修复 "report.write 过了 LLM 但仅 quality 闸未达厚度契约 → 提交 untrusted → 交付面无产物")。
 *
 * 仅当 report.write 在 production 基线下、且唯一未过的是 quality 闸（上游可信 + 接地通过 + 其余 commit 门全过）时，
 * 才回退到 BASE 结构化模板（buildStructuredReport，7 段结构）以 pilot-template 重新过闸、provenance=template 提交为可信产物。
 * 真上游不足 / 接地失败的正当拦截不被模板掩盖。
 */
import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
} from "./sliderule-runtime";
import {
  commitTrusted,
  commitGroundedEvidence,
  createRawArtifact,
  COMPLEX_GOAL_TEXT,
} from "./sliderule-fullpath-fixtures";
import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";
import { REPORT_CANONICAL_SECTIONS } from "@shared/blueprint/sliderule-report-builder";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

const THIN_REPORT = "结论：建议推进权限系统建设。"; // < 2400 字、缺 7 段标 → production quality 必败

function preReportState(sessionId: string): V5SessionState {
  let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
  s = commitTrusted(s, "risk-1", "risk.analyze", "安全", "risk", `${sessionId}-r0`);
  s = commitGroundedEvidence(s, "ev-ground-1", `${sessionId}-r0b`);
  s = commitTrusted(s, "synth-1", "synthesis.merge", "综合", "synthesis", `${sessionId}-r1`);
  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: "现在可以出最终报告了",
  });
  return newState;
}

describe("U1 验厚回退 · report.write 仅 quality 未过 → 回退 BASE 模板", () => {
  it("薄 LLM 报告 (production) 未过 quality，但经模板回退提交为可信产物，交付面可见", () => {
    const sessionId = "qfb-1";
    const state = preReportState(sessionId);
    const inputs = findInputsForCapability(state, "report.write");
    expect(inputs.length).toBeGreaterThan(0);

    const { updatedState, committed } = commitArtifact(
      state,
      createRawArtifact(`${sessionId}-rep`, "report.write", "综合", "report", THIN_REPORT),
      `${sessionId}-rep-run`,
      false,
      inputs,
      "production"
    );

    expect(committed).not.toBeNull();
    expect(committed!.trustLevel).toBe("gated_pass"); // 不再是 untrusted
    expect(committed!.provenance).toBe("template"); // 诚实封条：非 production LLM 产出
    // 内容已换成 BASE 结构化模板（含 7 个 canonical 段标）
    for (const section of REPORT_CANONICAL_SECTIONS) {
      expect(committed!.content).toContain(section);
    }
    // 交付面（latestTrustedReport 只认 trusted）现在能返回它
    expect(latestTrustedReport(updatedState)?.id).toBe(committed!.id);
  });

  it("上游不足（report 无 declaredInputs → forceFail）时不回退，保持 untrusted", () => {
    const sessionId = "qfb-2";
    const state = preReportState(sessionId);
    const { updatedState, committed } = commitArtifact(
      state,
      createRawArtifact(`${sessionId}-rep`, "report.write", "综合", "report", THIN_REPORT),
      `${sessionId}-rep-run`,
      false,
      [], // 无上游 → isReport 强制 gate-fail → 非"仅 quality 未过" → 不触发模板回退
      "production"
    );
    // 硬失败：无可信产物返回，且 state 内留痕为 untrusted、未被模板掩盖。
    expect(committed).toBeNull();
    const persisted = updatedState.artifacts.find((a) => a.id === `${sessionId}-rep`);
    expect(persisted?.trustLevel).toBe("untrusted");
    expect(persisted?.provenance).not.toBe("template");
  });
});
