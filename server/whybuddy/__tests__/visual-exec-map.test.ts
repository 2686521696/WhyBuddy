import { describe, it, expect } from "vitest";
import {
  executeVisualCapabilityMapped,
  buildFakePreviewForAudit,
} from "../visual-exec-map.js";
import { auditPreviewReal } from "../../../shared/blueprint/whybuddy-visual-chain.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

describe("visual-exec-map (S18)", () => {
  it("ux.preview includes audit payload", async () => {
    const state = {
      sessionId: "v1",
      goal: { text: "权限系统", status: "clear" },
      artifacts: [
        {
          id: "d1",
          kind: "doc",
          title: "doc",
          summary: "设计说明",
          content: "x",
          trustLevel: "gated_pass",
          provenance: "ai_generated",
          producedBy: { capabilityRunId: "r1", capabilityId: "document.draft" },
          passedGates: ["commit"],
        },
      ],
    } as V5SessionState;

    const result = await executeVisualCapabilityMapped("ux.preview", state);
    expect(result.content).toContain("预览·未验证");
    expect(result.payload?.audit?.passed).toBe(true);
  });

  it("buildFakePreviewForAudit fails audit", () => {
    const audit = auditPreviewReal(buildFakePreviewForAudit());
    expect(audit.passed).toBe(false);
  });
});