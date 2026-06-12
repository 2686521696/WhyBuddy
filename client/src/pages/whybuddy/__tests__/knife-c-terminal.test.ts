import { describe, expect, it } from "vitest";
import { buildClearStateWithTrustedReport } from "@/lib/whybuddy-fullpath-fixtures";
import { deriveWhyBuddyReasoningViewModel } from "../derive-reasoning-view-model";
import { deriveTrustSeal } from "../derive-trust-seal";
import { parseReportSections } from "../parse-report-sections";
import { serializeWhyBuddyDeliveryMd } from "../serialize-whybuddy-delivery-md";
import { WHYBUDDY_TERMINAL_NODE_ID } from "../whybuddy-projection-constants";
import { graphNodeIdForArtifact } from "../derive-lineage-highlight";
import { latestTrustedReport } from "@shared/blueprint/whybuddy-delivery-chain";

describe("Knife C · terminal delivery platform", () => {
  it("projects terminal node with trust seal when clear + trusted report", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c");
    const vm = deriveWhyBuddyReasoningViewModel(state);
    expect(vm.terminalNode?.id).toBe(WHYBUDDY_TERMINAL_NODE_ID);
    expect(vm.terminalMeta?.canExport).toBe(false);

    const seal = deriveTrustSeal(state);
    expect(seal.displayLine).toMatch(/T_GATE/);
    expect(seal.displayLine).toMatch(/GCOV/);
    expect(vm.terminalNode?.body).toContain("T_GATE");
  });

  it("parseReportSections yields named sections from structured report", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-parse");
    const report = (state.artifacts || []).find((a) => a.id === reportId)!;
    const sections = parseReportSections(report);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.some((s) => /结论|支撑|风险/.test(s.label))).toBe(true);
  });

  it("evidence ref maps to highlight target node id", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("knife-c-jump");
    const report = latestTrustedReport(state)!;
    const ref = report.evidenceRefs?.[0] || reportId;
    const target = graphNodeIdForArtifact(state, ref);
    expect(target).toBeTruthy();
  });

  it("serializeWhyBuddyDeliveryMd does not mutate state", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-md");
    const before = JSON.stringify(state);
    const md = serializeWhyBuddyDeliveryMd(state);
    expect(md).toContain("GCOV 覆盖回放");
    expect(md).toContain("报告全文");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("no terminal before clear", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-pre");
    const preClear = { ...state, goal: { ...state.goal!, status: "needs_refinement" as const } };
    const vm = deriveWhyBuddyReasoningViewModel(preClear);
    expect(vm.terminalNode).toBeNull();
  });

  it("not_recommended shows terminal without export", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-nr");
    const notRecommended = {
      ...state,
      goal: { ...state.goal!, status: "not_recommended" as const },
    };
    const vm = deriveWhyBuddyReasoningViewModel(notRecommended);
    expect(vm.terminalNode?.id).toBe(WHYBUDDY_TERMINAL_NODE_ID);
    expect(vm.terminalMeta?.canExport).toBe(false);
    expect(vm.terminalNode?.body).toContain("不建议建设");
  });
});