import { describe, expect, it } from "vitest";
import { buildClearStateWithTrustedReport } from "@/lib/sliderule-fullpath-fixtures";
import { deriveSlideRuleReasoningViewModel } from "../derive-reasoning-view-model";
import { deriveTrustSeal } from "../derive-trust-seal";
import { parseReportSections } from "../parse-report-sections";
import {
  APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER,
  CLOSED_CLOSURE_REPORT_SECTION,
  deriveAppBundleClosureRender,
  enrichReportWriteWithRuntimeClosure,
  renderPerSkillEvidenceCoverageTable,
  serializeSlideRuleDeliveryMd,
} from "../serialize-sliderule-delivery-md";
import { SLIDERULE_TERMINAL_NODE_ID } from "../sliderule-projection-constants";
import { graphNodeIdForArtifact } from "../derive-lineage-highlight";
import { latestTrustedReport } from "@shared/blueprint/sliderule-delivery-chain";

describe("Knife C · terminal delivery platform", () => {
  it("projects terminal node with trust seal when clear + trusted report", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c");
    const clearState = { ...state, goal: { ...state.goal, status: "clear" as const } };
    const vm = deriveSlideRuleReasoningViewModel(clearState);
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
      goal: { ...state.goal, status: "clear" as const },
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
      goal: { ...state.goal, status: "clear" as const },
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

  it("derives AppBundle closure render from trusted closure evidence artifacts", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-closure-render");
    const withoutClosure = deriveAppBundleClosureRender(state);
    expect(withoutClosure.present).toBe(false);
    expect(withoutClosure.summaryLines).toEqual([]);

    const closureArtifact = {
      id: "art-appbundle-closure-119",
      kind: "evidence" as const,
      provenance: "ai_generated" as const,
      trustLevel: "gated_pass" as const,
      passedGates: ["commit"],
      producedBy: {
        capabilityRunId: "run-119",
        capabilityId: "appbundle.publish" as const,
        roleId: "closure",
      },
      title: "AppBundle Runtime Closure",
      content: JSON.stringify({
        blocked: false,
        closureHash: "feedface",
        stableDigest: "deadbeef",
        runtimeClosure: {
          skillsChecked: ["datamodel", "rbac", "appbundle"],
          versionPinsChecked: true,
        },
      }),
    };
    const withClosure = deriveAppBundleClosureRender({
      ...state,
      artifacts: [...(state.artifacts || []), closureArtifact],
    });

    expect(withClosure.present).toBe(true);
    expect(withClosure.summaryLines.join("\n")).toContain("art-appbundle-closure-119");
    expect(withClosure.summaryLines.join("\n")).toContain("versionPinsChecked");
  });

  it("serializes AppBundle closure evidence as a separate delivery section", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-closure-md");
    const closureArtifact = {
      id: "art-appbundle-closure-md",
      kind: "evidence" as const,
      provenance: "ai_generated" as const,
      trustLevel: "gated_pass" as const,
      passedGates: ["commit"],
      producedBy: {
        capabilityRunId: "run-md",
        capabilityId: "appbundle.publish" as const,
        roleId: "closure",
      },
      title: "AppBundle Runtime Closure",
      content: "runtimeClosure versionPinsChecked stableDigest=deadbeef",
    };

    const md = serializeSlideRuleDeliveryMd({
      ...state,
      artifacts: [...(state.artifacts || []), closureArtifact],
    });

    expect(md).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(md).toContain("art-appbundle-closure-md");
    expect(md).toContain("versionPinsChecked");
  });

  it("serializes Python publishClosure state when closure artifact is absent", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-python-closure-md");
    const md = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: false,
        blockerCount: 0,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        closureHash: "feedface",
        stableDigest: "deadbeef",
        tierCounts: { hard_blocker: 0, warning: 1, info: 2 },
        topBlockers: [],
      },
    } as any);

    expect(md).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(md).toContain("closure outcome: closed");
    expect(md).toContain("version pins: checked");
    expect(md).toContain("python publishClosure");
    expect(md).toContain("closure status: closed");
    expect(md).toContain("top blockers: none");
    expect(md).toContain("6/6 evidence");
    expect(md).toContain("feedface");
    expect(md.indexOf(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER)).toBeGreaterThan(
      md.indexOf("## 推演报告（核心交付 · 人类可读版）")
    );
    expect((md.match(/## AppBundle publish\/runtime closure/g) || []).length).toBe(1);
    // Negative: closed case must not emit the blocked closure report section
    expect(md).not.toContain("### Blocked closure report section");
  });

  it("serializes publishClosure blocker path details for markdown review", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-python-closure-blockers-md");
    const md = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: true,
        blockerCount: 2,
        evidencePresentCount: 4,
        skillCount: 6,
        versionPinsChecked: false,
        closureHash: "badc0ffe",
        stableDigest: "cafebabe",
        tierCounts: { hard_blocker: 2, warning: 0, info: 0 },
        topBlockers: [
          {
            code: "APPBUNDLE_PUBLISH_REF_MISSING",
            path: "menuEntries[0].roleRefs[2]",
            affectedSkill: "rbac",
            ref: "role:finance-admin",
          },
          {
            code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
            path: "runtimeSnapshot.pageBindings[1]",
            affectedSkill: "page",
            ref: "page:leave-approval",
          },
        ],
      },
    } as any);

    expect(md).toContain("closure outcome: blocked");
    expect(md).toContain("closure status: blocked");
    expect(md).toContain("top blockers: APPBUNDLE_PUBLISH_REF_MISSING@menuEntries[0].roleRefs[2]; APPBUNDLE_RUNTIME_CLOSURE_BLOCKED@runtimeSnapshot.pageBindings[1]");
    expect(md).toContain("closure blockers");
    expect(md).toContain(
      "APPBUNDLE_PUBLISH_REF_MISSING skill=rbac path=menuEntries[0].roleRefs[2] ref=role:finance-admin"
    );
    expect(md).toContain(
      "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED skill=page path=runtimeSnapshot.pageBindings[1] ref=page:leave-approval"
    );
    expect(md).toContain("APPBUNDLE_PUBLISH_REF_MISSING");
    expect(md).toContain("rbac");
    expect(md).toContain("menuEntries[0].roleRefs[2]");
    expect(md).toContain("role:finance-admin");
    // Positive evidence for blocked closure report section (task 119-03 objective)
    expect(md).toContain("### Blocked closure report section");
    expect(md).toContain("code: APPBUNDLE_PUBLISH_REF_MISSING");
    expect(md).toContain("path: menuEntries[0].roleRefs[2]");
    expect(md).toContain("affectedSkill: rbac");
    expect(md).toContain("code: APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
    expect(md).toContain("affectedSkill: page");
    expect((md.match(/## AppBundle publish\/runtime closure/g) || []).length).toBe(1);
    expect(md).not.toContain(CLOSED_CLOSURE_REPORT_SECTION);
  });

  it("serializes per-skill publishClosure evidence coverage for markdown review", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-python-closure-coverage-md");
    const md = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: true,
        blockerCount: 1,
        evidencePresentCount: 5,
        skillCount: 6,
        versionPinsChecked: true,
        closureHash: "f00dbabe",
        stableDigest: "0ddba11",
        tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
        perSkillEvidence: {
          datamodel: { evidencePresent: true },
          rbac: { evidencePresent: true },
          workflow: { evidencePresent: true },
          page: { evidencePresent: true },
          aigc: { evidencePresent: false },
          appbundle: { evidencePresent: true },
        },
      },
    } as any);

    expect(md).toContain("closure outcome: blocked");
    expect(md).toContain("version pins: checked");
    expect(md).toContain("evidence coverage:");
    expect(md).toContain("| datamodel | present |");
    expect(md).toContain("| aigc | missing |");
    expect(md).toContain("| appbundle | present |");
  });

  it("serializes closed closure report section and exported coverage table", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-python-closure-closed-section");
    const perSkillEvidence = {
      datamodel: { evidencePresent: true },
      rbac: { evidencePresent: true },
      workflow: { evidencePresent: true },
      page: { evidencePresent: true },
      aigc: { evidencePresent: true },
      appbundle: { evidencePresent: true },
    };
    const md = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: false,
        blockerCount: 0,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        closureId: "appbundle:sliderule-report-fixture-smoke@119:runtime-closure",
        closureHash: "c10sure119",
        stableDigest: "deadbeef119",
        tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
        topBlockers: [],
        perSkillEvidence,
      },
    } as any);

    expect(md).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(md).toContain("closure outcome: closed");
    expect(md).toContain(CLOSED_CLOSURE_REPORT_SECTION);
    expect(md).toContain("versionPinsChecked: true");
    expect(md).toContain("evidence coverage and version pins verified for closed runtime closure.");
    expect(md).toContain("| datamodel | present |");
    expect(renderPerSkillEvidenceCoverageTable(perSkillEvidence)).toContain("| appbundle | present |");
    expect(md).not.toContain("### Blocked closure report section");
  });

  it("serializes report/export summary from publishClosure evidence", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-report-export-summary");
    const fullPerSkillEvidence = {
      datamodel: { evidencePresent: true },
      rbac: { evidencePresent: true },
      workflow: { evidencePresent: true },
      page: { evidencePresent: true },
      aigc: { evidencePresent: true },
      appbundle: { evidencePresent: true },
    };

    const closedMd = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: false,
        blockerCount: 0,
        evidencePresentCount: 6,
        skillCount: 6,
        versionPinsChecked: true,
        stableDigest: "c0de120",
        tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
        topBlockers: [],
        perSkillEvidence: fullPerSkillEvidence,
      },
    } as any);

    expect(closedMd).toContain("### Report/Export Summary (from publish artifact closure)");
    expect(closedMd).toContain("source=publish-artifact-closure");
    expect(closedMd).toContain("status=closed");
    expect(closedMd).toContain("digest=c0de120");
    expect(closedMd).toContain("evidence=6/6");

    const blockedMd = serializeSlideRuleDeliveryMd({
      ...state,
      publishClosure: {
        blocked: false,
        blockerCount: 0,
        evidencePresentCount: 5,
        skillCount: 6,
        versionPinsChecked: true,
        stableDigest: "incomplete120",
        tierCounts: { hard_blocker: 0, warning: 1, info: 0 },
        topBlockers: [],
        perSkillEvidence: {
          ...fullPerSkillEvidence,
          aigc: { evidencePresent: false },
        },
      },
    } as any);

    expect(blockedMd).toContain("status=blocked");
    expect(blockedMd).toContain("digest=incomplete120");
    expect(blockedMd).toContain("evidence=5/6");
  });

  it("serializes fail-closed AppBundle closure note when evidence is absent", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-closure-md-negative");
    const md = serializeSlideRuleDeliveryMd(state);

    expect(md).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(md).toContain("runtime closure evidence was not found");
    expect(md).toContain("publish should remain blocked");
    expect((md.match(/## AppBundle publish\/runtime closure/g) || []).length).toBe(1);
    // Fail-closed negative: no structured blocked section when no evidence
    expect(md).not.toContain("### Blocked closure report section");
  });

  it("enriches report.write with AppBundle closure appendix without mutating the artifact", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-report-enrich");
    const report = latestTrustedReport(state)!;
    const closureArtifact = {
      id: "art-report-closure-positive",
      kind: "evidence" as const,
      provenance: "ai_generated" as const,
      trustLevel: "gated_pass" as const,
      passedGates: ["commit"],
      producedBy: {
        capabilityRunId: "run-closure-positive",
        capabilityId: "appbundle.publish" as const,
        roleId: "closure",
      },
      title: "AppBundle Runtime Closure",
      content: "runtimeClosure versionPinsChecked stableDigest=deadbeef",
    };
    const originalContent = report.content;

    const result = enrichReportWriteWithRuntimeClosure(report, {
      ...state,
      artifacts: [...(state.artifacts || []), closureArtifact],
    });

    expect(result.included).toBe(true);
    expect(result.report).not.toBe(report);
    expect(result.report.content).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(result.report.content).toContain("art-report-closure-positive");
    expect(report.content).toBe(originalContent);
  });

  it("enriches report.write with a fail-closed AppBundle closure appendix when evidence is absent", () => {
    const { state } = buildClearStateWithTrustedReport("knife-c-report-enrich-negative");
    const report = latestTrustedReport(state)!;

    const result = enrichReportWriteWithRuntimeClosure(report, state);

    expect(result.included).toBe(false);
    expect(result.report).not.toBe(report);
    expect(result.report.content).toContain(APPBUNDLE_PUBLISH_RUNTIME_CLOSURE_HEADER);
    expect(result.report.content).toContain("runtime closure evidence was not found");
    expect(result.report.content).toContain("publish should remain blocked");
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
