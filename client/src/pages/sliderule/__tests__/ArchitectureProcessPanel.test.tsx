import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ArchitectureProcessPanel } from "../ArchitectureProcessPanel";

vi.mock("../TurnRouteTimeline", () => ({
  TurnRouteTimeline: () => <div data-testid="mock-turn-route-timeline" />,
}));

describe("ArchitectureProcessPanel publish closure drilldown", () => {
  it("renders stable skill linkage row targets for cross-runtime examples", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-linkage"
        isRunning={false}
        latestTurn={{
          id: "turn-linkage",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        crossRuntimeGraph={{
          edgeCount: 1,
          allowedCount: 1,
          blockedCount: 0,
          skillCount: 2,
          evidenceCount: 1,
          examples: [
            {
              sourceSkill: "datamodel",
              targetSkill: "page",
              state: "allowed",
              evidenceKey: "DM_PAGE:leave_request",
            },
          ],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-skill-linkage-row"');
    expect(html).toContain('data-source-skill="datamodel"');
    expect(html).toContain('data-target-skill="page"');
    expect(html).toContain('data-state="allowed"');
    expect(html).toContain('data-evidence-key="DM_PAGE:leave_request"');
  });

  it("renders stable blocker drilldown targets for closure blockers", () => {
    const html = renderToStaticMarkup(
      <ArchitectureProcessPanel
        liveAction={null}
        sessionId="arch-panel-test"
        isRunning={false}
        latestTurn={{
          id: "turn-closure",
          routeFacts: {} as any,
          steps: [],
          actions: [],
          status: "complete",
          routeLitCount: 0,
          routeExpanded: true,
        }}
        crossRuntimeGraph={{
          edgeCount: 1,
          allowedCount: 0,
          blockedCount: 1,
          skillCount: 2,
          evidenceCount: 1,
          examples: [],
        }}
        publishClosure={{
          blocked: true,
          blockerCount: 1,
          evidencePresentCount: 5,
          skillCount: 6,
          versionPinsChecked: false,
          closureHash: "feedface",
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
          topBlockers: [
            {
              code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
              path: "pageBindings[0].pageRef",
              affectedSkill: "page",
              ref: "page_purchase_request",
            },
          ],
        }}
      />
    );

    expect(html).toContain('data-testid="sliderule-publish-closure-blocker"');
    expect(html).toContain('data-skill="page"');
    expect(html).toContain('data-ref="page_purchase_request"');
    expect(html).toContain('data-path="pageBindings[0].pageRef"');
    expect(html).toContain("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
  });
});
