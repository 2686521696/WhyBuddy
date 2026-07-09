import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("surfaces report/export closure summary from session publishArtifact when publishClosure is absent", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixtureDir = resolve(here, "../../../../../slide-rule-python/tests/fixtures");
    const closed = JSON.parse(
      readFileSync(resolve(fixtureDir, "closed_appbundle_publish_artifact.json"), "utf8")
    );

    const html = renderToStaticMarkup(
      <DeliverablesPanel
        open={true}
        onClose={() => {}}
        isRunning={false}
        onGenerate={() => {}}
        onExportMd={() => {}}
        sessionState={
          {
            sessionId: "deliverables-report-export-artifact-summary",
            goal: { text: "publish artifact", status: "clear" },
            publishArtifact: closed,
            artifacts: [
              {
                id: "report-deliverables-artifact",
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
      />
    );

    expect(html).toContain('data-testid="report-export-closure-summary"');
    expect(html).toContain("status=closed");
    expect(html).toContain("digest=deadbeef120");
    expect(html).toContain("evidence=6/6");
  });

  it("surfaces blocked report/export closure summary from session publishArtifact", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixtureDir = resolve(here, "../../../../../slide-rule-python/tests/fixtures");
    const blocked = JSON.parse(
      readFileSync(resolve(fixtureDir, "blocked_appbundle_publish_artifact.json"), "utf8")
    );

    const html = renderToStaticMarkup(
      <DeliverablesPanel
        open={true}
        onClose={() => {}}
        isRunning={false}
        onGenerate={() => {}}
        onExportMd={() => {}}
        sessionState={
          {
            sessionId: "deliverables-report-export-blocked-artifact-summary",
            goal: { text: "blocked publish artifact", status: "needs_refinement" },
            publishArtifact: blocked,
            artifacts: [
              {
                id: "report-deliverables-blocked-artifact",
                kind: "report",
                provenance: "ai_generated",
                trustLevel: "gated_pass",
                passedGates: ["commit"],
                title: "Delivery report",
                content: "Conclusion: publish artifact closure is blocked.",
                producedBy: {
                  capabilityRunId: "run-report",
                  capabilityId: "report.write",
                  roleId: "report",
                },
              },
            ],
          } as any
        }
      />
    );

    expect(html).toContain('data-testid="report-export-closure-summary"');
    expect(html).toContain("status=blocked");
    expect(html).toContain("digest=badc0ded120");
    expect(html).toContain("evidence=1/2");
  });

  it("does not render a degraded closure summary when no closure evidence exists", () => {
    const html = renderToStaticMarkup(
      <DeliverablesPanel
        open={true}
        onClose={() => {}}
        isRunning={false}
        onGenerate={() => {}}
        onExportMd={() => {}}
        sessionState={
          {
            sessionId: "deliverables-report-no-closure-evidence",
            goal: { text: "plain report", status: "clear" },
            artifacts: [
              {
                id: "report-no-closure-evidence",
                kind: "report",
                provenance: "ai_generated",
                trustLevel: "gated_pass",
                passedGates: ["commit"],
                title: "Delivery report",
                content: "Conclusion: no appbundle artifact yet.",
                producedBy: {
                  capabilityRunId: "run-report",
                  capabilityId: "report.write",
                  roleId: "report",
                },
              },
            ],
          } as any
        }
      />
    );

    expect(html).not.toContain('data-testid="report-export-closure-summary"');
    expect(html).not.toContain("status=degraded");
  });
});
