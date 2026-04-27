import { describe, expect, expectTypeOf, it } from "vitest";

import {
  buildMissionAutopilotSummary,
  inferMissionAutopilotDriveState,
  parseMissionDestination,
} from "../mission/autopilot.js";
import type {
  MissionAutopilotParsedDestination as ApiMissionAutopilotParsedDestination,
  MissionAutopilotBindingsSummary as ApiMissionAutopilotBindingsSummary,
  MissionAutopilotEvidenceTimelineItem as ApiMissionAutopilotEvidenceTimelineItem,
  MissionAutopilotEvidenceSummary as ApiMissionAutopilotEvidenceSummary,
  MissionAutopilotExplanationSummary as ApiMissionAutopilotExplanationSummary,
  MissionAutopilotExplanationSource as ApiMissionAutopilotExplanationSource,
  MissionAutopilotRecoverySummary as ApiMissionAutopilotRecoverySummary,
  MissionAutopilotRouteStatus as ApiMissionAutopilotRouteStatus,
  MissionAutopilotRouteSummary as ApiMissionAutopilotRouteSummary,
  MissionAutopilotTakeoverSummary as ApiMissionAutopilotTakeoverSummary,
} from "../mission/api.js";
import type { MissionRecord } from "../mission/contracts.js";
import type {
  MissionAutopilotParsedDestination as BarrelMissionAutopilotParsedDestination,
  MissionAutopilotBindingsSummary as BarrelMissionAutopilotBindingsSummary,
  MissionAutopilotEvidenceTimelineItem as BarrelMissionAutopilotEvidenceTimelineItem,
  MissionAutopilotEvidenceSummary as BarrelMissionAutopilotEvidenceSummary,
  MissionAutopilotExplanationSummary as BarrelMissionAutopilotExplanationSummary,
  MissionAutopilotExplanationSource as BarrelMissionAutopilotExplanationSource,
  MissionAutopilotRecoverySummary as BarrelMissionAutopilotRecoverySummary,
  MissionAutopilotRouteStatus as BarrelMissionAutopilotRouteStatus,
  MissionAutopilotRouteSummary as BarrelMissionAutopilotRouteSummary,
  MissionAutopilotTakeoverSummary as BarrelMissionAutopilotTakeoverSummary,
} from "../mission/index.js";

function makeMission(overrides?: Partial<MissionRecord>): MissionRecord {
  const now = Date.now();
  return {
    id: "mission-1",
    kind: "chat",
    title: "Prepare product review",
    sourceText: "Prepare a product review and delivery package.",
    status: "running",
    progress: 48,
    currentStageKey: "plan",
    stages: [
      { key: "receive", label: "Receive task", status: "done", startedAt: now - 20_000 },
      { key: "understand", label: "Understand request", status: "done", startedAt: now - 18_000 },
      { key: "plan", label: "Build execution plan", status: "running", startedAt: now - 12_000 },
      { key: "provision", label: "Provision execution runtime", status: "pending" },
      { key: "execute", label: "Run execution", status: "pending" },
      { key: "finalize", label: "Finalize mission", status: "pending" },
    ],
    createdAt: now - 30_000,
    updatedAt: now,
    events: [
      {
        type: "progress",
        message: "Planner is assembling the route.",
        time: now - 1_000,
        source: "mission-core",
      },
    ],
    operatorState: "active",
    operatorActions: [],
    attempt: 1,
    artifacts: [],
    ...overrides,
  };
}

describe("mission autopilot builder", () => {
  it("infers planning state from the plan stage", () => {
    const mission = makeMission();

    expect(inferMissionAutopilotDriveState(mission)).toBe("planning");
  });

  it("builds a stable projection for an active mission", () => {
    const mission = makeMission({
      projection: {
        workflowId: "wf-123",
        instanceId: "wf-123",
      },
      artifacts: [{ kind: "file", name: "review.md", path: "artifacts/review.md" }],
      executor: {
        name: "lobster",
        jobId: "job-123",
        status: "running",
      },
      agentCrew: [
        {
          id: "agent-research",
          name: "Research Worker",
          role: "worker",
          status: "working",
        },
      ],
      workPackages: [
        {
          id: "pkg-review",
          workerId: "agent-research",
          title: "Draft the product review",
          assignee: "Research Worker",
          deliverable: "review.md",
          status: "running",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary).toMatchObject({
      version: "client-autopilot-projection/v1",
      source: "client-mission-projection",
      destination: {
        id: mission.id,
        goal: mission.title,
      },
      route: {
        id: "wf-123",
        mode: "fast",
        currentStageKey: "plan",
        currentStageLabel: "Build execution plan",
        recommendedRouteId: "wf-123:fast",
        selectedRouteId: "wf-123:fast",
        selectionStatus: "recommended",
        selectionLocked: false,
        locked: false,
      },
      driveState: {
        state: "planning",
        blocked: false,
        waitingForUser: false,
      },
      fleet: {
        activeRoleCount: 2,
      },
      execution: {
        currentStepKey: "plan",
        currentStepStatus: "running",
      },
      recovery: {
        state: "healthy",
        deviationCategory: "none",
        needsHuman: false,
      },
      evidence: {
        artifactCount: 1,
        latestEventType: "progress",
        trustLevel: "verified",
        correlation: {
          missionId: mission.id,
          workflowId: "wf-123",
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
        },
      },
      explanation: {
        telemetrySignals: [
          "mission.status:running",
          "drive.state:planning",
          "recovery.state:healthy",
        ],
      },
      bindings: {
        missionId: mission.id,
        workflowId: "wf-123",
        executorJobId: "job-123",
      },
    });
    expect(summary.route.stages).toHaveLength(6);
    expect(summary.route.label).toBe("Build execution plan route");
    expect(summary.route.riskPoints).toEqual([]);
    expect(summary.route.takeoverPointIds).toEqual([]);
    expect(summary.destination.taskType).toBe("analysis");
    expect(summary.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["generation"])
    );
    expect(summary.destination.subGoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Draft the product review",
          source: "work-package",
          status: "running",
        }),
      ])
    );
    expect(summary.destination.deliverables).toContain("review.md");
    expect(summary.destination.confidence).toMatchObject({
      level: "medium",
      reason: "Source text provides the current destination intent.",
      signals: expect.arrayContaining([
        "artifacts-present",
        "runtime-events-present",
        "source-text-present",
      ]),
    });
    expect(summary.destination.missingInfoDetails).toEqual([]);
    expect(summary.route.candidateRoutes).toHaveLength(3);
    expect(summary.route.candidateRoutes.map(route => route.id)).toEqual([
      "wf-123:fast",
      "wf-123:standard",
      "wf-123:deep",
    ]);
    expect(summary.route.selected).toMatchObject({
      id: "wf-123:fast",
      mode: "fast",
      status: "running",
      title: "Fast route",
      summary: "Favor shorter execution chains and minimal confirmations.",
      selected: true,
    });
    expect(summary.route.selectedRoute).toMatchObject({
      id: "wf-123:fast",
      name: "Fast route",
      reason: "Derived from mission intent, current risk, and runtime readiness.",
    });
    expect(summary.fleet.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleType: "executor",
          boundAgents: ["Research Worker"],
          boundExecutors: ["job-123"],
          currentFocus: "Draft the product review",
        }),
      ])
    );
    expect(summary.route.selection).toMatchObject({
      status: "recommended",
      mode: "planner_default",
      locked: false,
      canSwitch: true,
      switchRequiresConfirmation: false,
      changedBy: "planner",
    });
    expect(summary.route.evidence).toMatchObject({
      lastEventType: "route.selected",
    });
    expect(summary.route.evidence.events).toEqual([
      expect.objectContaining({
        eventType: "route.recommended",
        actor: "planner",
        toRouteId: "wf-123:fast",
      }),
      expect.objectContaining({
        eventType: "route.selected",
        actor: "planner",
        toRouteId: "wf-123:fast",
      }),
    ]);
    expect(summary.route.replan).toMatchObject({
      active: false,
      reason: null,
      fromRouteId: null,
      toRouteId: null,
      triggeredBy: null,
    });
    expect(summary.explanation.currentState).toMatchObject({
      summary: "Planner is assembling the route.",
      driveState: "planning",
      missionStatus: "running",
      currentStageKey: "plan",
      currentStageLabel: "Build execution plan",
      workflowStatus: null,
      workflowStage: null,
      routeSelectionStatus: "recommended",
      selectedRouteId: "wf-123:fast",
      correlationTimelineId: `${mission.id}:timeline`,
      sources: expect.arrayContaining(["mission-runtime"]),
    });
    expect(summary.execution.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run",
          reason: "Continue executing Build execution plan.",
        }),
        expect.objectContaining({
          type: "wait",
          reason:
            "Pause route progression until runtime or human signals unblock execution.",
        }),
        expect.objectContaining({
          type: "replan",
          reason: "Adapt the active route before more work is dispatched.",
        }),
      ])
    );
    expect(summary.explanation.recommendationDetails).toEqual([
      expect.objectContaining({
        kind: "route",
        source: "route-planner",
        routeId: "wf-123:fast",
        summary: "Derived from mission intent, current risk, and runtime readiness.",
        routeSelectionStatus: "recommended",
        correlationTimelineId: `${mission.id}:timeline`,
      }),
    ]);
    expect(summary.explanation.remainingSteps).toMatchObject({
      currentStepKey: "plan",
      currentStepLabel: "Build execution plan",
      parallelBranchCount: 1,
      replanChangeSummary: null,
      selectedRouteId: "wf-123:fast",
      routeSelectionStatus: "recommended",
    });
    expect(summary.explanation.remainingSteps?.pendingSteps).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        key: "plan",
        label: "Build execution plan",
        status: "running",
        isCurrent: true,
      }),
      expect.objectContaining({
        key: "provision",
        label: "Provision execution runtime",
        status: "pending",
      }),
      expect.objectContaining({
        key: "execute",
        label: "Run execution",
        status: "pending",
      }),
      ])
    );
    expect(summary.execution.availableActions.map(action => action.type)).toContain(
      "replan"
    );
    expect(summary.evidence.timeline.length).toBeGreaterThan(0);
    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: "wf-123",
      replayId: null,
      sessionId: null,
      timelineId: `${mission.id}:timeline`,
      routeIds: ["wf-123:fast", "wf-123:standard", "wf-123:deep"],
      recommendedRouteId: "wf-123:fast",
      selectedRouteId: "wf-123:fast",
      routeStageKeys: ["receive", "understand", "plan", "provision", "execute", "finalize"],
      currentStepKey: "plan",
      decisionIds: [],
      operatorActionIds: [],
      auditEventIds: [],
      lineageIds: [],
    });
    expect(summary.evidence.correlation.runtimeEventIds).toEqual(
      expect.arrayContaining([`${mission.id}:event:${mission.events[0]?.time}:progress`])
    );
  });

  it("surfaces takeover context for waiting missions", () => {
    const mission = makeMission({
      status: "waiting",
      progress: 66,
      waitingFor: "budget approval",
      decision: {
        decisionId: "decision-budget-approval",
        prompt: "Please approve the budget before execution continues.",
        options: [
          { id: "approve", label: "Approve" },
          { id: "reject", label: "Reject" },
        ],
      },
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.driveState.state).toBe("takeover-required");
    expect(summary.takeover).toMatchObject({
      status: "pending",
      required: true,
      blocking: true,
      type: "budget",
      prompt: "Please approve the budget before execution continues.",
      decisionId: "decision-budget-approval",
      urgency: "medium",
    });
    expect(summary.route.takeoverPointIds).toEqual(["decision-budget-approval"]);
    expect(summary.route.riskPoints).toContain("Awaiting budget approval");
    expect(summary.takeover.options).toEqual([
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
    ]);
    expect(summary.destination.missingInfo).toEqual(["budget approval"]);
    expect(summary.destination.taskType).toBe("coordination");
    expect(summary.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["generation"])
    );
    expect(summary.destination.confidence).toMatchObject({
      level: "medium",
      reason: "Pending clarification: budget approval",
      signals: expect.arrayContaining([
        "waiting-for-input",
        "decision-prompt-present",
        "runtime-events-present",
      ]),
    });
    expect(summary.destination.missingInfoDetails).toEqual([
      expect.objectContaining({
        item: "budget approval",
        impact: "Mission progress remains paused until this input is resolved.",
        blocking: true,
        clarification: "Please approve the budget before execution continues.",
      }),
    ]);
    expect(summary.destination.suggestedClarifications).toEqual([
      "Please approve the budget before execution continues.",
    ]);
    expect(summary.fleet.activeRoleCount).toBe(2);
    expect(summary.route.mode).toBe("deep");
    expect(summary.route.locked).toBe(true);
    expect(summary.route.selectionStatus).toBe("alternatives-available");
    expect(summary.route.selectionLocked).toBe(true);
    expect(summary.route.selected).toMatchObject({
      id: "mission-1:deep",
      mode: "deep",
      selected: true,
      locked: true,
    });
    expect(summary.route.selection).toMatchObject({
      status: "alternatives-available",
      mode: "planner_default",
      locked: true,
      canSwitch: false,
      switchRequiresConfirmation: true,
      changedBy: "user",
      changedReason: "budget approval",
    });
    expect(summary.route.evidence.events).toEqual([
      expect.objectContaining({
        eventType: "route.recommended",
        actor: "planner",
        toRouteId: "mission-1:deep",
      }),
      expect.objectContaining({
        eventType: "route.selected",
        actor: "user",
        toRouteId: "mission-1:deep",
      }),
      expect.objectContaining({
        eventType: "route.locked",
        actor: "user",
        toRouteId: "mission-1:deep",
      }),
    ]);
    expect(summary.route.replan.active).toBe(false);
    expect(summary.recovery).toMatchObject({
      state: "takeover-required",
      deviationCategory: "governance-deviation",
      needsHuman: true,
    });
    expect(summary.explanation.currentState).toMatchObject({
      summary: "budget approval",
      driveState: "takeover-required",
      missionStatus: "waiting",
      currentStageKey: "plan",
      currentStageLabel: "Build execution plan",
      workflowStatus: null,
      workflowStage: null,
      routeSelectionStatus: "alternatives-available",
      selectedRouteId: "mission-1:deep",
      correlationTimelineId: `${mission.id}:timeline`,
      sources: expect.arrayContaining(["mission-runtime", "takeover-state"]),
    });
    expect(summary.execution.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "wait",
          reason: "Hold the current stage until budget approval is resolved.",
        }),
        expect.objectContaining({
          type: "resume",
          reason: "Resume once budget approval is resolved.",
        }),
        expect.objectContaining({
          type: "replan",
          reason: "Replan the active route around budget approval.",
        }),
      ])
    );
    expect(summary.explanation.recommendationDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route",
          routeId: "mission-1:deep",
          source: "route-planner",
          decisionId: "decision-budget-approval",
          summary: "High-risk or human-gated missions benefit from deeper governance.",
          routeSelectionStatus: "alternatives-available",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
        expect.objectContaining({
          kind: "action",
          actionType: "wait",
          takeoverType: "budget",
          decisionId: "decision-budget-approval",
          source: "recovery-engine",
          routeSelectionStatus: "alternatives-available",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
        expect.objectContaining({
          kind: "takeover",
          takeoverType: "budget",
          decisionId: "decision-budget-approval",
          source: "takeover-state",
          summary: "Please approve the budget before execution continues.",
          routeSelectionStatus: "alternatives-available",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
      ])
    );
    expect(summary.explanation.remainingSteps).toMatchObject({
      currentStepKey: "plan",
      currentStepLabel: "Build execution plan",
      parallelBranchCount: 0,
      replanChangeSummary: null,
      selectedRouteId: "mission-1:deep",
      routeSelectionStatus: "alternatives-available",
    });
    expect(summary.explanation.remainingSteps?.pendingSteps).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        key: "plan",
        label: "Build execution plan",
        status: "running",
        isCurrent: true,
      }),
      expect.objectContaining({
        key: "provision",
        label: "Provision execution runtime",
        status: "pending",
      }),
      expect.objectContaining({
        key: "execute",
        label: "Run execution",
        status: "pending",
      }),
      ])
    );
    expect(summary.explanation.recommendationReasons[0]).toContain(
      "High-risk or human-gated missions"
    );
    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: mission.id,
      recommendedRouteId: "mission-1:deep",
      selectedRouteId: "mission-1:deep",
      currentStepKey: "plan",
      decisionIds: ["decision-budget-approval"],
      operatorActionIds: [],
      auditEventIds: [],
      lineageIds: [],
    });
  });

  it("projects blocked retries into recovery and evidence timeline", () => {
    const mission = makeMission({
      status: "failed",
      operatorState: "blocked",
      blocker: {
        reason: "Executor crashed twice and requires human follow-up.",
        createdAt: Date.now() - 2_000,
      },
      attempt: 3,
      operatorActions: [
        {
          id: "op-1",
          action: "retry",
          createdAt: Date.now() - 5_000,
          result: "completed",
          detail: "Retry requested.",
        },
        {
          id: "op-2",
          action: "escalate",
          createdAt: Date.now() - 1_000,
          result: "accepted",
          detail: "Escalated for operator follow-up.",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.driveState.state).toBe("blocked");
    expect(summary.execution.currentStepStatus).toBe("failed");
    expect(summary.route.label).toBe("Build execution plan route");
    expect(summary.route.riskPoints).toEqual([
      "Executor crashed twice and requires human follow-up.",
      "Mission failed and needs recovery",
      "Operator intervention is blocking progress",
    ]);
    expect(summary.route.selectionStatus).toBe("replanned");
    expect(summary.route.selectionLocked).toBe(true);
    expect(summary.route.changeReason).toBe(
      "Executor crashed twice and requires human follow-up."
    );
    expect(summary.route.selection).toMatchObject({
      status: "replanned",
      mode: "runtime_replanned",
      locked: true,
      canSwitch: false,
      switchRequiresConfirmation: false,
      changedBy: "runtime",
      changedReason: "Executor crashed twice and requires human follow-up.",
    });
    expect(summary.route.evidence.events).toEqual([
      expect.objectContaining({
        eventType: "route.recommended",
        actor: "planner",
      }),
      expect.objectContaining({
        eventType: "route.replanned",
        actor: "runtime",
        toRouteId: "mission-1:deep",
      }),
      expect.objectContaining({
        eventType: "route.locked",
        actor: "runtime",
        toRouteId: "mission-1:deep",
      }),
    ]);
    expect(summary.route.replan).toMatchObject({
      active: true,
      reason: "Executor crashed twice and requires human follow-up.",
      fromRouteId: null,
      toRouteId: "mission-1:deep",
      triggeredBy: "runtime",
    });
    expect(summary.takeover.status).toBe("required");
    expect(summary.takeover.required).toBe(true);
    expect(summary.takeover.blocking).toBe(true);
    expect(summary.takeover.reason).toBe(
      "Executor crashed twice and requires human follow-up."
    );
    expect(summary.fleet.activeRoleCount).toBe(0);
    expect(summary.recovery).toMatchObject({
      state: "takeover-required",
      deviationCategory: "state-block",
      attemptedActions: ["retry", "escalate"],
      needsHuman: true,
    });
    expect(summary.evidence.trustLevel).toBe("partial");
    expect(summary.evidence.gaps).toContain("No artifacts captured yet");
    expect(summary.evidence.timeline.some(item => item.type === "operator_action")).toBe(
      true
    );
    expect(summary.destination.missingInfo).toEqual([
      "Executor crashed twice and requires human follow-up.",
    ]);
    expect(summary.destination.taskType).toBe("analysis");
    expect(summary.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["generation"])
    );
    expect(summary.destination.confidence).toMatchObject({
      level: "low",
      reason: "Executor crashed twice and requires human follow-up.",
      signals: expect.arrayContaining([
        "blocked-by-runtime",
        "runtime-events-present",
        "source-text-present",
      ]),
    });
    expect(summary.destination.missingInfoDetails).toEqual([
      expect.objectContaining({
        item: "Executor crashed twice and requires human follow-up.",
        impact: "Runtime recovery and execution handoff remain blocked.",
        blocking: true,
        clarification: null,
      }),
    ]);
    expect(summary.destination.suggestedClarifications).toBeUndefined();
    expect(summary.explanation.currentState).toMatchObject({
      summary: "Executor crashed twice and requires human follow-up.",
      driveState: "blocked",
      missionStatus: "failed",
      currentStageKey: "plan",
      currentStageLabel: "Build execution plan",
      workflowStatus: null,
      workflowStage: null,
      routeSelectionStatus: "replanned",
      selectedRouteId: "mission-1:deep",
      correlationTimelineId: `${mission.id}:timeline`,
      sources: expect.arrayContaining(["mission-runtime", "recovery-engine"]),
    });
    expect(summary.execution.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "retry",
          reason:
            "Retry after addressing blocker: Executor crashed twice and requires human follow-up.",
        }),
        expect.objectContaining({
          type: "escalate",
          reason:
            "Escalate for human review because Executor crashed twice and requires human follow-up.",
        }),
      ])
    );
    expect(summary.explanation.recommendationDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route",
          routeId: "mission-1:deep",
          source: "route-planner",
          routeSelectionStatus: "replanned",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
        expect.objectContaining({
          kind: "action",
          actionType: "retry",
          source: "recovery-engine",
          routeSelectionStatus: "replanned",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
        expect.objectContaining({
          kind: "replan",
          actionType: "replan",
          routeId: "mission-1:deep",
          source: "recovery-engine",
          summary: "Executor crashed twice and requires human follow-up.",
          routeSelectionStatus: "replanned",
          correlationTimelineId: `${mission.id}:timeline`,
        }),
      ])
    );
    expect(summary.explanation.remainingSteps).toMatchObject({
      currentStepKey: "plan",
      currentStepLabel: "Build execution plan",
      parallelBranchCount: 0,
      replanChangeSummary: "Executor crashed twice and requires human follow-up.",
      selectedRouteId: "mission-1:deep",
      routeSelectionStatus: "replanned",
    });
    expect(summary.explanation.remainingSteps?.pendingSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "plan",
          label: "Build execution plan",
          status: "running",
          isCurrent: true,
        }),
        expect.objectContaining({
          key: "provision",
          label: "Provision execution runtime",
          status: "pending",
        }),
        expect.objectContaining({
          key: "execute",
          label: "Run execution",
          status: "pending",
        }),
      ])
    );
    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: mission.id,
      recommendedRouteId: "mission-1:deep",
      selectedRouteId: "mission-1:deep",
      currentStepKey: "plan",
      decisionIds: [],
      operatorActionIds: ["op-1", "op-2"],
      auditEventIds: [],
      lineageIds: [],
    });
  });

  it("keeps evidence trust conservative for queued missions without runtime proof", () => {
    const mission = makeMission({
      status: "queued",
      progress: 0,
      currentStageKey: undefined,
      artifacts: [],
      events: [],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.route.changeReason).toBeNull();
    expect(summary.route.selection.changedReason).toBeNull();
    expect(summary.evidence).toMatchObject({
      eventCount: 0,
      artifactCount: 0,
      latestEventType: null,
      trustLevel: "unverified",
      gaps: expect.arrayContaining([
        "No artifacts captured yet",
        "No runtime events captured yet",
      ]),
    });
    expect(summary.evidence.timeline).toEqual([]);
    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: mission.id,
      timelineId: `${mission.id}:timeline`,
      routeIds: ["mission-1:fast", "mission-1:standard", "mission-1:deep"],
      routeStageKeys: ["receive", "understand", "plan", "provision", "execute", "finalize"],
      runtimeEventIds: [],
      decisionIds: [],
      operatorActionIds: [],
      auditEventIds: [],
      lineageIds: [],
    });
  });

  it("promotes resolved route-selection history into authoritative selected route state", () => {
    const submittedAt = Date.now() - 2_000;
    const mission = makeMission({
      status: "running",
      progress: 52,
      currentStageKey: "execute",
      decisionHistory: [
        {
          decisionId: "decision-route-selected",
          type: "multi-choice",
          prompt: "Choose the route to continue",
          options: [
            { id: "fast", label: "Fast route" },
            { id: "safe", label: "Safe route" },
          ],
          payload: {
            candidateRoutes: [
              {
                optionId: "fast",
                routeId: "mission-1:fast",
                label: "Fast route",
              },
              {
                optionId: "safe",
                routeId: "mission-1:safe",
                label: "Safe route",
              },
            ],
            recommendedRouteId: "mission-1:fast",
          },
          resolved: {
            optionId: "safe",
            optionLabel: "Safe route",
            freeText: "Need a safer route before publish.",
            metadata: {
              formData: {
                selectedRouteOptionId: "safe",
                selectedRouteLabel: "Safe route",
                selectedRouteId: "mission-1:safe",
                changedReason: "Need a safer route before publish.",
              },
            },
          },
          submittedAt,
          submittedBy: "operator@example.com",
          reason: "Need a safer route before publish.",
          stageKey: "execute",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.route.selectedRouteId).toBe("mission-1:safe");
    expect(summary.route.selected).toMatchObject({
      id: "mission-1:safe",
      label: "Safe route",
      selected: true,
      recommended: false,
    });
    expect(summary.route.selectedRoute).toMatchObject({
      id: "mission-1:safe",
      label: "Safe route",
      selected: true,
    });
    expect(summary.route.candidateRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mission-1:safe",
          label: "Safe route",
          selected: true,
          recommended: false,
        }),
      ])
    );
    expect(summary.route.selectionStatus).toBe("user-selected");
    expect(summary.route.selection).toMatchObject({
      status: "user-selected",
      mode: "user_selected",
      changedBy: "user",
      changedReason: "Need a safer route before publish.",
      changedAt: new Date(submittedAt).toISOString(),
    });
    expect(summary.route.evidence.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "route.selected",
          actor: "user",
          fromRouteId: "mission-1:fast",
          toRouteId: "mission-1:safe",
          reason: "Need a safer route before publish.",
        }),
      ])
    );
    expect(summary.evidence.correlation).toMatchObject({
      recommendedRouteId: "mission-1:fast",
      selectedRouteId: "mission-1:safe",
      decisionIds: ["decision-route-selected"],
    });
    expect(summary.explanation.currentState).toMatchObject({
      routeSelectionStatus: "user-selected",
      selectedRouteId: "mission-1:safe",
    });
    expect(summary.explanation.recommendationDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route",
          routeId: "mission-1:safe",
          routeSelectionStatus: "user-selected",
        }),
      ])
    );
    expect(summary.explanation.remainingSteps).toMatchObject({
      selectedRouteId: "mission-1:safe",
      routeSelectionStatus: "user-selected",
    });
  });

  it("promotes explicit route-selection replan intent into replanned route semantics", () => {
    const submittedAt = Date.now() - 1_750;
    const mission = makeMission({
      status: "running",
      progress: 56,
      currentStageKey: "execute",
      decisionHistory: [
        {
          decisionId: "decision-route-replanned",
          type: "multi-choice",
          prompt: "Choose the route to continue",
          options: [
            { id: "fast", label: "Fast route" },
            { id: "safe", label: "Safe route" },
          ],
          payload: {
            candidateRoutes: [
              {
                optionId: "fast",
                routeId: "mission-1:fast",
                label: "Fast route",
              },
              {
                optionId: "safe",
                routeId: "mission-1:safe",
                label: "Safe route",
              },
            ],
            recommendedRouteId: "mission-1:fast",
          },
          resolved: {
            optionId: "safe",
            optionLabel: "Safe route",
            freeText: "Need a safer route before publish.",
            metadata: {
              formData: {
                selectedRouteOptionId: "safe",
                selectedRouteLabel: "Safe route",
                selectedRouteId: "mission-1:safe",
                recommendedRouteId: "mission-1:fast",
                changedReason: "Need a safer route before publish.",
                replanRequested: true,
              },
            },
          },
          submittedAt,
          submittedBy: "operator@example.com",
          reason: "Need a safer route before publish.",
          stageKey: "execute",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.route.selectedRouteId).toBe("mission-1:safe");
    expect(summary.route.selectionStatus).toBe("replanned");
    expect(summary.route.selection).toMatchObject({
      status: "replanned",
      mode: "user_selected",
      changedBy: "user",
      changedReason: "Need a safer route before publish.",
      changedAt: new Date(submittedAt).toISOString(),
    });
    expect(summary.route.evidence).toMatchObject({
      lastEventType: "route.replanned",
    });
    expect(summary.route.evidence.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "route.replanned",
          actor: "user",
          fromRouteId: "mission-1:fast",
          toRouteId: "mission-1:safe",
          reason: "Need a safer route before publish.",
        }),
      ])
    );
    expect(summary.route.replan).toMatchObject({
      active: true,
      reason: "Need a safer route before publish.",
      fromRouteId: "mission-1:fast",
      toRouteId: "mission-1:safe",
      triggeredBy: "user",
    });
    expect(summary.evidence.correlation).toMatchObject({
      recommendedRouteId: "mission-1:fast",
      selectedRouteId: "mission-1:safe",
      decisionIds: ["decision-route-replanned"],
    });
    expect(summary.explanation.currentState).toMatchObject({
      routeSelectionStatus: "replanned",
      selectedRouteId: "mission-1:safe",
    });
    expect(summary.explanation.recommendationDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "route",
          routeId: "mission-1:safe",
          routeSelectionStatus: "replanned",
        }),
        expect.objectContaining({
          kind: "replan",
          routeId: "mission-1:safe",
          routeSelectionStatus: "replanned",
          source: "mission-runtime",
          summary: "Need a safer route before publish.",
        }),
      ])
    );
    expect(summary.explanation.remainingSteps).toMatchObject({
      selectedRouteId: "mission-1:safe",
      routeSelectionStatus: "replanned",
      replanChangeSummary: "Need a safer route before publish.",
    });
  });

  it("resolves selectedRouteId from decision payload candidateRoutes when formData keeps only option semantics", () => {
    const submittedAt = Date.now() - 1_500;
    const mission = makeMission({
      status: "running",
      progress: 57,
      currentStageKey: "execute",
      decisionHistory: [
        {
          decisionId: "decision-route-selected-payload-fallback",
          type: "multi-choice",
          prompt: "Choose the route to continue",
          options: [
            { id: "fast", label: "Fast route" },
            { id: "safe", label: "Safe route" },
          ],
          payload: {
            candidateRoutes: [
              {
                optionId: "fast",
                routeId: "mission-1:fast",
                label: "Fast route",
              },
              {
                optionId: "safe",
                routeId: "mission-1:safe",
                label: "Safe route",
              },
            ],
            recommendedRouteId: "mission-1:fast",
          },
          resolved: {
            optionId: "safe",
            optionLabel: "Safe route",
            freeText: "Use the safer route before external delivery.",
            metadata: {
              formData: {
                selectedRouteOptionId: "safe",
                changedReason: "Use the safer route before external delivery.",
              },
            },
          },
          submittedAt,
          submittedBy: "operator@example.com",
          reason: "Use the safer route before external delivery.",
          stageKey: "execute",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.route.selectedRouteId).toBe("mission-1:safe");
    expect(summary.route.selected).toMatchObject({
      id: "mission-1:safe",
      label: "Safe route",
      selected: true,
      recommended: false,
    });
    expect(summary.route.selectedRoute).toMatchObject({
      id: "mission-1:safe",
      label: "Safe route",
      selected: true,
    });
    expect(summary.route.selection).toMatchObject({
      status: "user-selected",
      mode: "user_selected",
      changedBy: "user",
      changedReason: "Use the safer route before external delivery.",
      changedAt: new Date(submittedAt).toISOString(),
    });
    expect(summary.route.evidence.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "route.selected",
          actor: "user",
          fromRouteId: "mission-1:fast",
          toRouteId: "mission-1:safe",
          reason: "Use the safer route before external delivery.",
        }),
      ])
    );
  });

  it("falls back to mixed destination task type when research and analysis signals tie", () => {
    const mission = makeMission({
      title: "Research and analyze the rollout path",
      sourceText: "Research the rollout path and analyze the delivery risks.",
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.destination.taskType).toBe("mixed");
    expect(summary.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["analysis", "research"])
    );
  });

  it("falls back to unknown destination task type when no stable signals exist", () => {
    const mission = makeMission({
      title: "Mission delta",
      sourceText: "Opaque token payload without recognizable execution hints.",
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.destination.taskType).toBe("unknown");
    expect(summary.destination.auxiliaryTaskTypes).toEqual([]);
  });

  it("extracts explicit success criteria and constraints from mission-derived text", () => {
    const mission = makeMission({
      title: "Prepare launch review package",
      sourceText: [
        "Prepare the release review package for the launch committee.",
        "Steps: collect architecture evidence; draft release deck; prepare committee notes.",
        "Success criteria: deliver architecture review deck; capture rollback plan.",
        "Constraints: use internal evidence only; keep output bilingual.",
        "Deadline: before Friday review.",
        "Budget: no paid vendor research.",
        "Output format: Markdown summary plus slide outline.",
        "Style: concise executive tone.",
        "Data scope: current launch train only.",
        "Tools: use repository artifacts only.",
        "Open questions: target committee owner; launch date.",
      ].join("\n"),
      summary:
        "Definition of done: committee can review the deck without follow-up questions.",
      decision: {
        prompt:
          "Requirements: keep customer names redacted before final delivery.",
        options: [{ id: "continue", label: "Continue" }],
      },
      securitySummary: {
        level: "restricted",
        user: "runner",
        networkMode: "offline",
        readonlyRootfs: true,
        memoryLimit: "1Gi",
        cpuLimit: "2",
        pidsLimit: 128,
      },
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.destination.subGoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "collect architecture evidence",
          source: "mission-text",
          status: null,
        }),
        expect.objectContaining({
          title: "draft release deck",
          source: "mission-text",
          status: null,
        }),
        expect.objectContaining({
          title: "prepare committee notes.",
          source: "mission-text",
          status: null,
        }),
      ])
    );
    expect(summary.destination.successCriteria).toEqual(
      expect.arrayContaining([
        "deliver architecture review deck",
        "capture rollback plan.",
        "committee can review the deck without follow-up questions.",
        "Requested output is drafted and ready for review.",
      ])
    );
    expect(summary.destination.constraints).toEqual(
      expect.arrayContaining([
        "Mission kind: chat",
        "Security level: restricted",
        "Network mode: offline",
        "Filesystem mode: readonly",
        "Memory limit: 1Gi",
        "CPU limit: 2",
        "use internal evidence only",
        "keep output bilingual.",
        "before Friday review.",
        "no paid vendor research.",
        "Markdown summary plus slide outline.",
        "concise executive tone.",
        "current launch train only.",
        "use repository artifacts only.",
        "keep customer names redacted before final delivery.",
      ])
    );
    expect(summary.destination.missingInfo).toEqual(
      expect.arrayContaining(["target committee owner", "launch date."])
    );
    expect(summary.destination.missingInfoDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "target committee owner",
          impact:
            "Mission can continue, but this clarification would improve delivery quality.",
          blocking: false,
          clarification: "Please clarify: target committee owner",
        }),
        expect.objectContaining({
          item: "launch date.",
          blocking: false,
          clarification: "Please clarify: launch date.",
        }),
      ])
    );
    expect(summary.destination.suggestedClarifications).toEqual([
      "Please clarify: target committee owner",
      "Please clarify: launch date.",
    ]);
  });

  it("parses a mission destination into source, goal, governance, clarification, and projection contracts", () => {
    const mission = makeMission({
      id: "destination-parser-contract",
      title: "Prepare launch committee deck",
      sourceText: [
        "Prepare a launch committee deck.",
        "Steps: collect architecture evidence; draft release deck; prepare committee notes.",
        "Success criteria: deliver architecture review deck; capture rollback plan.",
        "Constraints: use internal evidence only; keep output bilingual.",
        "Deadline: before Friday review.",
        "Budget: no paid vendor research.",
        "Output format: Markdown summary plus slide outline.",
        "Style: concise executive tone.",
        "Data scope: current launch train only.",
        "Tools: use repository artifacts only.",
        "Open questions: target committee owner; launch date.",
      ].join("\n"),
      summary:
        "Definition of done: committee can review the deck without follow-up questions.",
      artifacts: [
        {
          kind: "file",
          name: "launch-brief.md",
          path: "artifacts/launch-brief.md",
          description: "Draft launch brief",
        },
      ],
      projection: {
        workflowId: "wf-destination-parser",
        sourceApp: "workflow",
      },
      decision: {
        prompt:
          "Requirements: keep customer names redacted before final delivery.",
        options: [{ id: "continue", label: "Continue" }],
      },
      securitySummary: {
        level: "restricted",
        user: "runner",
        networkMode: "offline",
        readonlyRootfs: true,
        memoryLimit: "1Gi",
        cpuLimit: "2",
        pidsLimit: 128,
      },
    });

    const parsed = parseMissionDestination(mission);
    const apiContract: ApiMissionAutopilotParsedDestination = parsed;
    const barrelContract: BarrelMissionAutopilotParsedDestination = parsed;

    expectTypeOf(apiContract).toEqualTypeOf<BarrelMissionAutopilotParsedDestination>();
    expect(barrelContract.sourceInput).toMatchObject({
      source: "workflow_launch",
      missionId: "destination-parser-contract",
      attachments: [
        expect.objectContaining({
          name: "launch-brief.md",
          kind: "file",
          path: "artifacts/launch-brief.md",
        }),
      ],
    });
    expect(parsed.normalizedGoal).toMatchObject({
      title: "Prepare launch committee deck",
      goalType: "generation",
      expectedDeliverables: ["launch-brief.md"],
      confidence: "medium",
    });
    expect(parsed.subGoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "collect architecture evidence",
          source: "mission-text",
          priority: 1,
          dependsOn: [],
          confidence: "high",
        }),
        expect.objectContaining({
          title: "draft release deck",
          dependsOn: ["destination-parser-contract:sub-goal:1"],
        }),
      ])
    );
    expect(parsed.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "before Friday review.",
          dimension: "time",
          source: "explicit",
          status: "confirmed",
        }),
        expect.objectContaining({
          value: "no paid vendor research.",
          dimension: "budget",
        }),
        expect.objectContaining({
          value: "Markdown summary plus slide outline.",
          dimension: "format",
        }),
        expect.objectContaining({
          value: "use repository artifacts only.",
          dimension: "tool",
        }),
        expect.objectContaining({
          value: "Security level: restricted",
          dimension: "permission",
          source: "inferred",
          status: "inferred",
        }),
      ])
    );
    expect(parsed.successCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "deliver architecture review deck",
          metricType: "deliverable",
          source: "explicit",
          verificationHint:
            'Verify that "deliver architecture review deck" is satisfied before delivery.',
        }),
        expect.objectContaining({
          description:
            "committee can review the deck without follow-up questions.",
          metricType: "review",
        }),
      ])
    );
    expect(parsed.missingInformation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "target committee owner",
          blocking: false,
          source: "explicit",
          suggestedClarification: "Please clarify: target committee owner",
        }),
        expect.objectContaining({
          item: "launch date.",
          blocking: false,
        }),
      ])
    );
    expect(parsed.suggestedClarifications).toEqual([
      expect.objectContaining({
        question: "Please clarify: target committee owner",
        required: false,
        source: "parser",
      }),
      expect.objectContaining({
        question: "Please clarify: launch date.",
        required: false,
      }),
    ]);
    expect(parsed.mappedMissionContext.reviewInput).toMatchObject({
      missingInformation: ["target committee owner", "launch date."],
    });
    expect(parsed.mappedWorkflowInput.plannerInput).toMatchObject({
      subGoals: expect.arrayContaining([
        "collect architecture evidence",
        "draft release deck",
      ]),
      constraints: expect.arrayContaining([
        "before Friday review.",
        "no paid vendor research.",
      ]),
      successCriteria: expect.arrayContaining([
        "deliver architecture review deck",
      ]),
    });
    expect(parsed.mappedWorkflowInput.runtimeGovernance).toMatchObject({
      budgets: ["no paid vendor research."],
      toolLimits: ["use repository artifacts only."],
    });
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source-input",
        }),
        expect.objectContaining({
          kind: "decision-prompt",
        }),
      ])
    );
  });

  it("parses destination deliverables, success criteria, and constraints from stable labels and mapped mission fields", () => {
    const mission = makeMission({
      id: "destination-parser-rich-fields",
      title: "生成发布复盘资料包",
      sourceText: [
        "请整理发布复盘资料包。",
        "Deliverables: release-review.md; risk-register.csv.",
        "交付物：执行摘要.md；路线图更新.xlsx",
        "Success criteria: reviewers can approve the plan; metrics are traceable.",
        "验收标准：复盘结论可直接进入评审；风险项都有负责人",
        "Constraints: use internal telemetry only; no customer names.",
        "限制：48 小时内完成；预算不超过 0 元",
      ].join("\n"),
      artifacts: [],
      workPackages: [
        {
          id: "pkg-digest",
          title: "Compile release digest",
          deliverable: "release-digest.json",
          status: "pending",
        },
      ],
      decision: {
        prompt: "Requirements: keep raw logs offline.",
        options: [{ id: "continue", label: "Continue" }],
        payload: {
          missionDestination: {
            deliverables: [
              "committee-pack.pdf",
              {
                name: "owner-action-list.md",
                description: "Action owner checklist",
              },
            ],
            successCriteria: [
              { description: "all open blockers have owners" },
              { value: "approval note is ready for committee" },
            ],
            constraints: [
              { value: "offline evidence only" },
              { dimension: "format", description: "bilingual Markdown" },
            ],
          },
          mappedWorkflowInput: {
            runtimeGovernance: {
              permissions: ["manager approval before publishing"],
              budgets: ["no external spend"],
              toolLimits: [{ value: "repository tools only" }],
            },
          },
        },
      },
      decisionHistory: [
        {
          decisionId: "decision-rich-fields-history",
          type: "approve",
          prompt: "Confirm destination mapping.",
          options: [{ id: "approve", label: "Approve" }],
          payload: {
            destination: {
              expectedDeliverables: [
                { fileName: "launch-readout.pptx" },
                "qa-summary.md",
              ],
              acceptanceCriteria: [
                "stakeholders can sign off without follow-up",
              ],
              requirements: [
                { requirement: "source links stay internal" },
              ],
            },
          },
          resolved: {
            optionId: "approve",
            optionLabel: "Approve",
          },
          submittedAt: Date.now() - 1_000,
        },
      ],
    });

    const parsed = parseMissionDestination(mission);

    expect(parsed.normalizedGoal.expectedDeliverables).toEqual(
      expect.arrayContaining([
        "release-digest.json",
        "release-review.md",
        "risk-register.csv.",
        "执行摘要.md",
        "路线图更新.xlsx",
        "committee-pack.pdf",
      ])
    );
    expect(parsed.successCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "reviewers can approve the plan",
          source: "explicit",
          status: "confirmed",
        }),
        expect.objectContaining({
          description: "metrics are traceable.",
        }),
        expect.objectContaining({
          description: "复盘结论可直接进入评审",
        }),
        expect.objectContaining({
          description: "风险项都有负责人",
        }),
        expect.objectContaining({
          description: "all open blockers have owners",
        }),
        expect.objectContaining({
          description: "approval note is ready for committee",
          metricType: "review",
        }),
      ])
    );
    expect(parsed.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "use internal telemetry only",
          source: "explicit",
          status: "confirmed",
        }),
        expect.objectContaining({
          value: "no customer names.",
        }),
        expect.objectContaining({
          value: "48 小时内完成",
          dimension: "time",
        }),
        expect.objectContaining({
          value: "预算不超过 0 元",
          dimension: "budget",
        }),
        expect.objectContaining({
          value: "offline evidence only",
          dimension: "data-scope",
        }),
        expect.objectContaining({
          value: "bilingual Markdown",
          dimension: "format",
        }),
        expect.objectContaining({
          value: "manager approval before publishing",
          dimension: "permission",
        }),
        expect.objectContaining({
          value: "no external spend",
          dimension: "budget",
        }),
        expect.objectContaining({
          value: "repository tools only",
          dimension: "tool",
        }),
      ])
    );
    expect(parsed.mappedMissionContext.reviewInput).toMatchObject({
      constraints: expect.arrayContaining([
        "use internal telemetry only",
        "offline evidence only",
        "manager approval before publishing",
      ]),
      successCriteria: expect.arrayContaining([
        "reviewers can approve the plan",
        "all open blockers have owners",
      ]),
    });
    expect(parsed.mappedWorkflowInput.plannerInput).toMatchObject({
      constraints: expect.arrayContaining([
        "预算不超过 0 元",
        "repository tools only",
      ]),
      successCriteria: expect.arrayContaining([
        "复盘结论可直接进入评审",
        "approval note is ready for committee",
      ]),
    });
    expect(parsed.mappedWorkflowInput.runtimeGovernance).toMatchObject({
      permissions: expect.arrayContaining(["manager approval before publishing"]),
      budgets: expect.arrayContaining(["预算不超过 0 元", "no external spend"]),
      toolLimits: expect.arrayContaining(["repository tools only"]),
    });
  });

  it("exports route/takeover/evidence/explanation contracts through api and index barrels", () => {
    const mission = makeMission({
      status: "waiting",
      progress: 52,
      waitingFor: "route approval",
      projection: {
        workflowId: "wf-contract",
        instanceId: "wf-contract-instance",
        replayId: "replay-contract",
        sessionId: "session-contract",
      },
      decision: {
        decisionId: "decision-contract-route",
        prompt: "Approve the route before execution continues.",
        options: [{ id: "approve", label: "Approve route" }],
      },
    });

    const summary = buildMissionAutopilotSummary({ mission });
    const routeContract: ApiMissionAutopilotRouteSummary = summary.route;
    const takeoverContract: ApiMissionAutopilotTakeoverSummary = summary.takeover;
    const evidenceContract: ApiMissionAutopilotEvidenceSummary = summary.evidence;
    const explanationContract: ApiMissionAutopilotExplanationSummary =
      summary.explanation;
    const bindingsContract: ApiMissionAutopilotBindingsSummary = summary.bindings;
    const routeStatusContract: ApiMissionAutopilotRouteStatus = summary.route.status;

    expectTypeOf(routeContract).toEqualTypeOf<BarrelMissionAutopilotRouteSummary>();
    expectTypeOf(takeoverContract).toEqualTypeOf<BarrelMissionAutopilotTakeoverSummary>();
    expectTypeOf(evidenceContract).toEqualTypeOf<BarrelMissionAutopilotEvidenceSummary>();
    expectTypeOf(explanationContract).toEqualTypeOf<BarrelMissionAutopilotExplanationSummary>();
    expectTypeOf(bindingsContract).toEqualTypeOf<BarrelMissionAutopilotBindingsSummary>();
    expectTypeOf(routeStatusContract).toEqualTypeOf<BarrelMissionAutopilotRouteStatus>();

    expect(routeContract).toMatchObject({
      id: "wf-contract",
      status: "running",
      takeoverPointIds: ["decision-contract-route"],
      replan: {
        active: false,
        reason: null,
        fromRouteId: null,
        toRouteId: null,
        triggeredBy: null,
      },
    });
    expect(routeStatusContract).toBe("running");
    expect(takeoverContract).toMatchObject({
      status: "pending",
      required: true,
      blocking: true,
      type: "route-selection",
      decisionId: "decision-contract-route",
    });
    expect(evidenceContract.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: "wf-contract",
      replayId: "replay-contract",
      sessionId: "session-contract",
      decisionIds: ["decision-contract-route"],
    });
    expect(explanationContract).toMatchObject({
      currentState: {
        driveState: "takeover-required",
      },
      recommendationDetails: expect.arrayContaining([
        expect.objectContaining({
          kind: "route",
          decisionId: "decision-contract-route",
        }),
        expect.objectContaining({
          kind: "takeover",
          decisionId: "decision-contract-route",
        }),
      ]),
      evidenceHints: expect.arrayContaining(["No artifacts captured yet"]),
    });
    expect(bindingsContract).toMatchObject({
      missionId: mission.id,
      workflowId: "wf-contract",
      instanceId: "wf-contract-instance",
      executorJobId: null,
    });
  });

  it("anchors recovery, explanation sources, and evidence timeline contracts through api and index barrels", () => {
    const submittedAt = Date.now() - 4_000;
    const mission = makeMission({
      status: "failed",
      operatorState: "blocked",
      attempt: 2,
      projection: {
        workflowId: "wf-recovery-contract",
        instanceId: "wf-recovery-contract-instance",
        replayId: "replay-recovery-contract",
        sessionId: "session-recovery-contract",
      },
      blocker: {
        reason: "Executor recovery exhausted and operator review is required.",
        createdAt: Date.now() - 2_000,
      },
      operatorActions: [
        {
          id: "op-retry-contract",
          action: "retry",
          createdAt: Date.now() - 3_000,
          result: "completed",
          requestedBy: "operator@example.com",
          reason: "Retry requested after executor failure",
          detail: "Retry triggered before escalation.",
        },
        {
          id: "op-escalate-contract",
          action: "escalate",
          createdAt: Date.now() - 1_500,
          result: "accepted",
          requestedBy: "operator@example.com",
          reason: "Escalate to operator review",
          detail: "Escalated after repeated executor failure.",
        },
      ],
      decisionHistory: [
        {
          decisionId: "decision-recovery-contract",
          type: "approval",
          prompt: "Confirm whether the route should continue after recovery.",
          submittedAt,
          submittedBy: "operator@example.com",
          optionId: "approve",
          optionLabel: "Approve",
          note: "Approved after inspection.",
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });
    const recoveryContract: ApiMissionAutopilotRecoverySummary = summary.recovery;
    const explanationSourceContract: ApiMissionAutopilotExplanationSource =
      summary.explanation.currentState?.sources[0] ?? "mission-runtime";
    const decisionTimelineItem = summary.evidence.timeline.find(
      item => item.type === "decision"
    );
    const operatorTimelineItem = summary.evidence.timeline.find(
      item => item.type === "operator_action"
    );

    expect(decisionTimelineItem).toBeTruthy();
    expect(operatorTimelineItem).toBeTruthy();

    const decisionTimelineContract: ApiMissionAutopilotEvidenceTimelineItem =
      decisionTimelineItem!;
    const operatorTimelineContract: ApiMissionAutopilotEvidenceTimelineItem =
      operatorTimelineItem!;

    expectTypeOf(recoveryContract).toEqualTypeOf<BarrelMissionAutopilotRecoverySummary>();
    expectTypeOf(explanationSourceContract).toEqualTypeOf<BarrelMissionAutopilotExplanationSource>();
    expectTypeOf(decisionTimelineContract).toEqualTypeOf<BarrelMissionAutopilotEvidenceTimelineItem>();
    expectTypeOf(operatorTimelineContract).toEqualTypeOf<BarrelMissionAutopilotEvidenceTimelineItem>();

    expect(recoveryContract).toMatchObject({
      state: "takeover-required",
      deviationCategory: "state-block",
      reason: "Executor recovery exhausted and operator review is required.",
      attemptedActions: ["retry", "escalate"],
      suggestedActions: ["resume", "escalate", "terminate"],
      needsHuman: true,
      canAutoRecover: false,
    });
    expect(summary.explanation.currentState).toMatchObject({
      driveState: "blocked",
      sources: expect.arrayContaining(["mission-runtime", "recovery-engine"]),
    });
    expect(summary.explanation.recommendationDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "replan",
          source: "recovery-engine",
          routeId: "wf-recovery-contract:deep",
          summary: "Executor recovery exhausted and operator review is required.",
        }),
      ])
    );
    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      workflowId: "wf-recovery-contract",
      replayId: "replay-recovery-contract",
      sessionId: "session-recovery-contract",
      decisionIds: ["decision-recovery-contract"],
      operatorActionIds: ["op-retry-contract", "op-escalate-contract"],
    });
    expect(decisionTimelineContract).toMatchObject({
      id: "decision-recovery-contract",
      type: "decision",
      label: "approval",
      detail: "Confirm whether the route should continue after recovery.",
      status: "done",
      source: "operator@example.com",
    });
    expect(operatorTimelineContract).toMatchObject({
      type: "operator_action",
      label: "retry",
      status: "done",
      source: "operator@example.com",
    });
  });

  it("collects audit and lineage correlation ids from existing decision payload facts", () => {
    const mission = makeMission({
      status: "waiting",
      waitingFor: "route approval",
      decision: {
        decisionId: "decision-correlation-links",
        prompt: "Approve the correlated route.",
        type: "approve",
        options: [{ id: "approve", label: "Approve route" }],
        payload: {
          auditEventIds: ["audit-entry-1", "audit-entry-2"],
          lineageIds: ["lineage-node-1"],
          metadata: {
            auditId: "audit-entry-3",
            links: {
              lineageId: "lineage-node-2",
            },
          },
        },
      },
      decisionHistory: [
        {
          decisionId: "decision-history-correlation",
          type: "approve",
          prompt: "Confirm the fallback route.",
          options: [{ id: "approve", label: "Approve fallback" }],
          payload: {
            auditEntryId: "audit-entry-4",
            context: {
              inheritedContext: {
                auditId: "audit-entry-2",
                lineageId: "lineage-node-3",
              },
            },
            observability: {
              links: {
                lineageId: "lineage-node-1",
              },
            },
          },
          resolved: {},
          submittedAt: Date.now() - 1_000,
        },
      ],
    });

    const summary = buildMissionAutopilotSummary({ mission });

    expect(summary.evidence.correlation).toMatchObject({
      missionId: mission.id,
      decisionIds: ["decision-correlation-links", "decision-history-correlation"],
      auditEventIds: [
        "audit-entry-1",
        "audit-entry-2",
        "audit-entry-3",
        "audit-entry-4",
      ],
      lineageIds: [
        "lineage-node-1",
        "lineage-node-2",
        "lineage-node-3",
      ],
    });
  });

  it("keeps an explicit mission title as the destination goal when request context is broader", () => {
    const mission = makeMission({
      id: "destination-goal-fallback-boundary",
      title: "Migrate billing dashboard",
      sourceText:
        "Prepare the broader finance workspace migration brief, including stakeholder notes and rollout context.",
      summary:
        "The broader workspace migration also includes support runbooks and reporting cleanup.",
    });

    const summary = buildMissionAutopilotSummary({ mission });
    const parsed = parseMissionDestination(mission);

    expect(summary.destination.goal).toBe("Migrate billing dashboard");
    expect(summary.destination.request).toBe(
      "Prepare the broader finance workspace migration brief, including stakeholder notes and rollout context."
    );
    expect(summary.destination.goal).not.toBe(summary.destination.request);
    expect(parsed.normalizedGoal.title).toBe("Migrate billing dashboard");
    expect(parsed.sourceInput.text).toBe(summary.destination.request);
    expect(parsed.mappedMissionContext.title).toBe("Migrate billing dashboard");
    expect(parsed.mappedWorkflowInput.goal).toBe("Migrate billing dashboard");
  });
});
