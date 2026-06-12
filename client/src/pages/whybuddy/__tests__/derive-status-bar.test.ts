import { describe, it, expect } from "vitest";
import { createInitialSessionState } from "@/lib/whybuddy-runtime";
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
});