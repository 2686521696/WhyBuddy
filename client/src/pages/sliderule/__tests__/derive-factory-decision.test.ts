import { describe, expect, it } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import {
  deriveFactoryDecisionView,
  labelFactoryTools,
} from "../derive-factory-decision";
import { deriveStatusBarFacts } from "../derive-status-bar";

describe("deriveFactoryDecisionView", () => {
  it("没有账本就不发明一条", () => {
    const state = createInitialSessionState("x", "sr-empty-ledger");
    expect(deriveFactoryDecisionView(state)).toBeNull();
    const facts = deriveStatusBarFacts(state, { turnCount: 0, isRunning: false });
    expect(facts.factoryDecision).toBeNull();
  });

  it("读到模型理由原文，规则给的和这一跳分开", () => {
    const state = createInitialSessionState("x", "sr-llm-pick");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick",
        turnId: "loop-0",
        saw: ["factory.pages", "factory.structure", "factory.bind"],
        chose: ["pages"],
        skipped: [],
        addresses: [],
        rationale: "用户指令明确为继续生成页面，跳过数据结构与权限绑定",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "llm",
      },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view).not.toBeNull();
    expect(view!.degraded).toBe(false);
    expect(view!.source).toBe("llm");
    expect(view!.rationale).toContain("继续生成页面");
    expect(view!.saw).toEqual(["页面生成", "数据结构", "权限工作流"]);
    expect(view!.chose).toEqual(["页面生成"]);
    expect(view!.loopIndex).toBe(1);
  });

  it("回落规则版必须标成降级，不许装成模型挑的", () => {
    const state = createInitialSessionState("x", "sr-fallback");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick-fallback",
        turnId: "loop-0",
        saw: ["pages", "structure", "bind"],
        chose: ["pages", "structure", "bind"],
        skipped: [],
        addresses: [],
        rationale: "第 0 轮 LLM 选材未成，回落规则版选能力",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "heuristic_fallback",
      },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view!.degraded).toBe(true);
    expect(view!.source).toBe("heuristic_fallback");
    expect(view!.rationale).toContain("回落规则版");
  });

  it("runConditions 有 AgenticPickFallback 也要标降级", () => {
    const state = createInitialSessionState("x", "sr-cond");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick",
        turnId: "loop-0",
        saw: ["pages"],
        chose: ["pages"],
        skipped: [],
        addresses: [],
        rationale: "先出页面",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "llm",
      },
    ];
    state.runConditions = [
      { type: "Degraded", status: "True", reason: "AgenticPickFallback" },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view!.degraded).toBe(true);
  });

  it("max_repeat_guard 那种空 chose 空理由不算工厂选材", () => {
    const state = createInitialSessionState("x", "sr-guard");
    state.decisionLedger = [
      {
        id: "dec-0-max_repeat_guard",
        turnId: "loop-0",
        saw: ["factory.pages"],
        chose: [],
        skipped: [{ capabilityId: "factory.pages", reason: "max_repeat_guard" }],
        addresses: [],
        rationale: "",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "local_heuristic",
      },
    ];
    expect(deriveFactoryDecisionView(state)).toBeNull();
  });
});

describe("labelFactoryTools", () => {
  it("公开工具名和 factory. 前缀都能认", () => {
    expect(labelFactoryTools(["factory.bind", "pages"])).toEqual([
      "权限工作流",
      "页面生成",
    ]);
  });
});
