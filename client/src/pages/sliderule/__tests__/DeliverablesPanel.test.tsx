import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DeliverablesPanel } from "../DeliverablesPanel";

vi.mock("@/pages/autopilot/right-rail/streaming-doc/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}));

describe("DeliverablesPanel report closure summary", () => {
  it("surfaces report/export closure summary from publishClosure on the report viewer", () => {
    const html = renderToStaticMarkup(
      <DeliverablesPanel
        open={true}
        onClose={() => {}}
        isRunning={false}
        onGenerate={() => {}}
        onExportMd={() => {}}
        sessionState={
          {
            sessionId: "deliverables-report-export-summary",
            goal: { text: "publish closure", status: "clear" },
            artifacts: [
              {
                id: "report-deliverables",
                kind: "report",
                provenance: "ai_generated",
                trustLevel: "gated_pass",
                passedGates: ["commit"],
                title: "Delivery report",
                content: "Conclusion: publish artifact closure is ready.",
                producedBy: {
                  capabilityRunId: "run-report",
                  capabilityId: "report.write",
                  roleId: "report",
                },
              },
            ],
          } as any
        }
        publishClosure={
          {
            blocked: false,
            blockerCount: 0,
            evidencePresentCount: 6,
            skillCount: 6,
            versionPinsChecked: true,
            stableDigest: "digest-ui-120",
            tierCounts: { hard_blocker: 0, warning: 0, info: 1 },
            topBlockers: [],
            perSkillEvidence: {
              datamodel: { evidencePresent: true },
              rbac: { evidencePresent: true },
              workflow: { evidencePresent: true },
              page: { evidencePresent: true },
              aigc: { evidencePresent: true },
              appbundle: { evidencePresent: true },
            },
          } as any
        }
      />
    );

    expect(html).toContain('data-testid="report-export-closure-summary"');
    expect(html).toContain("source=publish-artifact-closure");
    expect(html).toContain("status=closed");
    expect(html).toContain("digest=digest-ui-120");
    expect(html).toContain("evidence=6/6");
  });
});
