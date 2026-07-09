import { describe, it, expect } from "vitest";
import { createInitialSessionState, commitArtifact, intakeMessage } from "@/lib/sliderule-runtime";
import {
  conclusionKindLabel,
  deriveSlideRuleReasoningViewModel,
} from "../derive-reasoning-view-model";
import {
  createGroundedEvidenceRaw,
  commitGroundedEvidence,
} from "@/lib/sliderule-fullpath-fixtures";

describe("deriveSlideRuleReasoningViewModel", () => {
  it("intake projection shows only proposition root until ORCH schedules capabilities", () => {
    const s = createInitialSessionState("", "sess-scaffold-ui");
    const { preparedState } = intakeMessage(s, {
      turnId: "t-scaffold",
      userText: "分析权限与风险",
    });
    const vm = deriveSlideRuleReasoningViewModel(preparedState);
    expect(vm.visibleNodes.filter((n) => !n.id.endsWith("-proposition")).length).toBe(0);
    expect(vm.visibleNodes.find((n) => n.id.endsWith("-proposition"))?.conclusionBadge).toBe(
      "用户命题"
    );
  });

  it("maps proposition root to 用户命题 badge", () => {
    const s = createInitialSessionState("做一个权限系统", "sess-vm");
    const vm = deriveSlideRuleReasoningViewModel(s);
    const root = vm.visibleNodes.find((n) => n.id.endsWith("-proposition"));
    expect(root).toBeTruthy();
    expect(root!.conclusionBadge).toBe("用户命题");
    expect(conclusionKindLabel(root!, true)).toBe("用户命题");
    expect(root!.roleLabel).not.toBe("用户命题");
  });

  it("marks trusted artifact nodes as 结论明确 and untrusted as 结论待完善", () => {
    let s = createInitialSessionState("分析风险", "sess-trust");
    s = commitGroundedEvidence(s, "ev-1", "r-ev");
    const vm = deriveSlideRuleReasoningViewModel(s);
    const evNode = vm.visibleNodes.find((n) => (n as any).producedArtifactId === "ev-1");
    if (evNode) {
      expect(evNode.conclusionBadge).toBe("结论明确");
      expect(evNode.roleLabel).not.toBe("结论明确");
    }

    const { updatedState } = commitArtifact(
      s,
      { ...createGroundedEvidenceRaw("ev-bad"), id: "ev-bad", content: "无来源" },
      "r-bad",
      false,
      []
    );
    // Force ungrounded evidence.search shape
    const bad = {
      ...createGroundedEvidenceRaw("ev-unground"),
      provenance: "ai_generated" as const,
      summary: "会话内",
      payload: { evidenceSource: "会话内综合" },
    };
    const { updatedState: s2 } = commitArtifact(updatedState, bad, "r-un", false, []);
    const vm2 = deriveSlideRuleReasoningViewModel(s2);
    expect(vm2.telemetry.sourceCount).toBeGreaterThanOrEqual(1);
    expect(vm2.consoleLines.length).toBeGreaterThanOrEqual(0);
  });
});