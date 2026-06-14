import { describe, expect, it } from "vitest";
import { buildClearStateWithTrustedReport } from "@/lib/sliderule-fullpath-fixtures";
import { deriveSlideRuleReasoningViewModel } from "../derive-reasoning-view-model";
import { deriveTrustSeal } from "../derive-trust-seal";
import { parseReportSections } from "../parse-report-sections";
import { serializeSlideRuleDeliveryMd } from "../serialize-sliderule-delivery-md";
import { SLIDERULE_TERMINAL_NODE_ID } from "../sliderule-projection-constants";
import { graphNodeIdForArtifact } from "../derive-lineage-highlight";
import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";

describe("Knife C · terminal delivery platform", () => {
  it("projects terminal node with trust seal when clear + trusted report", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c");
    const vm = deriveSlideRuleReasoningViewModel(state);
    expect(vm.terminalNode?.id).toBe(SLIDERULE_TERMINAL_NODE_ID);
    expect(vm.terminalMeta?.canExport).toBe(false);

    const seal = deriveTrustSeal(state);
    expect(seal.displayLine).toMatch(/T_GATE/);
    expect(seal.displayLine).toMatch(/GCOV/);
    expect(vm.terminalNode?.body).toContain("T_GATE");
  });

  it("trust seal commit gate counts scope to report capabilityRun", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-seal");
    const report = latestTrustedReport(state)!;
    const reportRun = (state.capabilityRuns || []).find(
      (r) => r.id === report.producedBy?.capabilityRunId
    );
    expect(reportRun?.gateResults?.length).toBeGreaterThan(0);

    const seal = deriveTrustSeal(state);
    expect(seal.commitTotal).toBe(reportRun!.gateResults!.length);
    expect(seal.commitPassed).toBe(
      reportRun!.gateResults!.filter((g) => g.status === "passed").length
    );
    expect(seal.commitTotal).toBeLessThan((state.gates || []).length);
  });

  it("canExport enables on scoped RV pass for current report", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-rv");
    const withRv = {
      ...state,
      conversation: [
        ...(state.conversation || []),
        {
          id: "rv-pass",
          role: "system",
          text: `[RV] 评审通过 · reportId=${reportId}`,
        },
      ],
    };
    const vm = deriveSlideRuleReasoningViewModel(withRv);
    expect(vm.terminalMeta?.canExport).toBe(true);
  });

  it("canExport stays false when legacy RV targets a superseded report", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-rv-stale");
    const withStaleRv = {
      ...state,
      artifacts: [
        ...(state.artifacts || []),
        {
          id: "report-2",
          kind: "report" as const,
          provenance: "ai_generated" as const,
          trustLevel: "gated_pass" as const,
          passedGates: ["commit"],
          producedBy: {
            capabilityRunId: "run-report-2",
            capabilityId: "report.write" as const,
            roleId: "综合",
          },
          content: "新报告",
          title: "新报告",
        },
      ],
      capabilityRuns: [
        ...(state.capabilityRuns || []),
        {
          id: "run-report-2",
          capabilityId: "report.write" as const,
          roleId: "综合",
          inputs: [],
          outputs: ["report-2"],
          gateResults: [{ gateId: "commit", status: "passed" as const }],
          turnId: "t2",
        },
      ],
      conversation: [
        ...(state.conversation || []),
        {
          id: "rv-old",
          role: "system",
          text: `[RV] 评审通过 · reportId=${reportId}`,
        },
      ],
    };
    const vm = deriveSlideRuleReasoningViewModel(withStaleRv);
    expect(vm.terminalMeta?.canExport).toBe(false);
  });

  it("parseReportSections yields named sections from structured report", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-parse");
    const report = (state.artifacts || []).find((a) => a.id === reportId)!;
    const sections = parseReportSections(report);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.some((s) => /结论|支撑|风险/.test(s.label))).toBe(true);
  });

  it("parseReportSections ignores inline 风险: inside body text", () => {
    const sections = parseReportSections({
      id: "inline",
      kind: "report",
      provenance: "ai_generated",
      trustLevel: "gated_pass",
      producedBy: {
        capabilityRunId: "run",
        capabilityId: "report.write",
        roleId: "综合",
      },
      passedGates: ["commit"],
      content: "结论：推进\n\n支撑证据：\n- 来自 risk / 风险: 越权案例\n\n风险：数据范围",
    });
    const riskSections = sections.filter((s) => s.label === "风险");
    expect(riskSections.length).toBe(1);
    expect(riskSections[0].body).toContain("数据范围");
  });

  it("evidence ref maps to real graph node id", () => {
    const { state, riskId } = buildClearStateWithTrustedReport("knife-c-jump");
    const target = graphNodeIdForArtifact(state, riskId);
    const graphIds = new Set((state.graph?.nodes || []).map((n) => n.id));
    expect(target).toBeTruthy();
    expect(
      graphIds.has(target!) || [...graphIds].some((id) => target!.startsWith(`${id}::ev-`))
    ).toBe(true);
  });

  it("serializeSlideRuleDeliveryMd does not mutate state", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-md");
    const before = JSON.stringify(state);
    const md = serializeSlideRuleDeliveryMd(state);
    expect(md).toContain("GCOV 覆盖回放");
    expect(md).toContain("推演报告"); // 导出已增强为人类可读版(含推演报告章节)
    expect(JSON.stringify(state)).toBe(before);
  });

  it("no terminal before clear", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-pre");
    const preClear = { ...state, goal: { ...state.goal!, status: "needs_refinement" as const } };
    const vm = deriveSlideRuleReasoningViewModel(preClear);
    expect(vm.terminalNode).toBeNull();
  });

  it("not_recommended shows terminal without export", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-nr");
    const notRecommended = {
      ...state,
      goal: { ...state.goal!, status: "not_recommended" as const },
    };
    const vm = deriveSlideRuleReasoningViewModel(notRecommended);
    expect(vm.terminalNode?.id).toBe(SLIDERULE_TERMINAL_NODE_ID);
    expect(vm.terminalMeta?.canExport).toBe(false);
    expect(vm.terminalNode?.body).toContain("不建议建设");
  });
});