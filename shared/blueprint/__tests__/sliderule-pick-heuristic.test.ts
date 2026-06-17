import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import { pickNextCapabilities } from "../sliderule-pick-heuristic.js";

function stub(goal: string): V5SessionState {
  return {
    goal: { text: goal, status: "needs_refinement" },
    graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
    artifacts: [],
    capabilityRuns: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    sessionId: "pick-test",
  };
}

describe("pickNextCapabilities brainstorm priming", () => {
  it("prepends critique.generate for complex product-build goals even when cold-start picks are full", () => {
    const goal = "写一个以LLM为核心驱动引擎的多Agent自定义RPG游戏";
    const picks = pickNextCapabilities(stub(goal), goal);
    expect(picks[0]?.capabilityId).toBe("critique.generate");
    expect(picks.some((p) => p.capabilityId === "synthesis.merge")).toBe(true);
  });
});