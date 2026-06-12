import { describe, it, expect } from "vitest";
import { createInitialSessionState, intakeMessage, orchestrateReasoningTurn } from "@/lib/whybuddy-runtime";
import { deriveStatusBarFacts } from "../derive-status-bar";

describe("deriveStatusBarFacts", () => {
  it("surfaces gap count and park hint when awaiting with open gaps", () => {
    const state = createInitialSessionState("测试", "status-test");
    state.runtimePhase = "awaiting";
    state.coverageGaps = [
      { id: "g1", status: "open", description: "need evidence" } as any,
    ];
    const facts = deriveStatusBarFacts(state, { turnCount: 2, isRunning: false });
    expect(facts.openGapCount).toBe(1);
    expect(facts.parkHint).toContain("缺口");
    expect(facts.turnCount).toBe(2);
  });

  it("shows autonomous drive hint while running", () => {
    const state = createInitialSessionState("测试", "status-run");
    const facts = deriveStatusBarFacts(state, { turnCount: 1, isRunning: true });
    expect(facts.parkHint).toContain("自主推进");
    expect(facts.phaseLabel).toBe("推演中");
  });

  it("immersion mode avoids park/await copy on the status surface", () => {
    const state = createInitialSessionState("测试", "status-immersion");
    state.runtimePhase = "awaiting";
    const facts = deriveStatusBarFacts(state, {
      turnCount: 1,
      isRunning: false,
      immersion: true,
      closureReason: "convergence_signal",
    });
    expect(facts.phaseLabel).not.toBe("停泊");
    expect(facts.parkHint == null || !/歇脚|停泊/.test(facts.parkHint)).toBe(true);
  });

  it("exposes three Autopilot-style metrics and closure reason", () => {
    const state = createInitialSessionState("测试", "status-metrics");
    state.runtimePhase = "awaiting";
    const facts = deriveStatusBarFacts(state, {
      turnCount: 3,
      isRunning: false,
      driveLoopCount: 2,
      closureReason: "convergence_signal",
    });
    expect(facts.driveLoopCount).toBe(2);
    expect(facts.trustedArtifactCount).toBeGreaterThanOrEqual(0);
    expect(facts.parkHint).toContain("convergence_signal");
  });

  it("surfaces G-GROUND degraded badge after ungrounded evidence.search", () => {
    const s0 = createInitialSessionState("", "status-ground");
    const { preparedState, context } = intakeMessage(s0, {
      turnId: "t-ground",
      userText: "分析权限与风险",
    });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    const withUngroundedEvidence = {
      ...newState,
      capabilityRuns: [
        ...(newState.capabilityRuns || []),
        {
          id: "r-ev-unground",
          capabilityId: "evidence.search",
          turnId: "t-ground",
          inputs: [],
          outputs: [],
          gateResults: [],
        },
      ],
      artifacts: [
        ...(newState.artifacts || []),
        {
          id: "ev-unground",
          kind: "evidence" as const,
          provenance: "ai_generated" as const,
          trustLevel: "untrusted" as const,
          producedBy: {
            capabilityRunId: "r-ev-unground",
            capabilityId: "evidence.search",
            roleId: "接地",
          },
          content: "【来源: 会话内综合】未找到可检索的公开仓库线索。",
          payload: { evidenceSource: "会话内综合" },
          passedGates: [],
        },
      ],
    };
    const facts = deriveStatusBarFacts(withUngroundedEvidence, {
      turnCount: 1,
      isRunning: false,
      executorMode: "server-llm",
    });
    expect(facts.groundingLabel).toContain("degraded");
    expect(facts.groundingHint).toContain("外部证据未接地");
    expect(facts.executorModeLabel).toContain("server-llm");
  });
});