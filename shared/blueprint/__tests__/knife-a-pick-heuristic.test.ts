import { describe, expect, it } from "vitest";
import {
  hasStructureDecomposeIntent,
  pickNextCapabilities,
} from "../whybuddy-pick-heuristic";
import type { V5SessionState } from "../v5-reasoning-state";

function baseState(): V5SessionState {
  return {
    goal: { text: "权限系统", status: "needs_refinement" },
    graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [], source: "runtime" },
    artifacts: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    capabilityRuns: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
  };
}

describe("Knife A′ · structure pick heuristic", () => {
  it("hasStructureDecomposeIntent matches 结构 / SPEC Tree / decompose", () => {
    expect(hasStructureDecomposeIntent("把目标结构化成需求树")).toBe(true);
    expect(hasStructureDecomposeIntent("decompose into spec tree")).toBe(true);
    expect(hasStructureDecomposeIntent("SPEC Tree")).toBe(true);
    expect(hasStructureDecomposeIntent("拆解成 SPEC Tree")).toBe(true);
  });

  it("pick includes structure.decompose for 结构 intent", () => {
    const picks = pickNextCapabilities(baseState(), "把目标结构化成需求树");
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(true);
  });

  it("pick excludes structure when healthy spec_tree exists", () => {
    const state: V5SessionState = {
      ...baseState(),
      artifacts: [
        {
          id: "tree-1",
          kind: "spec_tree",
          title: "tree",
          content: "x",
          trustLevel: "gated_pass",
          producedBy: { capabilityRunId: "r1", capabilityId: "structure.decompose", roleId: "架构" },
        },
      ],
    };
    const picks = pickNextCapabilities(state, "再拆解一版");
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(false);
  });

  it("preserves existing 拆解 pick behavior", () => {
    const picks = pickNextCapabilities(baseState(), "拆解成 SPEC Tree");
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(true);
  });
});