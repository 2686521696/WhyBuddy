import { describe, expect, it } from "vitest";
import {
  hasStructureDecomposeIntent,
  pickNextCapabilities,
} from "@shared/blueprint/sliderule-pick-heuristic";
import { createInitialSessionState, findInputsForCapability } from "@/lib/sliderule-runtime";
import { commitTrusted } from "@/lib/sliderule-fullpath-fixtures";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

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

  // R2 #1: 交付物必须始终含推演报告 —— 收敛时若没产出过可信报告(LLM 调度跳过),
  // 交付意图流水线要先补 report.write。
  it("delivery intent prepends report.write when no trusted report exists", () => {
    let state = createInitialSessionState("权限系统", "knife-a-deliv");
    state = { ...state, goal: { text: "权限系统", status: "clear" } } as V5SessionState;
    const picks = pickNextCapabilities(state, "打包交付：生成 spec 树、规格文档、提示词包、架构图与工程交接包");
    expect(picks.some((p) => p.capabilityId === "report.write")).toBe(true);
  });

  it("delivery intent omits report.write when a trusted report already exists", () => {
    let state = createInitialSessionState("权限系统", "knife-a-deliv2");
    state = { ...state, goal: { text: "权限系统", status: "clear" } } as V5SessionState;
    state = commitTrusted(state, "rep-1", "report.write", "综合", "report", "knife-a-rep");
    const picks = pickNextCapabilities(state, "打包交付：生成全部交付物");
    expect(picks.some((p) => p.capabilityId === "report.write")).toBe(false);
  });
});

describe("R2 #3 · findInputsForCapability 全上下文", () => {
  it("collects ALL healthy upstreams of needed kinds (not capped at one per kind)", () => {
    let state = createInitialSessionState("权限系统", "fin-ctx");
    state = commitTrusted(state, "ev-1", "evidence.search", "接地", "evidence", "r-ev1");
    state = commitTrusted(state, "ev-2", "evidence.search", "接地", "evidence", "r-ev2");
    state = commitTrusted(state, "risk-1", "risk.analyze", "安全", "risk", "r-rk1");
    state = commitTrusted(state, "risk-2", "risk.analyze", "安全", "risk", "r-rk2");
    state = commitTrusted(state, "syn-1", "synthesis.merge", "综合", "synthesis", "r-sy1");
    const inputs = findInputsForCapability(state, "report.write");
    // 此前封顶 neededKinds.length(4) 且每 kind 只取最近一个 → 现在应吃到全部 5 个上游。
    expect(inputs).toEqual(expect.arrayContaining(["ev-1", "ev-2", "risk-1", "risk-2", "syn-1"]));
    expect(inputs.length).toBeGreaterThanOrEqual(5);
  });
});