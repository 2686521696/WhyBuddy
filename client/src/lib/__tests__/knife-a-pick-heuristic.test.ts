import { describe, expect, it } from "vitest";
import {
  hasStructureDecomposeIntent,
  pickNextCapabilities,
} from "@shared/blueprint/whybuddy-pick-heuristic";
import { createInitialSessionState } from "@/lib/whybuddy-runtime";
import { commitTrusted } from "@/lib/whybuddy-fullpath-fixtures";

describe("Knife A′ · structure pick heuristic", () => {
  it("hasStructureDecomposeIntent matches 结构 / SPEC Tree / decompose", () => {
    expect(hasStructureDecomposeIntent("把目标结构化成需求树")).toBe(true);
    expect(hasStructureDecomposeIntent("decompose into spec tree")).toBe(true);
    expect(hasStructureDecomposeIntent("SPEC Tree")).toBe(true);
    expect(hasStructureDecomposeIntent("拆解成 SPEC Tree")).toBe(true);
  });

  it("pick includes structure.decompose for 结构 intent", () => {
    const state = createInitialSessionState("权限", "knife-a");
    const picks = pickNextCapabilities(state, "把目标结构化成需求树");
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(true);
  });

  it("pick excludes structure when healthy spec_tree exists", () => {
    let state = createInitialSessionState("权限", "knife-a-dedup");
    state = commitTrusted(
      state,
      "tree-1",
      "structure.decompose",
      "架构",
      "spec_tree",
      "knife-a-run"
    );
    const picks = pickNextCapabilities(state, "再拆解一版");
    expect(picks.some((p) => p.capabilityId === "structure.decompose")).toBe(false);
  });
});