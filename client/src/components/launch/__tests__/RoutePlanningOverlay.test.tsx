import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  LaunchRouteCandidate,
  LaunchRouteCandidateId,
  LaunchRoutePlan,
} from "@/lib/launch-router";

import {
  getRouteCandidateComparison,
  getRouteCandidateDetail,
  getRouteCandidateDisabledReason,
  getRouteCandidateStageLabel,
  getRouteCandidateTitle,
  getRouteComparisonMetricLabel,
  RoutePlanningOverlay,
} from "../RoutePlanningOverlay";

function makeCandidate(
  id: LaunchRouteCandidateId,
  overrides: Partial<LaunchRouteCandidate> = {}
): LaunchRouteCandidate {
  return {
    id,
    mode: "standard",
    launchKind: "mission",
    routeOverride: "mission",
    recommended: false,
    available: true,
    disabledReason: null,
    reasons: [],
    stages: ["destination", "route", "execution"],
    takeoverPoints: ["route-selection"],
    ...overrides,
  };
}

function makeRoutePlan(): LaunchRoutePlan {
  const candidates = [
    makeCandidate("fast-route", {
      mode: "fast",
      recommended: false,
      stages: ["destination", "route", "execution", "evidence"],
      takeoverPoints: ["final-review"],
    }),
    makeCandidate("standard-route", {
      mode: "standard",
      recommended: true,
      stages: ["destination", "route", "fleet", "execution", "review", "evidence"],
      takeoverPoints: ["route-selection", "final-review"],
    }),
    makeCandidate("deep-route", {
      mode: "deep",
      launchKind: "workflow",
      routeOverride: "workflow",
      available: false,
      disabledReason: "requires_runtime_upgrade",
      stages: ["destination", "route", "fleet", "execution", "review", "evidence"],
      takeoverPoints: ["route-selection", "runtime-upgrade", "final-review"],
    }),
  ];

  return {
    decision: {
      kind: "mission",
      reasons: ["complete_task_brief"],
      requiresAdvancedRuntime: false,
      needsClarification: false,
      canOverride: true,
    },
    recommendedRouteId: "standard-route",
    candidates,
  };
}

describe("RoutePlanningOverlay helpers", () => {
  it("localizes candidate title, detail, stage, and disabled reason", () => {
    expect(getRouteCandidateTitle("en-US", { id: "standard-route" })).toBe(
      "Standard route"
    );
    expect(getRouteCandidateTitle("zh-CN", { id: "deep-route" })).toBe(
      "深度路线"
    );
    expect(getRouteCandidateDetail("en-US", { id: "fast-route" })).toContain(
      "fast output"
    );
    expect(getRouteCandidateStageLabel("en-US", "fleet")).toBe("Fleet");
    expect(getRouteCandidateStageLabel("zh-CN", "route")).toBe("路线");
    expect(
      getRouteCandidateDisabledReason("en-US", "requires_runtime_upgrade")
    ).toBe("Needs advanced runtime");
  });

  it("summarizes comparison metrics for route cards", () => {
    const fast = makeCandidate("fast-route", {
      mode: "fast",
      takeoverPoints: ["final-review"],
    });
    const deep = makeCandidate("deep-route", {
      mode: "deep",
      takeoverPoints: ["route-selection", "runtime-upgrade", "final-review"],
    });

    expect(getRouteComparisonMetricLabel("en-US", "speed")).toBe("Speed");
    expect(getRouteComparisonMetricLabel("zh-CN", "takeover")).toBe("接管点");
    expect(getRouteCandidateComparison("en-US", fast)).toMatchObject({
      speed: "Fastest",
      stability: "Medium",
      depth: "Light",
      risk: "Medium",
      cost: "Low",
      takeover: "1",
    });
    expect(getRouteCandidateComparison("en-US", deep)).toMatchObject({
      stability: "Highest",
      depth: "Deep",
      cost: "High",
      takeover: "3",
    });
  });
});

describe("RoutePlanningOverlay", () => {
  it("renders the recommended route badge and title", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
      />
    );

    expect(markup).toContain("Best: Standard route");
    expect(markup).toContain("Best");
    expect(markup).toContain("Standard route");
  });

  it("renders disabled reasons for unavailable candidates", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
      />
    );

    expect(markup).toContain("Deep route");
    expect(markup).toContain("Needs advanced runtime");
    expect(markup).toContain("disabled");
  });

  it("renders selected route copy with takeover and stage counts", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="fast-route"
        locale="en-US"
        onSelect={() => {}}
      />
    );

    expect(markup).toContain("Selected route: Fastest route");
    expect(markup).toContain("Takeover points 1");
    expect(markup).toContain("Stages 4");
  });

  it("renders horizontal comparison metrics for route candidates", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
      />
    );

    expect(markup).toContain("Compare");
    expect(markup).toContain("Speed");
    expect(markup).toContain("Stability");
    expect(markup).toContain("Depth");
    expect(markup).toContain("Risk");
    expect(markup).toContain("Cost");
    expect(markup).toContain("Takeover");
    expect(markup).toContain("Fastest");
    expect(markup).toContain("Balanced");
    expect(markup).toContain("Slower");
  });

  it("marks route reveal order and reduced-motion fallback for candidate cards", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
      />
    );

    expect(markup).toContain('data-motion="route-plan-stagger-reveal"');
    expect(markup).toContain('data-reduced-motion="route-plan-static"');
    expect(markup).toContain('data-motion="route-candidate-list-stagger"');
    expect(markup).toContain('data-reveal-index="0"');
    expect(markup).toContain('data-reveal-index="1"');
    expect(markup).toContain('data-reveal-index="2"');
    expect(markup).toContain('data-reduced-motion="route-candidate-static"');
    expect(markup).toContain("motion-reduce:transition-none");
  });

  it("renders restore and confirm route action states", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="fast-route"
        locale="en-US"
        onSelect={() => {}}
        onConfirmRoute={() => {}}
      />
    );

    expect(markup).toContain("Restore recommended route");
    expect(markup).toContain("Confirm route and execute");
    expect(markup).not.toContain("Confirming route...");
  });

  it("renders confirming route copy when confirmation is in progress", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
        onConfirmRoute={() => {}}
        confirming
      />
    );

    expect(markup).toContain("Confirming route...");
  });

  it("keeps desktop panel presentation as the default", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
        onConfirmRoute={() => {}}
      />
    );

    expect(markup).toContain('data-testid="route-planning-overlay"');
    expect(markup).toContain('data-presentation="panel"');
    expect(markup).toContain('data-bottom-dock-safe="true"');
    expect(markup).toContain('data-bottom-dock-clearance="panel-contained"');
    expect(markup).toContain("max-h-[min(42vh,360px)]");
    expect(markup).toContain("overscroll-contain");
    expect(markup).not.toContain("route-planning-bottom-sheet");
  });

  it("renders mobile bottom sheet markers, safe-area padding, and sticky actions", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="standard-route"
        locale="en-US"
        onSelect={() => {}}
        onConfirmRoute={() => {}}
        presentation="bottom-sheet"
      />
    );

    expect(markup).toContain('data-presentation="bottom-sheet"');
    expect(markup).toContain('data-bottom-dock-safe="true"');
    expect(markup).toContain(
      'data-bottom-dock-clearance="var(--autopilot-bottom-dock-clearance,180px)"'
    );
    expect(markup).toContain("route-planning-bottom-sheet");
    expect(markup).toContain(
      "calc(100svh-var(--autopilot-bottom-dock-clearance,180px)-env(safe-area-inset-top)-env(safe-area-inset-bottom))"
    );
    expect(markup).toContain("env(safe-area-inset-bottom)");
    expect(markup).toContain("overscroll-contain");
    expect(markup).toContain('data-testid="route-planning-bottom-sheet-handle"');
    expect(markup).toContain('data-bottom-sheet-actions="sticky"');
    expect(markup).toContain("Confirm route and execute");
  });

  it("compresses mobile route cards into a horizontal candidate rail", () => {
    const markup = renderToStaticMarkup(
      <RoutePlanningOverlay
        routePlan={makeRoutePlan()}
        selectedRouteId="fast-route"
        locale="en-US"
        onSelect={() => {}}
        presentation="bottom-sheet"
      />
    );

    expect(markup).toContain('data-testid="route-planning-candidate-list"');
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("snap-x");
    expect(markup).toContain("w-[min(78vw,260px)]");
    expect(markup).toContain("Fastest route");
    expect(markup).toContain("Standard route");
    expect(markup).toContain("Deep route");
  });
});
