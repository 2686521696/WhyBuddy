import { describe, expect, it } from "vitest";

import {
  buildAutopilotCockpitModel,
  useAutopilotCockpitModel,
} from "./use-autopilot-cockpit-model";

describe("buildAutopilotCockpitModel", () => {
  it("reads canonical route and destination fields", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        id: "task-1",
        destination: {
          goal: "Publish launch summary",
          request: "Prepare the release note.",
          confidence: {
            level: "high",
          },
          missingInfo: [],
          suggestedClarifications: [],
        },
        route: {
          selectedRouteId: "route-selected",
          recommendedRouteId: "route-recommended",
          selection: {
            status: "user-selected",
            locked: true,
          },
          candidateRoutes: [{ id: "route-selected" }, { id: "route-recommended" }],
        },
        execution: {
          status: "running",
          progressPercent: 42,
        },
      },
    });

    expect(model.destination).toMatchObject({
      goal: "Publish launch summary",
      request: "Prepare the release note.",
      lockState: null,
      confidenceLevel: "high",
    });
    expect(model.route).toMatchObject({
      selectedRouteId: "route-selected",
      recommendedRouteId: "route-recommended",
      routeSelectionStatus: "user-selected",
      locked: true,
      candidateCount: 2,
    });
    expect(model.projection).toMatchObject({
      taskId: "task-1",
      status: "running",
      progressPercent: 42,
    });
    expect(model.warnings).toEqual([]);
  });

  it("falls back through selectedRouteId aliases from evidence and explanation", () => {
    const model = useAutopilotCockpitModel({
      autopilotSummary: {
        destinationSummary: "Fallback destination",
        route: {
          recommendedRouteId: "route-recommended",
        },
        evidence: {
          correlation: {
            selectedRouteId: "route-from-evidence",
          },
        },
        explanation: {
          currentState: {
            routeSelectionStatus: "replanned",
          },
        },
      },
    });

    expect(model.destination.goal).toBe("Fallback destination");
    expect(model.route.selectedRouteId).toBe("route-from-evidence");
    expect(model.route.routeSelectionStatus).toBe("replanned");
    expect(model.warnings).toEqual([]);
  });

  it("falls back through destination missing-info and clarification aliases", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          title: "Clarify customer impact",
          missingInformation: ["customer tier"],
          clarificationQuestions: ["Which customer tier is in scope?"],
          readiness: "medium",
        },
        route: {
          recommendedRouteId: "route-safe",
        },
      },
    });

    expect(model.destination).toMatchObject({
      goal: "Clarify customer impact",
      confidenceLevel: "medium",
      missingInfo: ["customer tier"],
      suggestedClarifications: ["Which customer tier is in scope?"],
    });
    expect(model.route).toMatchObject({
      selectedRouteId: null,
      recommendedRouteId: "route-safe",
    });
    expect(model.warnings).toEqual([
      "Route selection is missing; falling back to recommendation only.",
    ]);
  });

  it("surfaces confirmed destination lock state and parser-backed goal fields", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          goal: "Ship the governed release brief",
          confirmedAt: "2026-04-26T10:00:00.000Z",
          subgoals: ["Summarize launch scope"],
          requirements: {
            constraints: ["Use internal evidence only"],
            successCriteria: ["Release owner can approve without follow-up"],
          },
          parser: {
            deliverables: ["release-brief.md"],
          },
        },
      },
    });

    expect(model.destination).toMatchObject({
      goal: "Ship the governed release brief",
      lockState: "locked",
      confirmedAt: "2026-04-26T10:00:00.000Z",
      subGoals: ["Summarize launch scope"],
      constraints: ["Use internal evidence only"],
      successCriteria: ["Release owner can approve without follow-up"],
      deliverables: ["release-brief.md"],
    });
  });

  it("accepts parseMissionDestination-style mapped aliases for destination lists", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          goal: "Finalize partner launch readiness",
        },
        normalizedGoal: {
          expectedDeliverables: ["readiness-report.md"],
        },
        mappedMissionContext: {
          reviewInput: {
            constraints: ["Use approved evidence only"],
            successCriteria: ["Partner owner can approve the report"],
          },
        },
        mappedWorkflowInput: {
          plannerInput: {
            constraints: ["No production changes"],
            successCriteria: ["Launch risks have owners"],
          },
        },
      },
    });

    expect(model.destination).toMatchObject({
      goal: "Finalize partner launch readiness",
      constraints: ["Use approved evidence only", "No production changes"],
      successCriteria: [
        "Partner owner can approve the report",
        "Launch risks have owners",
      ],
      deliverables: ["readiness-report.md"],
    });
  });

  it("normalizes structured parser destination arrays into preview-safe text", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          goal: "Prepare migration checklist",
          parser: {
            constraints: [
              { value: "Keep rollout reversible", dimension: "governance" },
            ],
            successCriteria: [
              { description: "Ops can execute without follow-up" },
            ],
            deliverables: [{ title: "migration-checklist.md" }],
          },
        },
      },
    });

    expect(model.destination.constraints).toEqual([
      "Keep rollout reversible",
    ]);
    expect(model.destination.successCriteria).toEqual([
      "Ops can execute without follow-up",
    ]);
    expect(model.destination.deliverables).toEqual([
      "migration-checklist.md",
    ]);
  });

  it("normalizes mixed destination aliases without dropping cockpit fields", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          destination_goal: "Ship partner readiness",
          user_request: "Prepare the readiness packet.",
          lock_state: "needs_clarification",
          updated_at: "2026-04-26T11:00:00.000Z",
          sub_goals: [{ title: "Summarize launch scope" }],
          constraint: "Use approved evidence only",
          success_criteria: [{ description: "Partner owner can approve." }],
          deliverable: "readiness-summary.md",
          missing_info: [{ item: "Partner approver" }],
          suggested_clarifications: [
            { question: "Who is the partner approver?" },
          ],
        },
        deliverables: ["risk-register.md"],
        outputs: {
          deliverable: { name: "approval-packet.md" },
        },
      },
    });

    expect(model.destination).toMatchObject({
      goal: "Ship partner readiness",
      request: "Prepare the readiness packet.",
      lockState: "needs-reconfirm",
      modifiedAt: "2026-04-26T11:00:00.000Z",
      subGoals: ["Summarize launch scope"],
      constraints: ["Use approved evidence only"],
      successCriteria: ["Partner owner can approve."],
      deliverables: [
        "readiness-summary.md",
        "approval-packet.md",
        "risk-register.md",
      ],
      missingInfo: ["Partner approver"],
      suggestedClarifications: ["Who is the partner approver?"],
    });
    expect(model.warnings).toEqual([]);
  });

  it("keeps destination fallback narrow when only route recommendation exists", () => {
    const model = buildAutopilotCockpitModel({
      frontendState: {
        draft: {
          destinationText: "Draft launch plan",
        },
      },
      autopilotSummary: {
        route: {
          recommendedRouteId: "route-safe",
        },
      },
    });

    expect(model.destination.goal).toBe("Draft launch plan");
    expect(model.destination.lockState).toBeNull();
    expect(model.destination.constraints).toEqual([]);
    expect(model.destination.successCriteria).toEqual([]);
    expect(model.destination.deliverables).toEqual([]);
    expect(model.route.recommendedRouteId).toBe("route-safe");
  });

  it("uses the same destination fallback before and after projection handoff", () => {
    const input = {
      frontendState: {
        draft: {
          destinationText: "Draft launch plan",
        },
        planning: {
          lockedRouteId: "route-safe",
        },
      },
      autopilotSummary: {
        route: {
          selectedRouteId: "route-safe",
        },
      },
    };

    const previewModel = buildAutopilotCockpitModel(input);
    const detailModel = buildAutopilotCockpitModel({
      ...input,
      frontendState: {
        ...input.frontendState,
        projection: {
          taskId: "task-1",
          status: "active",
          progressPercent: 20,
        },
      },
    });

    expect(previewModel.destination.goal).toBe("Draft launch plan");
    expect(detailModel.destination.goal).toBe("Draft launch plan");
    expect(detailModel.route.selectedRouteId).toBe("route-safe");
  });

  it("warns when missing info lacks clarification aliases", () => {
    const model = buildAutopilotCockpitModel({
      autopilotSummary: {
        destination: {
          goal: "Resolve approval",
          missing_info: ["approval owner"],
        },
      },
    });

    expect(model.destination.missingInfo).toEqual(["approval owner"]);
    expect(model.destination.suggestedClarifications).toEqual([]);
    expect(model.warnings).toEqual([
      "Missing info exists without clarification aliases.",
    ]);
  });

  it("uses frontend state when no summary is available", () => {
    const model = buildAutopilotCockpitModel({
      frontendState: {
        draft: {
          destinationText: "Draft a partner launch plan",
        },
        planning: {
          selectedRouteId: "deep-route",
        },
        projection: {
          taskId: "task-projection",
          status: "active",
          progressPercent: 67,
        },
      },
    });

    expect(model.destination.goal).toBe("Draft a partner launch plan");
    expect(model.route.selectedRouteId).toBe("deep-route");
    expect(model.projection).toMatchObject({
      taskId: "task-projection",
      status: "active",
      progressPercent: 67,
      sourceLayer: "projection",
    });
  });
});
