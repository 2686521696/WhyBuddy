import { describe, it, expect } from "vitest";
import { executeDeliveryCapabilityMapped } from "../delivery-exec-map.js";
import { handoffPackageHasRequiredSections } from "../../../shared/blueprint/whybuddy-delivery-chain.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

function baseState(): V5SessionState {
  return {
    sessionId: "d1",
    goal: { text: "权限系统", status: "clear" },
    artifacts: [
      {
        id: "r1",
        kind: "report",
        title: "报告",
        summary: "可行",
        content: "报告正文",
        trustLevel: "gated_pass",
        producedBy: { capabilityRunId: "run-r", capabilityId: "report.write", roleId: "综合" },
      },
      {
        id: "tree1",
        kind: "spec_tree",
        title: "SPEC",
        summary: "树",
        content: "根节点",
        trustLevel: "gated_pass",
        producedBy: { capabilityRunId: "run-t", capabilityId: "structure.decompose", roleId: "架构" },
      },
    ],
    coverageGaps: [],
  } as V5SessionState;
}

describe("delivery-exec-map (S19)", () => {
  it("document.draft produces requirements/design/tasks sections", async () => {
    const result = await executeDeliveryCapabilityMapped("document.draft", baseState(), []);
    expect(result.title).toContain("文档");
    expect(result.content).toContain("# Requirements");
    expect(result.content).toContain("# Design");
  });

  it("handoff.package bundles report summary and required sections", async () => {
    const result = await executeDeliveryCapabilityMapped("handoff.package", baseState(), []);
    expect(result.title).toContain("交接");
    expect(result.content).toContain("Handoff");
    expect(result.content).toContain("权限系统");
    expect(handoffPackageHasRequiredSections(result.content || "")).toBe(true);
  });

  it("traceability.matrix emits table rows", async () => {
    const result = await executeDeliveryCapabilityMapped("traceability.matrix", baseState(), []);
    expect(result.content).toContain("| 需求 |");
    expect(result.content).toContain("REQ-1");
  });
});