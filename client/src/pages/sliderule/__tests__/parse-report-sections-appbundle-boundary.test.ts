import { describe, expect, it } from "vitest";
import type { Artifact } from "@shared/blueprint/v5-reasoning-state";
import { parseReportSections } from "../parse-report-sections";

function reportOf(content: string): Artifact {
  return {
    id: "r-appbundle-boundary",
    kind: "report",
    title: "SlideRule report",
    content,
    trustLevel: "gated_pass",
    provenance: "ai_generated",
    passedGates: ["commit"],
    producedBy: {
      capabilityRunId: "run-report",
      capabilityId: "report.write",
      roleId: "synthesis",
    },
  };
}

describe("parseReportSections AppBundle closure boundary", () => {
  it("keeps appended AppBundle closure summary out of core report sections", () => {
    const sections = parseReportSections(
      reportOf(
        [
          "## 支撑证据",
          "上游证据正文",
          "## 风险",
          "风险正文",
          "## 收敛决策",
          "决策正文",
          "## AppBundle publish/runtime closure",
          "runtimeClosure versionPinsChecked stableDigest=deadbeef",
        ].join("\n")
      )
    );

    expect(sections.map((section) => section.label)).toEqual([
      "支撑证据",
      "风险",
      "收敛决策",
    ]);
    expect(sections.map((section) => section.body).join("\n")).not.toContain(
      "runtimeClosure"
    );
  });

  it("keeps Chinese AppBundle closure appendix out of core report sections", () => {
    const sections = parseReportSections(
      reportOf(
        [
          "结论：推进",
          "支撑证据：证据正文",
          "风险：风险正文",
          "收敛决策：决策正文",
          "## AppBundle 发布/运行时闭包 (runtime closure summary)",
          "证据 artifact: art-appbundle-closure",
        ].join("\n")
      )
    );

    expect(sections.map((section) => section.label)).toEqual(
      expect.arrayContaining(["结论", "支撑证据", "风险", "收敛决策"])
    );
    expect(sections.map((section) => section.body).join("\n")).not.toContain(
      "art-appbundle-closure"
    );
  });

  it("keeps UTF-8 Chinese AppBundle closure appendix out of core report sections", () => {
    const sections = parseReportSections(
      reportOf(
        [
          "缁撹锛氭帹杩?",
          "鏀拺璇佹嵁锛氳瘉鎹鏂?",
          "椋庨櫓锛氶闄╂鏂?",
          "鏀舵暃鍐崇瓥锛氬喅绛栨鏂?",
          "## AppBundle 发布/运行时闭环 (runtime closure summary)",
          "runtimeClosure stableDigest=deadbeef",
        ].join("\n")
      )
    );

    expect(sections.map((section) => section.body).join("\n")).not.toContain(
      "stableDigest"
    );
  });
});
