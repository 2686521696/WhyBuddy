import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import {
  needsReadinessChain,
  pickReadinessChainCapabilities,
  gapsFromGapAskContent,
  gapsFromClarifyQuestions,
  extractBlockingQuestions,
  extractClarifyBlock,
  resolveReadinessGapsByIds,
  isUnderSpecifiedGoal,
  buildSimulatedClarifyQuestions,
  generateSlideRuleClarifyQuestions,
  SLIDERULE_CLARIFICATION_TEMPLATES,
} from "../sliderule-readiness-chain.js";
import { pickNextCapabilities } from "../sliderule-pick-heuristic.js";

function stub(goalText: string): V5SessionState {
  return {
    goal: { text: goalText, status: "needs_refinement" },
    graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
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
    sessionId: "rc-test",
  };
}

describe("sliderule-readiness-chain (P0 / S11)", () => {
  it("needsReadinessChain for vague goal", () => {
    expect(needsReadinessChain(stub("做一个系统"), "做一个系统")).toBe(true);
  });

  it("pickReadinessChainCapabilities orders gap.ask before question.expand", () => {
    const picks = pickReadinessChainCapabilities(stub("做一个系统"));
    expect(picks.map((p) => p.capabilityId)).toEqual(["gap.ask", "question.expand"]);
  });

  it("pickNextCapabilities routes vague cold start to readiness chain", () => {
    const picks = pickNextCapabilities(stub("做一个系统"), "做一个系统");
    expect(picks[0]?.capabilityId).toBe("gap.ask");
    expect(picks.some((p) => p.capabilityId === "question.expand")).toBe(true);
  });

  it("extractBlockingQuestions parses bullet questions", () => {
    const qs = extractBlockingQuestions(
      "【阻塞缺口】\n- 面向谁使用？\n- 成功标准是什么？"
    );
    expect(qs.length).toBeGreaterThanOrEqual(2);
  });

  it("gapsFromGapAskContent creates open_question gaps", () => {
    const gaps = gapsFromGapAskContent(
      "- 面向谁？\n- 范围边界？",
      "t1",
      "art-1"
    );
    expect(gaps.every((g) => g.kind === "open_question")).toBe(true);
    expect(gaps.every((g) => g.status === "open")).toBe(true);
  });

  // ===== 澄清卡片（带选项，V4 风格 schema）=====

  it("extractClarifyBlock parses clarify-json block (V4 vocab) + strips it from content", () => {
    const content =
      "【阻塞缺口】\n- 面向谁使用？\n\n```clarify-json\n" +
      JSON.stringify([
        { kind: "audience", prompt: "面向谁使用？", type: "single_choice", options: ["企业内部", "公开用户"], defaultAnswer: "企业内部", context: "决定权限模型" },
        { prompt: "补充说明？", type: "free_text" },
      ]) +
      "\n```";
    const { questions, cleanedContent } = extractClarifyBlock(content);
    expect(questions).toHaveLength(2);
    expect(questions![0]).toMatchObject({
      prompt: "面向谁使用？",
      kind: "audience",
      type: "single_choice",
      options: ["企业内部", "公开用户"],
      defaultAnswer: "企业内部",
      context: "决定权限模型",
    });
    expect(questions![1].type).toBe("free_text");
    expect(cleanedContent).not.toContain("clarify-json");
  });

  it("extractClarifyBlock returns null when no block (text fallback)", () => {
    expect(extractClarifyBlock("- 纯文本问题？").questions).toBeNull();
  });

  it("gapsFromClarifyQuestions materializes gaps carrying options/defaultAnswer/type", () => {
    const gaps = gapsFromClarifyQuestions(
      [{ prompt: "面向谁？", kind: "audience", type: "single_choice", options: ["A", "B"], defaultAnswer: "A", context: "ctx" }],
      "t1",
      "art-1"
    );
    expect(gaps[0]).toMatchObject({
      kind: "open_question",
      status: "open",
      label: "面向谁？",
      clarifyType: "single_choice",
      options: ["A", "B"],
      defaultAnswer: "A",
      context: "ctx",
    });
    expect((gaps[0] as { clarifyKind?: string }).clarifyKind).toBe("audience"); // V4 template kind propagated (不覆盖 open_question 判别式)
  });

  it("generateSlideRuleClarifyQuestions and extract respect V4 templates + kind validation", async () => {
    const qs = await generateSlideRuleClarifyQuestions("权限系统", false);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.every(q => q.kind && SLIDERULE_CLARIFICATION_TEMPLATES.some(t => t.kind === q.kind))).toBe(true);

    // simulate LLM output with kind
    const content = "【阻塞缺口】\n```clarify-json\n" + JSON.stringify([
      { kind: "audience", prompt: "面向谁？", type: "single_choice", options: ["A", "B"] }
    ]) + "\n```";
    const { questions } = extractClarifyBlock(content);
    expect(questions).toHaveLength(1);
    expect(questions![0].kind).toBe("audience");
  });

  // ===== 欠规约即澄清(放宽触发,修复「具体产品目标从不澄清」)=====

  it("isUnderSpecifiedGoal: 具体但欠规约的产品目标视为欠规约", () => {
    expect(isUnderSpecifiedGoal("万年历+倒数日提醒工具")).toBe(true); // 无用户群/平台/范围信号
    expect(isUnderSpecifiedGoal("做一个系统")).toBe(true);
    expect(isUnderSpecifiedGoal("")).toBe(true);
  });

  it("isUnderSpecifiedGoal: 命中 ≥2 规约维度或长描述视为充分", () => {
    // 用户群 + 平台 + 范围
    expect(isUnderSpecifiedGoal("面向企业团队的考勤 SaaS,web 平台,MVP 只做打卡与统计")).toBe(false);
    // 长描述
    expect(isUnderSpecifiedGoal("x".repeat(80))).toBe(false);
  });

  it("needsReadinessChain: 具体但欠规约的新目标触发澄清(此前永不触发的 bug)", () => {
    expect(needsReadinessChain(stub("万年历+倒数日提醒工具"), "万年历+倒数日提醒工具")).toBe(true);
  });

  it("needsReadinessChain: 充分规约 / clear / 显式交付指令 不触发", () => {
    const detailed = "面向企业团队的考勤 SaaS,web 平台,MVP 只做打卡与统计";
    expect(needsReadinessChain(stub(detailed), detailed)).toBe(false);
    const clear = { ...stub("万年历提醒工具"), goal: { text: "万年历提醒工具", status: "clear" as const } };
    expect(needsReadinessChain(clear, "继续")).toBe(false);
    // 显式收敛/交付意图不被澄清抢占
    expect(needsReadinessChain(stub("万年历提醒工具"), "生成可行性报告")).toBe(false);
  });

  it("needsReadinessChain: 本会话已跑过 gap.ask 后不再重复触发(每会话一次)", () => {
    const ran = {
      ...stub("万年历提醒工具"),
      capabilityRuns: [{ id: "r", capabilityId: "gap.ask", inputs: [], outputs: [], gateResults: [], turnId: "t1" }],
    } as unknown as V5SessionState;
    expect(needsReadinessChain(ran, "万年历提醒工具")).toBe(false);
  });

  it("buildSimulatedClarifyQuestions: 只对缺失维度发问,选择题带候选选项", () => {
    const qs = buildSimulatedClarifyQuestions("万年历+倒数日提醒工具");
    expect(qs.length).toBeGreaterThanOrEqual(2);
    const single = qs.find((q) => q.type === "single_choice");
    expect(single?.options?.length).toBeGreaterThanOrEqual(2);
    // 已含用户群信号时,不再问用户群
    const qs2 = buildSimulatedClarifyQuestions("面向企业团队的内部工具");
    expect(qs2.some((q) => /面向谁/.test(q.prompt))).toBe(false);
  });

  it("resolveReadinessGapsByIds resolves only the answered gaps (partial answers)", () => {
    const state = {
      coverageGaps: [
        { id: "g1", kind: "open_question", label: "q1", status: "open", createdAt: "x" },
        { id: "g2", kind: "open_question", label: "q2", status: "open", createdAt: "x" },
        { id: "g3", kind: "open_question", label: "q3", status: "open", createdAt: "x" },
      ],
    } as unknown as V5SessionState;
    const next = resolveReadinessGapsByIds(state, ["g1", "g3"]);
    const byId = new Map((next.coverageGaps || []).map((g) => [g.id, g.status]));
    expect(byId.get("g1")).toBe("resolved");
    expect(byId.get("g2")).toBe("open"); // 未答的保持 open
    expect(byId.get("g3")).toBe("resolved");
  });
});