import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  orchestrateReasoningTurn,
} from "@/lib/sliderule-runtime";
import { deriveSlideRuleReasoningViewModel } from "../derive-reasoning-view-model";

describe("deriveSlideRuleReasoningViewModel canvas copy", () => {
  it("uses Chinese capability labels instead of orchestrate debug English", () => {
    const s0 = createInitialSessionState("", "debug-sess");
    const { preparedState, context } = intakeMessage(s0, {
      turnId: "t1",
      userText: "分析权限与风险，生成可行性报告",
    });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    const vm = deriveSlideRuleReasoningViewModel(newState);
    const pending = vm.visibleNodes.filter((n) => !n.id.endsWith("-proposition"));
    expect(pending.length).toBeGreaterThan(0);
    for (const n of pending) {
      expect(n.title).not.toMatch(/：待 .* 推演/);
      expect(n.body || "").not.toContain("Produced by orchestrateReasoningTurn");
      expect(n.roleLabel).not.toBe("推演中");
    }
    expect(pending.some((n) => n.title.includes("检索") || n.title.includes("风险"))).toBe(
      true
    );
  });
});