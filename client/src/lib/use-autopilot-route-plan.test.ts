import { describe, expect, it } from "vitest";

import {
  buildRouteSelectionEvidenceEvent,
  buildFrontendAutopilotRoutePlan,
  readRouteSelectionAliases,
  toCandidateRoute,
  useAutopilotRoutePlan,
} from "./use-autopilot-route-plan";

const completeBrief =
  "Ship the launch report by Friday with rollback plan, success metrics, and clear deliverables.";

describe("buildFrontendAutopilotRoutePlan", () => {
  it("selects the explicit route when it is available", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: completeBrief,
      selectedRouteId: "fast-route",
      runtimeMode: "advanced",
    });

    expect(model.selectedRouteId).toBe("fast-route");
    expect(model.selectedFrom).toBe("explicit");
    expect(model.canStart).toBe(true);
    expect(model.recommendedCandidate.id).toBe("standard-route");
  });

  it("falls back through legacy selectedCandidateId before recommendation", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: completeBrief,
      selectedCandidateId: "deep-route",
      runtimeMode: "advanced",
    });

    expect(model.selectedRouteId).toBe("deep-route");
    expect(model.selectedFrom).toBe("legacy-alias");
    expect(model.canStart).toBe(true);
  });

  it("ignores unavailable alias selections and records a warning", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: "Help me",
      routeId: "standard-route",
      runtimeMode: "advanced",
    });

    expect(model.selectedRouteId).toBe("clarify-first");
    expect(model.selectedFrom).toBe("recommended");
    expect(model.canStart).toBe(false);
    expect(model.warnings).toEqual([
      "Ignored unavailable route selection: standard-route",
    ]);
  });

  it("can source selection from frontend planning state", () => {
    const model = useAutopilotRoutePlan({
      text: completeBrief,
      runtimeMode: "advanced",
      frontendState: {
        planning: {
          selectedRouteId: "deep-route",
        },
      },
    });

    expect(model.selectedRouteId).toBe("deep-route");
    expect(model.selectedFrom).toBe("frontend-planning");
  });

  it("uses projection selectedRouteId ahead of planning selectedRouteId", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: completeBrief,
      runtimeMode: "advanced",
      frontendState: {
        planning: {
          selectedRouteId: "fast-route",
        },
        projection: {
          taskId: "task-runtime",
          selectedRouteId: "deep-route",
        },
      },
    });

    expect(model.selectedRouteId).toBe("deep-route");
    expect(model.selectedFrom).toBe("frontend-projection");
  });

  it("projects launch candidates into shared CandidateRoute-shaped records", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: completeBrief,
      selectedRouteId: "fast-route",
      runtimeMode: "advanced",
    });
    const fastCandidate = model.routePlan.candidates.find(
      candidate => candidate.id === "fast-route"
    );

    expect(fastCandidate).toBeTruthy();
    expect(toCandidateRoute(fastCandidate!, model.selectedRouteId)).toMatchObject({
      id: "fast-route",
      mode: "fast",
      label: "Fast route",
      selected: true,
      recommended: false,
      status: "pending",
      estimatedCost: "low",
      estimatedDuration: "short",
      takeoverLoad: "low",
      riskLevel: "medium",
      stageKeys: ["destination", "route", "execution", "evidence"],
    });
    expect(model.candidateRoutes).toHaveLength(model.routePlan.candidates.length);
    expect(model.selectedCandidateRoute).toMatchObject({
      id: "fast-route",
      selected: true,
    });
  });

  it("builds a minimal route selection evidence event for replay projection", () => {
    const model = buildFrontendAutopilotRoutePlan({
      text: completeBrief,
      selectedRouteId: "fast-route",
      runtimeMode: "advanced",
    });

    expect(model.routeSelectionEvidenceEvent).toMatchObject({
      eventType: "route.selected",
      actor: "user",
      fromRouteId: "standard-route",
      toRouteId: "fast-route",
      reason: "Route selected from explicit.",
    });
  });

  it("marks fallback route changes as replanned evidence", () => {
    const event = buildRouteSelectionEvidenceEvent({
      selectedRouteId: "standard-route",
      recommendedRouteId: "deep-route",
      selectedFrom: "recommended",
      warnings: ["Ignored unavailable route selection: deep-route"],
      occurredAt: "2026-04-26T00:00:00.000Z",
    });

    expect(event).toEqual({
      eventType: "route.replanned",
      at: "2026-04-26T00:00:00.000Z",
      actor: "planner",
      reason: "Ignored unavailable route selection: deep-route",
      fromRouteId: "deep-route",
      toRouteId: "standard-route",
    });
  });

  it("exposes route selection alias values for audit-friendly tests", () => {
    expect(
      readRouteSelectionAliases({
        selectedRouteId: "standard-route",
        selectedCandidateId: "deep-route",
        routeId: "",
      })
    ).toEqual(["standard-route", "deep-route"]);
  });
});
