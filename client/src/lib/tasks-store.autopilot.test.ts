import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MissionPlanetInteriorData,
  MissionPlanetOverviewItem,
  MissionRecord,
} from "@shared/mission/contracts";
import type { ListMissionPlanetsResponse } from "@shared/mission/api";

const mockListMissions = vi.fn();
const mockListPlanets = vi.fn();
const mockGetPlanetInterior = vi.fn();
const mockListMissionEvents = vi.fn();

vi.mock("./mission-client", () => ({
  cancelMission: vi.fn(),
  createMission: vi.fn(),
  getMission: vi.fn(),
  getPlanet: vi.fn(),
  getPlanetInterior: (...args: unknown[]) => mockGetPlanetInterior(...args),
  listMissionEvents: (...args: unknown[]) => mockListMissionEvents(...args),
  listMissions: (...args: unknown[]) => mockListMissions(...args),
  listPlanets: (...args: unknown[]) => mockListPlanets(...args),
  submitMissionDecision: vi.fn(),
  submitMissionOperatorAction: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock("./sandbox-store", () => ({
  useSandboxStore: {
    getState: () => ({
      initSocket: vi.fn(),
    }),
  },
}));

vi.mock("./store", () => ({
  useAppStore: Object.assign(() => ({}), {
    getState: () => ({ runtimeMode: "advanced" }),
    subscribe: vi.fn(),
  }),
}));

const now = Date.now();

function makeMission(
  id: string,
  overrides?: Partial<MissionRecord>
): MissionRecord {
  return {
    id,
    kind: "analysis",
    title: `Mission ${id}`,
    sourceText: `Source text for ${id}`,
    status: "running",
    progress: 42,
    currentStageKey: "execute",
    projection: {
      workflowId: `workflow-${id}`,
      instanceId: `instance-${id}`,
    },
    stages: [
      { key: "receive", label: "Receive task", status: "done" },
      { key: "plan", label: "Build execution plan", status: "done" },
      { key: "execute", label: "Run execution", status: "running" },
    ],
    createdAt: now - 10_000,
    updatedAt: now,
    events: [
      {
        type: "progress",
        message: "Executor is gathering evidence.",
        level: "info",
        time: now - 1_000,
        stageKey: "execute",
      },
    ],
    artifacts: [],
    operatorState: "active",
    operatorActions: [],
    attempt: 1,
    ...overrides,
  };
}

function makePlanet(
  id: string,
  overrides?: Partial<MissionPlanetOverviewItem>
): MissionPlanetOverviewItem {
  return {
    id,
    title: `Planet ${id}`,
    sourceText: `Planet source text for ${id}`,
    kind: "analysis",
    status: "running",
    progress: 50,
    complexity: 3,
    radius: 48,
    position: { x: 0, y: 0 },
    createdAt: now - 10_000,
    updatedAt: now,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    taskUrl: `/tasks/${id}`,
    tags: ["Operations"],
    ...overrides,
  };
}

function makeInterior(
  overrides?: Partial<MissionPlanetInteriorData>
): MissionPlanetInteriorData {
  return {
    stages: [
      {
        key: "execute",
        label: "Run execution",
        status: "running",
        progress: 50,
        detail: "Executing the active route.",
        arcStart: 0,
        arcEnd: 120,
        midAngle: 60,
      },
    ],
    agents: [
      {
        id: "mission-core",
        name: "Mission Core",
        role: "orchestrator",
        sprite: "mission-core",
        status: "working",
        stageKey: "execute",
        stageLabel: "Run execution",
        progress: 50,
        currentAction: "Coordinate execution",
        angle: 60,
      },
    ],
    events: [],
    ...overrides,
  };
}

async function importFreshStore() {
  vi.resetModules();
  const mod = await import("./tasks-store");
  const { useTasksStore } = mod;

  useTasksStore.setState({
    ready: false,
    loading: false,
    error: null,
    missionSocketConnected: false,
    selectedTaskId: null,
    tasks: [],
    detailsById: {},
    decisionNotes: {},
    cancellingMissionIds: {},
    operatorActionLoadingByMissionId: {},
    lastDecisionLaunch: null,
  });

  return useTasksStore;
}

describe("tasks-store autopilot summary projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      setTimeout,
      clearTimeout,
      sessionStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    mockGetPlanetInterior.mockRejectedValue(new Error("interior unavailable"));
    mockListMissionEvents.mockImplementation(async (missionId: string) => ({
      ok: true,
      events:
        missionId === "waiting-mission"
          ? [
              {
                type: "waiting",
                message: "Need the operator to choose a route.",
                level: "warn",
                time: now - 500,
              },
            ]
          : [],
    }));
  });

  it("builds a client fallback autopilotSummary from mission facts", async () => {
    const mission = makeMission("waiting-mission", {
      status: "waiting",
      progress: 58,
      waitingFor: "Choose whether to continue with the external write.",
      decision: {
        decisionId: "decision-1",
        type: "approve",
        prompt: "Approve external write?",
        allowFreeText: true,
        options: [
          {
            id: "approve",
            label: "Approve",
            description: "Continue the route.",
          },
          {
            id: "reject",
            label: "Reject",
            description: "Stop the route.",
          },
        ],
      },
      artifacts: [
        {
          kind: "file",
          name: "route-plan.md",
          path: "artifacts/route-plan.md",
        },
      ],
      executor: {
        name: "lobster",
        jobId: "job-1",
        status: "waiting",
      },
      agentCrew: [
        {
          id: "planner-1",
          name: "Planner",
          role: "ceo",
          department: "Planning",
          status: "working",
        },
      ],
    });

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting", progress: 58 })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const summary = useTasksStore.getState().tasks[0];
    const autopilotSummary = summary.autopilotSummary;

    expect(autopilotSummary).toBeDefined();
    expect(autopilotSummary).toMatchObject({
      source: "client-mission-projection",
      destination: {
        id: mission.id,
        goal: "Mission waiting-mission",
        request: "Source text for waiting-mission",
        taskType: "analysis",
        auxiliaryTaskTypes: ["coordination", "generation"],
        confidence: {
          level: "medium",
        },
        constraints: ["Mission kind: analysis"],
        successCriteria: ["Artifacts are produced"],
        missingInfo: ["Choose whether to continue with the external write."],
        deliverables: ["route-plan.md"],
      },
      route: {
        id: "workflow-waiting-mission",
        mode: "deep",
        status: "running",
        currentStageKey: "execute",
        currentStageLabel: "Run execution",
        takeoverPointIds: ["decision-1"],
      },
      driveState: {
        state: "takeover-required",
        waitingForUser: true,
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        status: "pending",
        required: true,
        blocking: true,
        type: "approval",
        reason: "Choose whether to continue with the external write.",
        prompt: "Approve external write?",
        decisionId: "decision-1",
        urgency: "medium",
      },
      execution: {
        currentStepKey: "execute",
        currentStepStatus: "waiting",
      },
      recovery: {
        state: "watching",
        deviationCategory: "governance-deviation",
        needsHuman: true,
      },
      evidence: {
        trustLevel: "verified",
      },
      explanation: {
        telemetrySignals: [
          "mission.status:waiting",
          "drive.state:takeover-required",
          "risk.level:medium",
        ],
      },
      bindings: {
        missionId: mission.id,
        workflowId: "workflow-waiting-mission",
        executorJobId: "job-1",
        instanceId: "instance-waiting-mission",
      },
    });
    expect(autopilotSummary?.route.stages.map(stage => stage.key)).toContain(
      "execute"
    );
    expect(autopilotSummary?.destination.missingInfoDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Choose whether to continue with the external write.",
          impact: "Mission progress remains paused until this input is resolved.",
          blocking: true,
        }),
      ])
    );
    expect(autopilotSummary?.destination.suggestedClarifications).toEqual([
      "Approve external write?",
    ]);
    expect(autopilotSummary?.destination.taskType).toBe("analysis");
    expect(autopilotSummary?.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["coordination", "generation"])
    );
    expect(autopilotSummary?.destination.impact ?? null).toBeNull();
    expect(autopilotSummary?.destination.blockingReason ?? null).toBeNull();
    expect(autopilotSummary?.route.candidateRoutes).toHaveLength(3);
    expect(autopilotSummary?.route.selectedRouteId).toBe(
      "workflow-waiting-mission:deep"
    );
    expect(autopilotSummary?.route.recommendedRouteId).toBe(
      "workflow-waiting-mission:deep"
    );
    expect(autopilotSummary?.route.riskPoints).toEqual([
      "Awaiting Choose whether to continue with the external write.",
    ]);
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "locked",
      mode: "planner_default",
      locked: true,
      canSwitch: false,
      switchRequiresConfirmation: true,
      changedBy: "user",
      changedReason: "Choose whether to continue with the external write.",
    });
    expect(autopilotSummary?.route.evidence).toMatchObject({
      lastEventType: "route.locked",
    });
    expect(autopilotSummary?.route.evidence.events).toEqual([
      expect.objectContaining({
        eventType: "route.recommended",
        actor: "planner",
        toRouteId: "workflow-waiting-mission:deep",
      }),
      expect.objectContaining({
        eventType: "route.selected",
        actor: "user",
        toRouteId: "workflow-waiting-mission:deep",
      }),
      expect.objectContaining({
        eventType: "route.locked",
        actor: "user",
        toRouteId: "workflow-waiting-mission:deep",
      }),
    ]);
    expect(autopilotSummary?.route.replan).toMatchObject({
      active: false,
      reason: null,
      fromRouteId: null,
      toRouteId: null,
      triggeredBy: null,
    });
    expect(autopilotSummary?.fleet.roles.map(role => role.id)).toEqual(
      expect.arrayContaining([
        "waiting-mission:planner",
        "waiting-mission:operator",
        "waiting-mission:executor",
      ])
    );
    expect(autopilotSummary?.execution.availableActions.map(action => action.type)).toContain(
      "resume"
    );
    expect(autopilotSummary?.evidence.timeline.length).toBeGreaterThan(0);
    expect(autopilotSummary?.takeover.options).toEqual([
      {
        id: "approve",
        label: "Approve",
        description: "Continue the route.",
      },
      {
        id: "reject",
        label: "Reject",
        description: "Stop the route.",
      },
    ]);
    expect(
      useTasksStore.getState().detailsById[mission.id].autopilotSummary
    ).toEqual(autopilotSummary);
  });

  it("keeps route-selection decisions switchable while exposing alternatives-available semantics", async () => {
    const mission = makeMission("route-selection-mission", {
      status: "waiting",
      progress: 41,
      waitingFor: "Choose the route before continuing.",
      decision: {
        decisionId: "decision-route-1",
        type: "multi-choice",
        prompt: "Choose the route before continuing.",
        allowFreeText: false,
        options: [
          {
            id: "fast",
            label: "Fast route",
            description: "Favor shorter execution chains.",
          },
          {
            id: "deep",
            label: "Deep route",
            description: "Favor verification and auditability.",
          },
        ],
      },
    });

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting", progress: 41 })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary =
      useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary).toMatchObject({
      takeover: {
        status: "pending",
        type: "route-selection",
        decisionId: "decision-route-1",
      },
      route: {
        selectionStatus: "alternatives-available",
        selectionLocked: true,
      },
    });
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "alternatives-available",
      locked: true,
      canSwitch: true,
      switchRequiresConfirmation: true,
      changedBy: "user",
      changedReason: "Choose the route before continuing.",
    });
    expect(autopilotSummary?.route.evidence.lastEventType).toBe("route.locked");
    expect(autopilotSummary?.route.evidence.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "route.recommended",
        }),
        expect.objectContaining({
          eventType: "route.selected",
          actor: "user",
        }),
        expect.objectContaining({
          eventType: "route.locked",
          actor: "user",
        }),
      ])
    );
  });

  it("keeps runtime replan semantics aligned across selection, evidence, and replan fields", async () => {
    const mission = makeMission("replanned-route-mission", {
      status: "running",
      progress: 64,
      attempt: 3,
      currentStageKey: "plan",
      blocker: {
        reason: "Retry budget is exhausted.",
      },
    });

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { progress: 64, currentStageKey: "plan" })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary =
      useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.route).toMatchObject({
      selectionStatus: "replanned",
      selectionLocked: false,
    });
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "replanned",
      mode: "runtime_replanned",
      locked: false,
      canSwitch: true,
      switchRequiresConfirmation: false,
      changedBy: "runtime",
      changedReason: "Mission has retried 2 time(s).",
    });
    expect(autopilotSummary?.route.evidence).toMatchObject({
      lastEventType: "route.replanned",
    });
    expect(autopilotSummary?.route.evidence.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "route.recommended",
          actor: "planner",
        }),
        expect.objectContaining({
          eventType: "route.replanned",
          actor: "runtime",
          reason: "Mission has retried 2 time(s).",
        }),
      ])
    );
    expect(autopilotSummary?.route.replan).toMatchObject({
      active: true,
      reason: "Mission has retried 2 time(s).",
      toRouteId: "workflow-replanned-route-mission:standard",
      triggeredBy: "runtime",
    });
  });

  it("preserves explicit user-driven route replans without collapsing them into runtime semantics", async () => {
    const mission = makeMission("user-replanned-route-mission") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-user-replanned-route-mission",
        goal: "Switch to the safer route before publish",
        request: "Pick the safer route and replan the remaining work.",
        taskType: "coordination",
        auxiliaryTaskTypes: ["generation"],
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "workflow-user-replanned-route-mission",
        label: "Safer publish route",
        mode: "standard",
        status: "running",
        progress: 57,
        selectedRouteId: "workflow-user-replanned-route-mission:safe",
        recommendedRouteId: "workflow-user-replanned-route-mission:fast",
        candidateRoutes: [
          {
            id: "workflow-user-replanned-route-mission:fast",
            label: "Fast route",
            mode: "fast",
            summary: "Ship faster with less verification.",
            recommended: true,
            selected: false,
            locked: false,
            riskLevel: "medium",
            takeoverLoad: "medium",
            stageKeys: ["plan", "execute"],
          },
          {
            id: "workflow-user-replanned-route-mission:safe",
            label: "Safe route",
            mode: "standard",
            summary: "Slow down and verify the external publish path.",
            recommended: false,
            selected: true,
            locked: false,
            riskLevel: "low",
            takeoverLoad: "high",
            stageKeys: ["plan", "execute"],
          },
        ],
        selectionStatus: "replanned",
        selection: {
          status: "replanned",
          mode: "user_selected",
          locked: false,
          canSwitch: true,
          switchRequiresConfirmation: false,
          changedBy: "user",
          changedReason: "Choose the safer route before external publish.",
        },
        evidence: {
          lastEventType: "route.replanned",
          lastEventAt: new Date(now).toISOString(),
          events: [
            {
              eventType: "route.replanned",
              actor: "user",
              fromRouteId: "workflow-user-replanned-route-mission:fast",
              toRouteId: "workflow-user-replanned-route-mission:safe",
              reason: "Choose the safer route before external publish.",
              at: new Date(now).toISOString(),
            },
          ],
        },
        replan: {
          active: true,
          reason: "Choose the safer route before external publish.",
          fromRouteId: "workflow-user-replanned-route-mission:fast",
          toRouteId: "workflow-user-replanned-route-mission:safe",
          triggeredBy: "user",
        },
      },
      driveState: {
        state: "planning",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepKey: "plan",
        currentStepLabel: "Build execution plan",
        currentStepStatus: "running",
      },
      recovery: {
        state: "watching",
        deviationCategory: "route-deviation",
      },
      evidence: {
        eventCount: 1,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: "workflow-user-replanned-route-mission",
          replayId: `replay-${mission.id}`,
          sessionId: `session-${mission.id}`,
          timelineId: `${mission.id}:timeline`,
          routeIds: [
            "workflow-user-replanned-route-mission:fast",
            "workflow-user-replanned-route-mission:safe",
          ],
          recommendedRouteId: "workflow-user-replanned-route-mission:fast",
          selectedRouteId: "workflow-user-replanned-route-mission:safe",
          routeStageKeys: ["plan", "execute"],
          currentStepKey: "plan",
          runtimeEventIds: [],
          decisionIds: ["decision-user-replan-1"],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "User switched to the safer route before publish.",
        currentState: {
          summary: "User switched to the safer route before publish.",
          driveState: "planning",
          missionStatus: "running",
          currentStageKey: "plan",
          currentStageLabel: "Build execution plan",
          workflowStatus: "running",
          workflowStage: "plan",
          routeSelectionStatus: "replanned",
          selectedRouteId: "workflow-user-replanned-route-mission:safe",
          correlationTimelineId: `${mission.id}:timeline`,
          sources: ["mission-runtime", "takeover-state"],
          updatedAt: new Date(now).toISOString(),
        },
        recommendationDetails: [
          {
            kind: "route",
            source: "route-planner",
            routeId: "workflow-user-replanned-route-mission:safe",
            actionType: null,
            takeoverType: null,
            decisionId: "decision-user-replan-1",
            routeSelectionStatus: "replanned",
            correlationTimelineId: `${mission.id}:timeline`,
            summary: "Choose the safer route before external publish.",
            updatedAt: new Date(now).toISOString(),
          },
          {
            kind: "replan",
            source: "mission-runtime",
            routeId: "workflow-user-replanned-route-mission:safe",
            actionType: "replan",
            takeoverType: null,
            decisionId: "decision-user-replan-1",
            routeSelectionStatus: "replanned",
            correlationTimelineId: `${mission.id}:timeline`,
            summary: "Choose the safer route before external publish.",
            updatedAt: new Date(now).toISOString(),
          },
        ],
        remainingSteps: {
          currentStepKey: "plan",
          currentStepLabel: "Build execution plan",
          mainlineSteps: [],
          pendingSteps: [],
          parallelBranchCount: 0,
          replanChangeSummary: "Choose the safer route before external publish.",
          selectedRouteId: "workflow-user-replanned-route-mission:safe",
          routeSelectionStatus: "replanned",
        },
        riskSummary: [],
        evidenceHints: [],
        telemetrySignals: [],
      },
      bindings: {
        missionId: mission.id,
        workflowId: "workflow-user-replanned-route-mission",
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary =
      useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.destination.taskType).toBe("coordination");
    expect(autopilotSummary?.destination.auxiliaryTaskTypes).toEqual(
      expect.arrayContaining(["generation"])
    );
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "replanned",
      mode: "user_selected",
      changedBy: "user",
      changedReason: "Choose the safer route before external publish.",
    });
    expect(autopilotSummary?.route.evidence).toMatchObject({
      lastEventType: "route.replanned",
    });
    expect(autopilotSummary?.route.replan).toMatchObject({
      active: true,
      reason: "Choose the safer route before external publish.",
      fromRouteId: "workflow-user-replanned-route-mission:fast",
      toRouteId: "workflow-user-replanned-route-mission:safe",
      triggeredBy: "user",
    });
  });

  it.each([
    "autopilotSummary",
    "autopilotProjection",
    "autopilot.summary",
    "projection.autopilotSummary",
    "projection.autopilot",
  ] as const)(
    "normalizes %s while filling fallback gaps for summary and detail",
    async alias => {
      const missionId = alias.replace(/[^a-z]+/gi, "-").toLowerCase();
      const mission = makeMission(missionId) as MissionRecord & {
        autopilotSummary?: unknown;
        autopilotProjection?: unknown;
        autopilot?: unknown;
        projection: Record<string, unknown>;
      };
      const projectedSummary = {
        version: "shared-autopilot/v1",
        source: "shared-mission-projection",
        destination: {
          id: `destination-${missionId}`,
          goal: `Goal from ${alias}`,
          request: `Request from ${alias}`,
          confidence: {
            level: "high",
            reason: `Confidence reason from ${alias}`,
            signals: [`signal:${alias}`],
          },
          constraints: [`Constraint from ${alias}`],
          successCriteria: [`Success from ${alias}`],
          deliverables: [`Deliverable from ${alias}`],
          missingInfo: [`Missing from ${alias}`],
          missingInfoDetails: [
            {
              item: `Missing from ${alias}`,
              impact: `Impact from ${alias}`,
              blocking: true,
            },
          ],
        },
        route: {
          id: `route-${missionId}`,
          label: `Route from ${alias}`,
          mode: "deep",
          progress: 77,
          selectedRouteId: `route-${missionId}:deep`,
          candidateRoutes: [
            {
              id: `route-${missionId}:deep`,
              label: "Deep route",
              mode: "deep",
              summary: "Trace evidence before publish.",
              recommended: true,
              selected: true,
              locked: false,
              riskLevel: "medium",
              takeoverLoad: "medium",
              stageKeys: ["plan", "execute"],
            },
          ],
        },
        driveState: {
          state: "reviewing",
          label: `Review from ${alias}`,
          detail: `Projection detail from ${alias}`,
          riskLevel: "low",
          confidence: "high",
        },
        takeover: {
          required: false,
          blocking: false,
        },
        execution: {
          currentStepKey: "execute",
          currentStepLabel: "Run execution",
          currentStepStatus: "running",
          parallelBranchCount: 2,
          blockedReasons: [],
          intermediateDeliverables: ["brief.md"],
          availableActions: [
            {
              id: `${missionId}:replan`,
              type: "replan",
              label: "replan",
              scope: "route",
              enabled: true,
            },
          ],
        },
        recovery: {
          state: "watching",
          deviationCategory: "quality-deviation",
          attemptedActions: ["retry"],
          suggestedActions: ["replan"],
          needsHuman: false,
          canAutoRecover: true,
        },
        evidence: {
          eventCount: 2,
          artifactCount: 1,
          lastSignal: "Projection signal",
          latestEventType: "progress",
          updatedAt: new Date(now).toISOString(),
          trustLevel: "partial",
          gaps: ["No audit hash yet"],
          timeline: [
            {
              id: `${missionId}:timeline-1`,
              type: "drive_state_change",
              label: "progress",
              status: "running",
              time: new Date(now).toISOString(),
            },
          ],
          correlation: {
            missionId,
            workflowId: `server-workflow-${missionId}`,
            replayId: `replay-${missionId}`,
            sessionId: `session-${missionId}`,
            timelineId: `${missionId}:timeline`,
            routeIds: [`route-${missionId}:deep`],
            routeStageKeys: ["plan", "execute"],
            runtimeEventIds: [`runtime-${missionId}:1`],
            decisionIds: [`decision-${missionId}`],
            operatorActionIds: [`operator-${missionId}:1`],
            auditEventIds: [`audit-${missionId}:1`],
            lineageIds: [`lineage-${missionId}:1`],
          },
        },
        explanation: {
          current: "Projection detail",
          currentState: {
            summary: "Projection detail",
            driveState: "reviewing",
            missionStatus: "running",
            currentStageKey: "execute",
            currentStageLabel: "Run execution",
            workflowStatus: "running",
            workflowStage: "review",
            routeSelectionStatus: "recommended",
            selectedRouteId: `route-${missionId}:deep`,
            correlationTimelineId: `${missionId}:timeline`,
            sources: ["mission-runtime", "workflow-runtime"],
            updatedAt: new Date(now).toISOString(),
          },
          nextSteps: ["Review artifacts"],
          recommendationReasons: ["Deep route is recommended."],
          recommendationDetails: [
            {
              kind: "route",
              source: "route-planner",
              routeId: `route-${missionId}:deep`,
              actionType: null,
              takeoverType: null,
              decisionId: null,
              routeSelectionStatus: "recommended",
              correlationTimelineId: `${missionId}:timeline`,
              summary: "Deep route is recommended.",
              updatedAt: new Date(now).toISOString(),
            },
            {
              kind: "takeover",
              source: "takeover-state",
              routeId: `route-${missionId}:deep`,
              actionType: "wait",
              takeoverType: "approval",
              decisionId: `decision-${missionId}`,
              routeSelectionStatus: "recommended",
              correlationTimelineId: `${missionId}:timeline`,
              summary: "Approve external write?",
              updatedAt: new Date(now).toISOString(),
            },
          ],
          remainingSteps: {
            currentStepKey: "execute",
            currentStepLabel: "Run execution",
            mainlineSteps: [
              {
                key: "plan",
                label: "Build execution plan",
                status: "done",
                isCurrent: false,
              },
              {
                key: "execute",
                label: "Run execution",
                status: "running",
                isCurrent: true,
              },
            ],
            pendingSteps: [
              {
                key: "execute",
                label: "Run execution",
                status: "running",
                isCurrent: true,
              },
            ],
            parallelBranchCount: 2,
            replanChangeSummary: null,
            selectedRouteId: `route-${missionId}:deep`,
            routeSelectionStatus: "recommended",
          },
          riskSummary: ["Pending review"],
          evidenceHints: ["Open the evidence drawer."],
          telemetrySignals: ["drive.state:reviewing"],
        },
        bindings: {
          missionId,
          workflowId: `server-workflow-${missionId}`,
          executorJobId: `job-${missionId}`,
        },
      };

      if (alias === "autopilotSummary") {
        mission.autopilotSummary = projectedSummary;
      } else if (alias === "autopilotProjection") {
        mission.autopilotProjection = projectedSummary;
      } else if (alias === "autopilot.summary") {
        mission.autopilot = { summary: projectedSummary };
      } else if (alias === "projection.autopilot") {
        mission.projection = {
          ...mission.projection,
          autopilot: projectedSummary,
        };
      } else {
        mission.projection = {
          ...mission.projection,
          autopilotSummary: projectedSummary,
        };
      }

      mockListPlanets.mockResolvedValue({
        ok: true,
        planets: [makePlanet(mission.id)],
        edges: [],
      });
      mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

      const useTasksStore = await importFreshStore();
      await useTasksStore.getState().refresh();

      const summary = useTasksStore.getState().tasks[0];
      const autopilotSummary = summary.autopilotSummary;
      const detailAutopilot =
        useTasksStore.getState().detailsById[mission.id].autopilotSummary;

      expect(autopilotSummary).toMatchObject({
        version: "shared-autopilot/v1",
        source: "shared-mission-projection",
        destination: {
          id: `destination-${missionId}`,
          goal: `Goal from ${alias}`,
          request: `Request from ${alias}`,
          constraints: [`Constraint from ${alias}`],
          successCriteria: [`Success from ${alias}`],
          deliverables: [`Deliverable from ${alias}`],
          missingInfo: [`Missing from ${alias}`],
        },
        route: {
          id: `route-${missionId}`,
          label: `Route from ${alias}`,
          mode: "deep",
          progress: 77,
          status: "running",
          selectedRouteId: `route-${missionId}:deep`,
        },
        driveState: {
          state: "reviewing",
          label: `Review from ${alias}`,
          detail: `Projection detail from ${alias}`,
          riskLevel: "low",
          confidence: "high",
        },
        takeover: {
          required: false,
          blocking: false,
        },
        execution: {
          currentStepKey: "execute",
          currentStepStatus: "running",
        },
        recovery: {
          state: "watching",
          deviationCategory: "quality-deviation",
        },
        evidence: {
          trustLevel: "partial",
          correlation: {
            missionId,
            workflowId: `server-workflow-${missionId}`,
            replayId: `replay-${missionId}`,
            sessionId: `session-${missionId}`,
            timelineId: `${missionId}:timeline`,
            routeIds: [`route-${missionId}:deep`],
            routeStageKeys: ["plan", "execute"],
            runtimeEventIds: [`runtime-${missionId}:1`],
            decisionIds: [`decision-${missionId}`],
            operatorActionIds: [`operator-${missionId}:1`],
            auditEventIds: [`audit-${missionId}:1`],
            lineageIds: [`lineage-${missionId}:1`],
          },
        },
        explanation: {
          current: "Projection detail",
        },
        bindings: {
          missionId,
          workflowId: `server-workflow-${missionId}`,
          executorJobId: `job-${missionId}`,
          instanceId: `instance-${missionId}`,
        },
      });
      expect(autopilotSummary?.route.stages.length).toBeGreaterThan(0);
      expect(autopilotSummary?.destination.confidence).toMatchObject({
        level: "high",
        reason: `Confidence reason from ${alias}`,
        signals: [`signal:${alias}`],
      });
      expect(autopilotSummary?.destination.impact).toBe(`Impact from ${alias}`);
      expect(autopilotSummary?.destination.blockingReason).toBe(
        `Impact from ${alias}`
      );
      expect(autopilotSummary?.destination.missingInfoDetails).toEqual([
        {
          item: `Missing from ${alias}`,
          impact: `Impact from ${alias}`,
          blocking: true,
        },
      ]);
      expect(autopilotSummary?.route.candidateRoutes).toHaveLength(1);
      expect(autopilotSummary?.route.selectedRouteId).toBe(
        `route-${missionId}:deep`
      );
      expect(autopilotSummary?.route.selected?.id).toBe(`route-${missionId}:deep`);
      expect(autopilotSummary?.route.selectedRoute?.id).toBe(
        `route-${missionId}:deep`
      );
      expect(autopilotSummary?.route.recommendedRouteId).toBe(
        `route-${missionId}:deep`
      );
      expect(autopilotSummary?.route.selection).toMatchObject({
        status: "recommended",
        mode: "planner_default",
        locked: false,
      });
      expect(autopilotSummary?.route.evidence).toMatchObject({
        lastEventType: "route.selected",
      });
      expect(autopilotSummary?.route.replan.active).toBe(false);
      expect(autopilotSummary?.fleet.roles.map(role => role.id)).toContain(
        `${missionId}:planner`
      );
      expect(autopilotSummary?.execution.availableActions[0]?.type).toBe("replan");
      expect(autopilotSummary?.evidence.correlation).toMatchObject({
        missionId,
        workflowId: `server-workflow-${missionId}`,
        replayId: `replay-${missionId}`,
        sessionId: `session-${missionId}`,
        timelineId: `${missionId}:timeline`,
        recommendedRouteId: `route-${missionId}:deep`,
        selectedRouteId: `route-${missionId}:deep`,
        routeIds: [`route-${missionId}:deep`],
        routeStageKeys: ["plan", "execute"],
        currentStepKey: "execute",
        runtimeEventIds: [`runtime-${missionId}:1`],
        decisionIds: [`decision-${missionId}`],
        operatorActionIds: [`operator-${missionId}:1`],
        auditEventIds: [`audit-${missionId}:1`],
        lineageIds: [`lineage-${missionId}:1`],
      });
      expect(autopilotSummary?.explanation.currentState).toMatchObject({
        summary: "Projection detail",
        driveState: "reviewing",
        missionStatus: "running",
        currentStageKey: "execute",
        currentStageLabel: "Run execution",
        workflowStatus: "running",
        workflowStage: "review",
        routeSelectionStatus: "recommended",
        selectedRouteId: `route-${missionId}:deep`,
        correlationTimelineId: `${missionId}:timeline`,
        sources: ["mission-runtime", "workflow-runtime"],
      });
      const recommendationDetails =
        autopilotSummary?.explanation.recommendationDetails ?? [];
      expect(recommendationDetails.length).toBeGreaterThanOrEqual(2);
      expect(
        recommendationDetails.find(
          detail =>
            detail.kind === "route" &&
            detail.routeId === `route-${missionId}:deep`
        )
      ).toMatchObject({
        kind: "route",
        source: "route-planner",
        routeId: `route-${missionId}:deep`,
        summary: "Deep route is recommended.",
        actionType: null,
        routeSelectionStatus: "recommended",
        correlationTimelineId: `${missionId}:timeline`,
      });
      expect(
        recommendationDetails.find(
          detail =>
            detail.kind === "takeover" &&
            detail.decisionId === `decision-${missionId}`
        )
      ).toMatchObject({
        kind: "takeover",
        source: "takeover-state",
        actionType: "wait",
        takeoverType: "approval",
        decisionId: `decision-${missionId}`,
        summary: "Approve external write?",
        routeSelectionStatus: "recommended",
        correlationTimelineId: `${missionId}:timeline`,
      });
      expect(
        recommendationDetails.find(
          detail =>
            detail.kind === "route" &&
            detail.routeId === `workflow-${missionId}:standard`
        )
      ).toMatchObject({
        kind: "route",
        source: "route-planner",
        routeId: `workflow-${missionId}:standard`,
        summary: "Executor is gathering evidence.",
      });
      expect(autopilotSummary?.explanation.remainingSteps).toMatchObject({
        currentStepKey: "execute",
        currentStepLabel: "Run execution",
        parallelBranchCount: 2,
        selectedRouteId: `route-${missionId}:deep`,
        routeSelectionStatus: "recommended",
        pendingSteps: [
          expect.objectContaining({
            key: "execute",
            label: "Run execution",
            status: "running",
            isCurrent: true,
          }),
        ],
      });
      expect(detailAutopilot).toEqual(autopilotSummary);
    }
  );

  it("fills missing structured explanation fields from fallback while keeping projected nested route data", async () => {
    const mission = makeMission("structured-explanation-fallback", {
      status: "waiting",
      waitingFor: "Confirm whether the route can write externally.",
      decision: {
        decisionId: "decision-structured-explanation-fallback",
        type: "approve",
        prompt: "Approve the external write?",
        allowFreeText: false,
        options: [
          {
            id: "approve",
            label: "Approve",
            description: "Continue the selected route.",
          },
        ],
      },
    }) as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-structured-explanation-fallback",
        goal: "Goal from partial projection",
        request: "Request from partial projection",
        constraints: [],
        successCriteria: [],
        deliverables: [],
      },
      route: {
        id: "route-structured-explanation-fallback",
        label: "Projected route",
        mode: "deep",
        selection: {
          status: "locked",
          mode: "planner_default",
          locked: true,
          canSwitch: false,
          switchRequiresConfirmation: true,
          changedBy: "user",
          changedReason: "Operator confirmation is still pending.",
        },
        replan: {
          active: false,
          reason: null,
          fromRouteId: null,
          toRouteId: null,
          triggeredBy: null,
        },
      },
      takeover: {
        required: true,
        blocking: true,
        type: "approval",
        decisionId: "decision-structured-explanation-fallback",
      },
      explanation: {
        current: "Projected review detail",
        currentState: {
          summary: "Projected review detail",
          driveState: "reviewing",
          missionStatus: "waiting",
        },
        recommendationDetails: [
          {
            kind: "takeover",
            source: "takeover-state",
            summary: "Approve the external write?",
          },
        ],
        remainingSteps: {
          currentStepKey: "execute",
          pendingSteps: [
            {
              key: "execute",
              label: "Run execution",
              status: "running",
              isCurrent: true,
            },
          ],
        },
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting" })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary =
      useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.explanation.currentState).toMatchObject({
      summary: "Projected review detail",
      driveState: "reviewing",
      missionStatus: "waiting",
      currentStageKey: "execute",
      currentStageLabel: "Run execution",
      sources: expect.arrayContaining(["mission-runtime"]),
    });
    const recommendationDetails =
      autopilotSummary?.explanation.recommendationDetails ?? [];
    expect(recommendationDetails.length).toBeGreaterThanOrEqual(2);
    expect(
      recommendationDetails.find(
        detail =>
          detail.kind === "takeover" && detail.source === "takeover-state"
      )
    ).toMatchObject({
      kind: "takeover",
      source: "takeover-state",
      summary: "Approve the external write?",
      actionType: "wait",
    });
    expect(
      recommendationDetails.find(
        detail =>
          detail.kind === "route" &&
          detail.routeId === "workflow-structured-explanation-fallback:deep"
      )
    ).toMatchObject({
      kind: "route",
      source: "route-planner",
      routeId: "workflow-structured-explanation-fallback:deep",
      summary: "Confirm whether the route can write externally.",
    });
    expect(autopilotSummary?.explanation.remainingSteps).toMatchObject({
      currentStepKey: "execute",
      currentStepLabel: "Run execution",
      pendingSteps: [
        expect.objectContaining({
          key: "execute",
          label: "Run execution",
          status: "running",
          isCurrent: true,
        }),
      ],
      parallelBranchCount: expect.any(Number),
    });
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "locked",
      locked: true,
      changedReason: "Operator confirmation is still pending.",
    });
    expect(autopilotSummary?.destination).toMatchObject({
      id: "destination-structured-explanation-fallback",
      goal: "Goal from partial projection",
      request: "Request from partial projection",
      constraints: [],
      successCriteria: [],
      deliverables: [],
      missingInfo: ["Confirm whether the route can write externally."],
    });
    expect(autopilotSummary?.takeover.options).toEqual([
      {
        id: "approve",
        label: "Approve",
        description: "Continue the selected route.",
      },
    ]);
  });

  it("promotes structured destination missing-info details into the normalized summary list", async () => {
    const mission = makeMission("structured-destination-missing-info-only") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-structured-destination-missing-info-only",
        goal: "Structured destination gap",
        request: "Carry structured missing info through normalize",
        confidence: {
          level: "medium",
          reason: "Need one clarification before execution can continue.",
          signals: ["waiting-for-input"],
        },
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
        suggestedClarifications: [
          "Which workspace should the route continue in?",
        ],
        missingInfoDetails: [
          {
            item: "Confirm the target workspace.",
            impact: "Execution remains blocked until the workspace is confirmed.",
            blocking: true,
            clarification: "Which workspace should the route continue in?",
          },
        ],
      },
      route: {
        id: "route-structured-destination-missing-info-only",
        label: "Projected route",
        mode: "deep",
      },
      driveState: {
        state: "takeover-required",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: true,
        blocking: true,
      },
      execution: {
        currentStepStatus: "waiting",
      },
      recovery: {
        state: "watching",
        deviationCategory: "governance-deviation",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Structured destination gap",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting" })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.destination.confidence).toMatchObject({
      level: "medium",
      reason: "Need one clarification before execution can continue.",
      signals: ["waiting-for-input"],
    });
    expect(autopilotSummary?.destination.missingInfo).toEqual([
      "Confirm the target workspace.",
    ]);
    expect(autopilotSummary?.destination.suggestedClarifications).toEqual([
      "Which workspace should the route continue in?",
    ]);
    expect(autopilotSummary?.destination.missingInfoDetails).toEqual([
      {
        item: "Confirm the target workspace.",
        impact: "Execution remains blocked until the workspace is confirmed.",
        blocking: true,
        clarification: "Which workspace should the route continue in?",
      },
    ]);
    expect(autopilotSummary?.destination.impact).toBe(
      "Execution remains blocked until the workspace is confirmed."
    );
    expect(autopilotSummary?.destination.blockingReason).toBe(
      "Execution remains blocked until the workspace is confirmed."
    );
  });

  it("normalizes destination field aliases and fallback detail shapes", async () => {
    const mission = makeMission("destination-field-alias-fallbacks") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-field-alias-fallbacks",
        goal: "Alias-backed destination",
        request: "Normalize enhanced destination fields from aliases.",
        auxiliary_task_types: ["coordination"],
        guardrails: ["Use the approved workspace only."],
        acceptance_criteria: ["Operator can review the workspace choice."],
        sub_goals: ["Identify workspace owner.", "Confirm approval path."],
        deliverables: [],
        open_questions: ["Confirm the target workspace."],
        clarification_details: [
          {
            question: "Confirm the target workspace.",
            impact_summary: "Execution remains paused without workspace authority.",
            blocking: true,
            suggested_clarification:
              "Which workspace has approval authority for this release?",
          },
        ],
        clarification_questions: [
          "Which workspace has approval authority for this release?",
          "Which workspace has approval authority for this release?",
        ],
        blocking_reason: "Workspace authority is not confirmed.",
      },
      route: {
        id: "route-destination-field-alias-fallbacks",
        label: "Projected route",
        mode: "deep",
      },
      driveState: {
        state: "takeover-required",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: true,
        blocking: true,
      },
      execution: {
        currentStepStatus: "waiting",
      },
      recovery: {
        state: "watching",
        deviationCategory: "governance-deviation",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Alias-backed destination.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting" })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.destination).toMatchObject({
      auxiliaryTaskTypes: ["coordination"],
      constraints: ["Use the approved workspace only."],
      successCriteria: ["Operator can review the workspace choice."],
      missingInfo: ["Confirm the target workspace."],
      impact: "Execution remains paused without workspace authority.",
      blockingReason: "Workspace authority is not confirmed.",
    });
    expect(autopilotSummary?.destination.subGoals).toEqual([
      {
        id: "destination-sub-goal:1",
        title: "Identify workspace owner.",
        source: "mission-text",
        status: null,
      },
      {
        id: "destination-sub-goal:2",
        title: "Confirm approval path.",
        source: "mission-text",
        status: null,
      },
    ]);
    expect(autopilotSummary?.destination.missingInfoDetails).toEqual([
      {
        item: "Confirm the target workspace.",
        impact: "Execution remains paused without workspace authority.",
        blocking: true,
        clarification:
          "Which workspace has approval authority for this release?",
      },
    ]);
    expect(autopilotSummary?.destination.suggestedClarifications).toEqual([
      "Which workspace has approval authority for this release?",
    ]);
    expect(
      useTasksStore.getState().detailsById[mission.id].autopilotSummary
        ?.destination.subGoals
    ).toEqual([
      {
        id: "destination-sub-goal:1",
        title: "Identify workspace owner.",
        source: "mission-text",
        status: null,
      },
      {
        id: "destination-sub-goal:2",
        title: "Confirm approval path.",
        source: "mission-text",
        status: null,
      },
    ]);
  });

  it("preserves destination lock state across projected task summary and detail", async () => {
    const mission = makeMission("destination-lock-state-projection") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-lock-state-projection",
        goal: "Locked destination state",
        request: "Keep destination lock state visible in cockpit detail.",
        lock_state: "confirmed",
        locked_at: "2026-04-27T09:00:00.000Z",
        modified_at: "2026-04-27T10:00:00.000Z",
        constraints: ["Use approved evidence only."],
        successCriteria: ["Goal card renders the lock state."],
        deliverables: ["locked-goal.md"],
        missingInfo: [],
      },
      route: {
        id: "route-destination-lock-state-projection",
        label: "Projected route",
        mode: "standard",
      },
      driveState: {
        state: "executing",
        riskLevel: "low",
        confidence: "high",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepStatus: "running",
      },
      recovery: {
        state: "healthy",
        deviationCategory: "none",
      },
      evidence: {
        eventCount: 1,
        artifactCount: 1,
        trustLevel: "verified",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [`audit-${mission.id}:destination.locked`],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Locked destination state is preserved.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const summary = useTasksStore.getState().tasks[0]?.autopilotSummary;
    const detail = useTasksStore.getState().detailsById[mission.id].autopilotSummary;

    expect(summary?.destination).toMatchObject({
      lockState: "locked",
      confirmedAt: "2026-04-27T09:00:00.000Z",
      modifiedAt: "2026-04-27T10:00:00.000Z",
    });
    expect(detail?.destination).toMatchObject({
      lockState: "locked",
      confirmedAt: "2026-04-27T09:00:00.000Z",
      modifiedAt: "2026-04-27T10:00:00.000Z",
    });
  });

  it("keeps planet-hydrated detail autopilot aligned with the planet summary chain", async () => {
    const mission = makeMission("planet-detail-alignment", {
      status: "running",
      currentStageKey: "execute",
      projection: {
        workflowId: "workflow-planet-detail-alignment",
        instanceId: "instance-planet-detail-alignment",
      },
    });
    const planet = makePlanet(mission.id, {
      status: "waiting",
      waitingFor: "Clarify the target audience.",
      currentStageKey: "understand",
      currentStageLabel: "Understand request",
    });

    mockGetPlanetInterior.mockResolvedValue({
      interior: makeInterior({
        stages: [
          {
            key: "understand",
            label: "Understand request",
            status: "running",
            progress: 35,
            detail: "Collecting request details.",
            arcStart: 0,
            arcEnd: 120,
            midAngle: 60,
          },
        ],
        agents: [
          {
            id: "mission-core",
            name: "Mission Core",
            role: "orchestrator",
            sprite: "mission-core",
            status: "working",
            stageKey: "understand",
            stageLabel: "Understand request",
            progress: 35,
            currentAction: "Collect clarification",
            angle: 60,
          },
        ],
      }),
    });
    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [planet],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh({ preferredTaskId: mission.id });

    const summary = useTasksStore.getState().tasks[0];
    const detail = useTasksStore.getState().detailsById[mission.id];

    expect(detail.autopilotSummary).toEqual(summary.autopilotSummary);
    expect(detail.autopilotSummary).toMatchObject({
      route: {
        currentStageKey: "understand",
        currentStageLabel: "Understand request",
      },
      driveState: {
        state: "takeover-required",
        waitingForUser: true,
      },
      takeover: {
        required: true,
        reason: "Clarify the target audience.",
      },
      destination: {
        missingInfo: ["Clarify the target audience."],
      },
    });
  });

  it("keeps planet-only summaries aligned when no matching mission exists", async () => {
    const planet = makePlanet("planet-only", {
      status: "waiting",
      waitingFor: "Clarify the target audience.",
      currentStageKey: "understand",
      currentStageLabel: "Understand request",
    });

    const planetResponse: ListMissionPlanetsResponse = {
      ok: true,
      planets: [planet],
      edges: [],
    };
    mockListPlanets.mockResolvedValue(planetResponse);
    mockListMissions.mockResolvedValue({ ok: true, tasks: [] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const summary = useTasksStore.getState().tasks[0];

    expect(summary.autopilotSummary).toMatchObject({
      source: "client-planet-projection",
      destination: {
        id: "planet-only",
        goal: "Planet planet-only",
        constraints: ["Mission kind: analysis"],
        successCriteria: [
          "Mission summary is available",
        ],
        deliverables: ["Mission result package"],
        missingInfo: ["Clarify the target audience."],
      },
      route: {
        id: "planet-only",
        currentStageKey: "understand",
        currentStageLabel: "Understand request",
        takeoverPointIds: ["planet-only:takeover"],
      },
      driveState: {
        state: "takeover-required",
        waitingForUser: true,
        riskLevel: "medium",
      },
      takeover: {
        required: true,
        blocking: true,
        type: "clarification",
        reason: "Clarify the target audience.",
      },
      bindings: {
        missionId: "planet-only",
        workflowId: "planet-only",
      },
    });
  });

  it("backfills route selection changedReason from route changeReason and replan reason", async () => {
    const mission = makeMission("route-change-reason-fallback") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-route-change-reason-fallback",
        goal: "Route reason fallback",
        request: "Preserve route mutation context",
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "route-route-change-reason-fallback",
        label: "Projected route",
        mode: "standard",
        selectionStatus: "replanned",
        changeReason: "Runtime selected a safer route after validation drift.",
        selection: {
          status: "replanned",
          mode: "runtime_replanned",
          locked: false,
          canSwitch: true,
          switchRequiresConfirmation: false,
          changedBy: "runtime",
          changedReason: null,
        },
        replan: {
          active: true,
          reason: "Runtime selected a safer route after validation drift.",
          fromRouteId: "route-route-change-reason-fallback:deep",
          toRouteId: "route-route-change-reason-fallback:standard",
          triggeredBy: "runtime",
        },
      },
      driveState: {
        state: "replanning",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepStatus: "running",
      },
      recovery: {
        state: "watching",
        deviationCategory: "route-deviation",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Route was replanned.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.route.changeReason).toBe(
      "Runtime selected a safer route after validation drift."
    );
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "replanned",
      changedReason: "Runtime selected a safer route after validation drift.",
    });
    expect(autopilotSummary?.route.replan.reason).toBe(
      "Runtime selected a safer route after validation drift."
    );
  });

  it("preserves destination clarification details while promoting structured missing-info entries", async () => {
    const mission = makeMission("destination-clarification-preserved") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-destination-clarification-preserved",
        goal: "Keep clarification details visible",
        request: "Carry clarification fields through client normalization",
        taskType: "coordination",
        auxiliaryTaskTypes: [],
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
        missingInfoDetails: [
          {
            item: "Confirm the external approval workspace.",
            impact: "Execution cannot continue until the correct workspace is confirmed.",
            blocking: true,
            clarification: "Which workspace has approval authority for this release?",
          },
        ],
      },
      route: {
        id: "route-destination-clarification-preserved",
        label: "Projected route",
        mode: "standard",
      },
      driveState: {
        state: "takeover-required",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: true,
        blocking: true,
      },
      execution: {
        currentStepStatus: "waiting",
      },
      recovery: {
        state: "watching",
        deviationCategory: "governance-deviation",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Waiting for workspace clarification.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id, { status: "waiting" })],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.destination.missingInfoDetails).toEqual([
      {
        item: "Confirm the external approval workspace.",
        impact: "Execution cannot continue until the correct workspace is confirmed.",
        blocking: true,
        clarification: "Which workspace has approval authority for this release?",
      },
    ]);
    expect(autopilotSummary?.destination.suggestedClarifications).toEqual([
      "Which workspace has approval authority for this release?",
    ]);
  });

  it("infers user-driven replan semantics from partial route fields", async () => {
    const mission = makeMission("partial-user-replan-fallback") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-partial-user-replan-fallback",
        goal: "Preserve user route replan semantics",
        request: "Infer user-triggered replan details from partial route fields.",
        taskType: "coordination",
        auxiliaryTaskTypes: [],
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "workflow-partial-user-replan-fallback",
        label: "Projected route",
        mode: "standard",
        status: "running",
        selectedRouteId: "workflow-partial-user-replan-fallback:safe",
        recommendedRouteId: "workflow-partial-user-replan-fallback:fast",
        candidateRoutes: [
          {
            id: "workflow-partial-user-replan-fallback:fast",
            label: "Fast route",
            mode: "fast",
            summary: "Ship faster with less verification.",
            recommended: true,
            selected: false,
            locked: false,
            riskLevel: "medium",
            takeoverLoad: "medium",
            stageKeys: ["plan", "execute"],
          },
          {
            id: "workflow-partial-user-replan-fallback:safe",
            label: "Safe route",
            mode: "standard",
            summary: "Slow down and verify the publish path.",
            recommended: false,
            selected: true,
            locked: false,
            riskLevel: "low",
            takeoverLoad: "high",
            stageKeys: ["plan", "execute"],
          },
        ],
        selectionStatus: "replanned",
        changeReason: "User switched to the safer route before publish.",
        selection: {
          status: "replanned",
          locked: false,
          canSwitch: true,
          switchRequiresConfirmation: false,
        },
        replan: {
          active: false,
          reason: null,
          fromRouteId: null,
          toRouteId: null,
          triggeredBy: "user",
        },
      },
      driveState: {
        state: "planning",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepKey: "plan",
        currentStepLabel: "Build execution plan",
        currentStepStatus: "running",
      },
      recovery: {
        state: "watching",
        deviationCategory: "route-deviation",
      },
      evidence: {
        eventCount: 1,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: "workflow-partial-user-replan-fallback",
          replayId: `replay-${mission.id}`,
          sessionId: `session-${mission.id}`,
          timelineId: `${mission.id}:timeline`,
          routeIds: [
            "workflow-partial-user-replan-fallback:fast",
            "workflow-partial-user-replan-fallback:safe",
          ],
          recommendedRouteId: "workflow-partial-user-replan-fallback:fast",
          selectedRouteId: "workflow-partial-user-replan-fallback:safe",
          routeStageKeys: ["plan", "execute"],
          currentStepKey: "plan",
          runtimeEventIds: [],
          decisionIds: ["decision-partial-user-replan-1"],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "User switched to the safer route before publish.",
        remainingSteps: {
          currentStepKey: "plan",
          currentStepLabel: "Build execution plan",
          mainlineSteps: [],
          pendingSteps: [],
          parallelBranchCount: 0,
          replanChangeSummary: "User switched to the safer route before publish.",
          selectedRouteId: "workflow-partial-user-replan-fallback:safe",
          routeSelectionStatus: "replanned",
        },
      },
      bindings: {
        missionId: mission.id,
        workflowId: "workflow-partial-user-replan-fallback",
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "replanned",
      mode: "user_selected",
      changedBy: "user",
      changedReason: "User switched to the safer route before publish.",
    });
    expect(autopilotSummary?.route.replan).toMatchObject({
      active: true,
      reason: "User switched to the safer route before publish.",
      fromRouteId: "workflow-partial-user-replan-fallback:fast",
      toRouteId: "workflow-partial-user-replan-fallback:safe",
      triggeredBy: "user",
    });
  });

  it("backfills route state from projected correlation and explanation when route fields are partial", async () => {
    const mission = makeMission("route-state-correlation-fallback") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-route-state-correlation-fallback",
        goal: "Correlation-backed route state",
        request: "Keep route state aligned across summary consumers",
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "route-route-state-correlation-fallback",
        label: "Projected route",
        mode: "standard",
        candidateRoutes: [
          {
            id: "wf-route-state-correlation-fallback:fast",
            label: "Fast route",
            mode: "fast",
            summary: "Favor quicker delivery.",
            recommended: false,
            selected: false,
            locked: false,
            riskLevel: "medium",
            takeoverLoad: "medium",
            stageKeys: ["plan", "execute"],
          },
          {
            id: "wf-route-state-correlation-fallback:deep",
            label: "Deep route",
            mode: "deep",
            summary: "Favor safer execution.",
            recommended: false,
            selected: false,
            locked: false,
            riskLevel: "low",
            takeoverLoad: "high",
            stageKeys: ["plan", "execute"],
          },
        ],
        selection: {
          status: "user-selected",
          mode: null,
          locked: false,
          canSwitch: true,
          switchRequiresConfirmation: false,
          changedBy: "user",
          changedReason: "Operator selected the safer route before launch.",
        },
        selectionStatus: null,
        recommendedRouteId: null,
        selectedRouteId: null,
      },
      driveState: {
        state: "planning",
        riskLevel: "medium",
        confidence: "medium",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepKey: "plan",
        currentStepLabel: "Build execution plan",
        currentStepStatus: "running",
      },
      recovery: {
        state: "healthy",
        deviationCategory: "none",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: `replay-${mission.id}`,
          sessionId: `session-${mission.id}`,
          timelineId: `${mission.id}:timeline`,
          routeIds: [
            "wf-route-state-correlation-fallback:fast",
            "wf-route-state-correlation-fallback:deep",
          ],
          recommendedRouteId: "wf-route-state-correlation-fallback:fast",
          selectedRouteId: "wf-route-state-correlation-fallback:deep",
          routeStageKeys: ["plan", "execute"],
          currentStepKey: "plan",
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Route selection is ready.",
        currentState: {
          summary: "Route selection is ready.",
          driveState: "planning",
          missionStatus: "running",
          currentStageKey: "plan",
          currentStageLabel: "Build execution plan",
          workflowStatus: "running",
          workflowStage: "plan",
          routeSelectionStatus: "user-selected",
          selectedRouteId: "wf-route-state-correlation-fallback:deep",
          correlationTimelineId: `${mission.id}:timeline`,
          sources: ["route-planner"],
          updatedAt: new Date(now).toISOString(),
        },
        recommendationDetails: [
          {
            kind: "route",
            source: "route-planner",
            routeId: "wf-route-state-correlation-fallback:deep",
            actionType: null,
            takeoverType: null,
            decisionId: null,
            routeSelectionStatus: null,
            correlationTimelineId: null,
            summary: "Operator selected the safer route before launch.",
            updatedAt: new Date(now).toISOString(),
          },
        ],
        remainingSteps: {
          currentStepKey: "plan",
          currentStepLabel: "Build execution plan",
          mainlineSteps: [
            {
              key: "plan",
              label: "Build execution plan",
              status: "running",
              isCurrent: true,
            },
          ],
          pendingSteps: [
            {
              key: "plan",
              label: "Build execution plan",
              status: "running",
              isCurrent: true,
            },
          ],
          parallelBranchCount: 1,
          replanChangeSummary: null,
          selectedRouteId: "wf-route-state-correlation-fallback:deep",
          routeSelectionStatus: "user-selected",
        },
        riskSummary: [],
        evidenceHints: [],
        telemetrySignals: [],
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.route).toMatchObject({
      recommendedRouteId: "wf-route-state-correlation-fallback:fast",
      selectedRouteId: "wf-route-state-correlation-fallback:deep",
      selectionStatus: "user-selected",
    });
    expect(autopilotSummary?.route.selection).toMatchObject({
      status: "user-selected",
      mode: "user_selected",
      changedReason: "Operator selected the safer route before launch.",
    });
    expect(autopilotSummary?.evidence.correlation).toMatchObject({
      timelineId: `${mission.id}:timeline`,
      recommendedRouteId: "wf-route-state-correlation-fallback:fast",
      selectedRouteId: "wf-route-state-correlation-fallback:deep",
      currentStepKey: "plan",
    });
    expect(autopilotSummary?.explanation.currentState).toMatchObject({
      routeSelectionStatus: "user-selected",
      selectedRouteId: "wf-route-state-correlation-fallback:deep",
      correlationTimelineId: `${mission.id}:timeline`,
    });
    expect(autopilotSummary?.explanation.recommendationDetails?.[0]).toMatchObject({
      routeSelectionStatus: "user-selected",
      correlationTimelineId: `${mission.id}:timeline`,
    });
    expect(autopilotSummary?.explanation.remainingSteps).toMatchObject({
      routeSelectionStatus: "user-selected",
      selectedRouteId: "wf-route-state-correlation-fallback:deep",
    });
  });

  it("normalizes evidence correlation audit and lineage ids from single-value aliases", async () => {
    const mission = makeMission("evidence-correlation-aliases") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-evidence-correlation-aliases",
        goal: "Evidence correlation aliases",
        request: "Accept auditId and lineageId aliases",
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "route-evidence-correlation-aliases",
        label: "Projected route",
        mode: "deep",
      },
      driveState: {
        state: "reviewing",
        riskLevel: "low",
        confidence: "high",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepStatus: "running",
      },
      recovery: {
        state: "healthy",
        deviationCategory: "none",
      },
      evidence: {
        eventCount: 1,
        artifactCount: 1,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: `replay-${mission.id}`,
          sessionId: `session-${mission.id}`,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
          auditId: `audit-${mission.id}:1`,
          lineageId: `lineage-${mission.id}:1`,
        },
      },
      explanation: {
        current: "Evidence aliases are preserved.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.evidence.correlation.auditEventIds).toEqual([
      `audit-${mission.id}:1`,
    ]);
    expect(autopilotSummary?.evidence.correlation.lineageIds).toEqual([
      `lineage-${mission.id}:1`,
    ]);
  });

  it("deduplicates projected destination confidence signals while preserving reason fallback", async () => {
    const mission = makeMission("destination-confidence-signal-fallback") as MissionRecord & {
      autopilotSummary?: unknown;
    };

    mission.autopilotSummary = {
      version: "shared-autopilot/v1",
      source: "shared-mission-projection",
      destination: {
        id: "destination-destination-confidence-signal-fallback",
        goal: "Confidence signal fallback",
        request: "Normalize confidence signals",
        confidence: {
          level: "high",
          reason: "Projected evidence is complete enough for delivery review.",
          signals: ["artifact-ready", "artifact-ready", "review-window-open"],
        },
        constraints: [],
        successCriteria: [],
        deliverables: [],
        missingInfo: [],
      },
      route: {
        id: "route-destination-confidence-signal-fallback",
        label: "Projected route",
        mode: "deep",
      },
      driveState: {
        state: "reviewing",
        riskLevel: "low",
        confidence: "high",
      },
      takeover: {
        required: false,
        blocking: false,
      },
      execution: {
        currentStepStatus: "running",
      },
      recovery: {
        state: "healthy",
        deviationCategory: "none",
      },
      evidence: {
        eventCount: 0,
        artifactCount: 0,
        trustLevel: "partial",
        gaps: [],
        timeline: [],
        correlation: {
          missionId: mission.id,
          workflowId: `workflow-${mission.id}`,
          replayId: null,
          sessionId: null,
          timelineId: `${mission.id}:timeline`,
          routeIds: [],
          routeStageKeys: [],
          runtimeEventIds: [],
          decisionIds: [],
          operatorActionIds: [],
          auditEventIds: [],
          lineageIds: [],
        },
      },
      explanation: {
        current: "Confidence signal fallback.",
      },
      bindings: {
        missionId: mission.id,
        workflowId: `workflow-${mission.id}`,
        executorJobId: null,
        instanceId: `instance-${mission.id}`,
      },
    };

    mockListPlanets.mockResolvedValue({
      ok: true,
      planets: [makePlanet(mission.id)],
      edges: [],
    });
    mockListMissions.mockResolvedValue({ ok: true, tasks: [mission] });

    const useTasksStore = await importFreshStore();
    await useTasksStore.getState().refresh();

    const autopilotSummary = useTasksStore.getState().tasks[0]?.autopilotSummary;

    expect(autopilotSummary?.destination.confidence).toMatchObject({
      level: "high",
      reason: "Projected evidence is complete enough for delivery review.",
      signals: ["artifact-ready", "review-window-open"],
    });
  });
});
