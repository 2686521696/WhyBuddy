import { describe, it, expect } from "vitest";
import { buildCapabilityLlmFallback } from "../capability-llm-fallback.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

function baseState(goal = "设计权限系统"): V5SessionState {
  return {
    sessionId: "s-fb",
    goal: { text: goal, status: "needs_refinement" },
    artifacts: [],
    capabilityRuns: [],
    graph: { nodes: [], edges: [] },
  } as V5SessionState;
}

describe("buildCapabilityLlmFallback", () => {
  it("returns goal-anchored dialogue fallback", () => {
    const fb = buildCapabilityLlmFallback({
      capabilityId: "intent.clarify",
      state: baseState(),
      turnId: "t1",
      roleId: "产品",
      reason: "llm_error",
    });
    expect(fb?.provenance).toBe("llm_fallback");
    expect(fb?.content).toContain("设计权限系统");
    expect(fb?.degraded).toBe(true);
  });

  it("returns structured report for report.write", () => {
    const fb = buildCapabilityLlmFallback({
      capabilityId: "report.write",
      state: baseState("分析 SaaS 计费"),
      turnId: "t2",
      reason: "truncated",
    });
    expect(fb?.content).toMatch(/结论|风险|证据|报告/i);
    expect(fb?.summary).toContain("llm_fallback");
  });
});