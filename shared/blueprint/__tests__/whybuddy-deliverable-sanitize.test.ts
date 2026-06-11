import { describe, it, expect } from "vitest";
import { buildStructuredReport } from "../whybuddy-report-builder.js";
import { sanitizeDeliverable } from "../whybuddy-deliverable-sanitize.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

describe("sanitizeDeliverable (A5 contract with buildStructuredReport)", () => {
  it("strips internal engineering vocabulary from real report template output", () => {
    const state = {
      sessionId: "sanitize-a5",
      goal: { text: "权限系统", status: "needs_refinement" },
      artifacts: [
        {
          id: "risk-1",
          kind: "risk",
          trustLevel: "gated_pass",
          producedBy: { capabilityRunId: "r1", capabilityId: "risk.analyze", roleId: "安全" },
          title: "风险",
          summary: "风险摘要",
          content: "风险：数据范围越权风险。",
        },
      ],
      staleArtifactIds: [],
    } as unknown as V5SessionState;

    const built = buildStructuredReport({
      state,
      inputArtifactIds: ["risk-1"],
      roleId: "综合",
    });

    const sanitized = sanitizeDeliverable(built.content);

    expect(sanitized).not.toMatch(/artifact|stale|upstream|provenance|gated|capability/i);
    expect(sanitized).not.toContain("下一步工程化分支");
    expect(sanitized).not.toContain("【");
    expect(sanitized).not.toContain("】");
    expect(sanitized.length).toBeGreaterThan(20);
  });
});