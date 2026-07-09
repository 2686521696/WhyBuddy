import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MissionTaskDetail,
  MissionTaskSummary,
} from "@/lib/tasks-store";

const { tasksState, workflowState, projectState } = vi.hoisted(() => {
  const now = Date.now();
  const missionSummary: MissionTaskSummary = {
    id: "mission-1",
    title: "Review launch-free task workbench",
    kind: "general",
    sourceText: "The tasks page should inspect existing work only.",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 48,
    currentStageKey: "execution",
    currentStageLabel: "Execution",
    summary: "Task workbench tabs stay focused on follow-up.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    departmentLabels: ["Engineering"],
    taskCount: 4,
    completedTaskCount: 2,
    messageCount: 3,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
  };
  const missionDetail: MissionTaskDetail = {
    ...missionSummary,
    workflow: {
      id: "workflow-1",
      directive: missionSummary.sourceText,
      status: "running",
      current_stage: "execution",
      departments_involved: ["Engineering"],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date(now).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    runtimeChannels: {
      socket: { status: "disconnected", label: "Socket", detail: "Idle" },
      callback: { status: "idle", label: "Callback", detail: "Idle" },
    },
    decisionHistory: [],
    operatorActions: [],
  };
  const secondMissionSummary = {
    ...missionSummary,
    id: "mission-2",
    title: "Unassigned task",
    sourceText: "This task is not linked to the current project.",
  };
  const secondMissionDetail = {
    ...missionDetail,
    id: "mission-2",
    title: "Unassigned task",
    sourceText: "This task is not linked to the current project.",
  };
  const tasksState = {
    ensureReady: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    selectTask: vi.fn(),
    submitOperatorAction: vi.fn(async () => null),
    setDecisionNote: vi.fn(),
    launchDecision: vi.fn(async () => null),
    tasks: [missionSummary, secondMissionSummary],
    detailsById: {
      "mission-1": missionDetail,
      "mission-2": secondMissionDetail,
    },
    selectedTaskId: "mission-1" as string | null,
    loading: false,
    ready: true,
    error: null as string | null,
    decisionNotes: {},
    operatorActionLoadingByMissionId: {},
  };
  const workflowState = {
    workflows: [
      {
        id: "workflow-1",
        missionId: "mission-1",
        directive: "Review launch-free task workbench",
        status: "running",
        current_stage: "execution",
        departments_involved: ["Engineering"],
        started_at: null,
        completed_at: null,
        results: {},
        created_at: new Date(now).toISOString(),
      },
    ],
    agents: [{ id: "agent-1", name: "Coordinator" }],
    currentWorkflow: null,
    currentWorkflowId: null,
    fetchAgents: vi.fn(async () => {}),
    fetchStages: vi.fn(async () => {}),
    fetchWorkflows: vi.fn(async () => {}),
    setCurrentWorkflow: vi.fn(),
  };
  const projectState = {
    currentProject: null as null | { id: string; name: string },
    projects: [] as Array<{
      id: string;
      name: string;
      currentSpecId?: string;
      currentRouteId?: string;
    }>,
    specs: [] as Array<{ id: string; projectId: string; title: string }>,
    routes: [] as Array<{
      id: string;
      projectId: string;
      specId?: string;
      title: string;
      steps?: Array<{ role?: string }>;
    }>,
    missions: [] as Array<{ projectId: string; missionId: string }>,
    clarificationQuestions: [] as Array<{
      id: string;
      projectId: string;
      text: string;
      required: boolean;
      defaultAssumption?: string;
      answer?: string;
      answeredAt?: string;
      skippedAt?: string;
    }>,
    artifacts: [] as Array<{
      id: string;
      projectId: string;
      title: string;
      sourceMissionId?: string;
    }>,
    evidence: [] as Array<{
      id: string;
      projectId: string;
      type?: string;
      title: string;
      sourceMissionId?: string;
    }>,
    selectProject: vi.fn(),
    addProjectMessage: vi.fn(),
    addProjectArtifact: vi.fn(),
    addProjectEvidence: vi.fn(),
    linkMissionToProject: vi.fn(),
  };

  return { tasksState, workflowState, projectState };
});

import {
  buildTaskProjectRelationshipSummary,
  buildTaskClarificationTakeoverSummary,
  buildProjectTaskArchiveRecords,
  buildProjectOperatorActionRecord,
  linkTaskToCurrentProject,
  mapTaskStatusToProjectMissionStatus,
  recordProjectOperatorAction,
} from "./TasksPage";
import TasksPage from "./TasksPage";

vi.mock("@/hooks/useViewportTier", () => ({
  useViewportTier: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    tier: "desktop",
  }),
  useViewportWidth: () => 1440,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    copy: {
      tasks: {
        listPage: {
          actionSuccess: (label: string) => `Action succeeded: ${label}`,
          actionError: "Action failed",
        },
        statuses: {
          action: {
            approve: "Approve",
            reject: "Reject",
            "request-changes": "Request changes",
            markBlocked: "Mark blocked",
            delegate: "Delegate",
          },
        },
      },
    },
  }),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value?: string;
  }) => (
    <div data-testid="tasks-workbench-tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="tasks-workbench-tab-list">{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
    disabled,
  }: {
    children?: React.ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <button
      data-testid={`tasks-workbench-tab-${value}`}
      data-value={value}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  TabsContent: ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => <div data-testid={`tasks-workbench-panel-${value}`}>{children}</div>,
}));

vi.mock("@/components/tasks/TasksCockpitDetail", () => ({
  TasksCockpitDetail: ({ detail }: { detail?: { artifacts?: Array<{ title: string }> } | null }) => (
    <section
      data-testid="tasks-cockpit-detail"
      data-artifact-titles={(detail?.artifacts ?? [])
        .map(artifact => artifact.title)
        .join(",")}
    >
      Task detail tab
    </section>
  ),
}));

vi.mock("@/components/tasks/TasksQueueRail", () => ({
  TasksQueueRail: ({
    tasks,
    projectMetaByTaskId,
  }: {
    tasks: Array<{ id: string }>;
    projectMetaByTaskId?: Record<
      string,
      {
        projectName: string | null;
        routeTitle: string | null;
        specTitle: string | null;
        sourceLabel: string;
      }
    >;
  }) => (
    <aside
      data-testid="tasks-queue-rail"
      data-task-ids={tasks.map(task => task.id).join(",")}
      data-project-meta={tasks
        .map(task => {
          const meta = projectMetaByTaskId?.[task.id];
          return [
            task.id,
            meta?.projectName ?? "none",
            meta?.routeTitle ?? "none",
            meta?.specTitle ?? "none",
            meta?.sourceLabel ?? "none",
          ].join(":");
        })
        .join("|")}
    >
      Task queue rail
    </aside>
  ),
}));

vi.mock("@/components/office/OfficeAgentInspectorPanel", () => ({
  OfficeAgentInspectorPanel: () => (
    <section data-testid="office-agent-inspector-panel">Agent panel</section>
  ),
}));

vi.mock("@/components/office/OfficeWorkflowContextPanels", () => ({
  OfficeWorkflowFlowPanel: () => (
    <section data-testid="office-workflow-flow-panel">Flow panel</section>
  ),
  OfficeMemoryReportsPanel: () => (
    <section data-testid="office-memory-reports-panel">Memory panel</section>
  ),
  OfficeWorkflowHistoryPanel: () => (
    <section data-testid="office-workflow-history-panel">History panel</section>
  ),
}));

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: (selector: (state: typeof tasksState) => unknown) =>
    selector(tasksState),
}));

vi.mock("@/lib/project-store", () => ({
  selectCurrentProject: (state: typeof projectState) => state.currentProject,
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selector(workflowState),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("TasksPage workbench tabs", () => {
  beforeEach(() => {
    tasksState.selectedTaskId = "mission-1";
    projectState.currentProject = null;
    projectState.projects = [];
    projectState.specs = [];
    projectState.routes = [];
    projectState.missions = [];
    projectState.clarificationQuestions = [];
    projectState.artifacts = [];
    projectState.evidence = [];
    projectState.selectProject.mockClear();
    projectState.addProjectMessage.mockClear();
    projectState.addProjectArtifact.mockClear();
    projectState.addProjectEvidence.mockClear();
    projectState.linkMissionToProject.mockClear();
    tasksState.selectTask.mockClear();
    workflowState.fetchAgents.mockClear();
    workflowState.fetchStages.mockClear();
    workflowState.fetchWorkflows.mockClear();
    workflowState.setCurrentWorkflow.mockClear();
  });

  it("renders the dedicated task workbench tabs without a launch tab", () => {
    const markup = renderToStaticMarkup(<TasksPage />);

    expect(markup).toContain('data-testid="tasks-queue-rail"');
    expect(markup).toContain('data-testid="tasks-page-dashboard"');
    expect(markup).toContain('data-testid="tasks-page-focus-card"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-task"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-flow"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-agent"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-memory"');
    expect(markup).toContain('data-testid="tasks-workbench-tab-history"');
    expect(markup).toContain(">Agent</button>");
    expect(markup).not.toContain('data-testid="tasks-workbench-tab-launch"');
    expect(markup).not.toContain('data-value="launch"');
    expect(markup).toContain('data-testid="tasks-cockpit-detail"');
  });

  it("scopes the task queue to the current project when a project is selected", () => {
    projectState.currentProject = {
      id: "project-1",
      name: "Permission System",
    };
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
    ];
    projectState.missions = [
      {
        projectId: "project-1",
        missionId: "mission-1",
      },
    ];
    projectState.evidence = [
      {
        id: "evidence-1",
        projectId: "project-1",
        title: "Route selected",
        sourceMissionId: "mission-1",
      },
    ];
    projectState.clarificationQuestions = [
      {
        id: "clarification-answered",
        projectId: "project-1",
        text: "Who approves the launch?",
        required: true,
        answer: "Security lead.",
        answeredAt: "2026-04-30T00:00:00.000Z",
      },
      {
        id: "clarification-open",
        projectId: "project-1",
        text: "Which rollback window is acceptable?",
        required: true,
      },
      {
        id: "clarification-other",
        projectId: "project-2",
        text: "Should not appear.",
        required: true,
      },
    ];

    const markup = renderToStaticMarkup(<TasksPage />);

    expect(markup).toContain('data-testid="tasks-project-scope-banner"');
    expect(markup).toContain("Permission System");
    expect(markup).toContain('data-task-ids="mission-1"');
    expect(markup).not.toContain('data-task-ids="mission-1,mission-2"');
    expect(markup).toContain('data-testid="tasks-project-relationship-strip"');
    expect(markup).toContain(
      'data-testid="tasks-clarification-takeover-summary"'
    );
    expect(markup).toContain("Takeover context: 1 resolved / 1 open");
    expect(markup).toContain("1 required / 0 skippable");
    expect(markup).toContain("Which rollback window is acceptable?");
    expect(markup).not.toContain("Should not appear.");
  });

  it("uses a route project id as a hard task scope", () => {
    tasksState.selectedTaskId = "mission-2";
    projectState.currentProject = {
      id: "project-2",
      name: "Other Project",
    };
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
      {
        id: "project-2",
        name: "Other Project",
      },
    ];
    projectState.missions = [
      {
        projectId: "project-1",
        missionId: "mission-1",
      },
      {
        projectId: "project-2",
        missionId: "mission-2",
      },
    ];

    const markup = renderToStaticMarkup(<TasksPage projectId="project-1" />);

    expect(markup).toContain('data-testid="tasks-project-scope-banner"');
    expect(markup).toContain("Permission System");
    expect(markup).toContain('data-task-ids="mission-1"');
    expect(markup).not.toContain('data-task-ids="mission-1,mission-2"');
    expect(markup).not.toContain('data-testid="tasks-assign-current-project"');
  });

  it("only renders artifacts from the selected project mission", () => {
    tasksState.selectedTaskId = "mission-2";
    tasksState.detailsById["mission-1"] = {
      ...tasksState.detailsById["mission-1"],
      artifacts: [
        {
          id: "page-screenshot",
          title: "page-screenshot.png",
          description: "Browser screenshot",
          kind: "file",
          format: "png",
          previewType: "image",
        },
      ],
    };
    tasksState.detailsById["mission-2"] = {
      ...tasksState.detailsById["mission-2"],
      artifacts: [
        {
          id: "other-project-log",
          title: "other-project.log",
          description: "Outside project log",
          kind: "log",
          format: "log",
        },
      ],
    };
    projectState.currentProject = {
      id: "project-2",
      name: "Other Project",
    };
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
      {
        id: "project-2",
        name: "Other Project",
      },
    ];
    projectState.missions = [
      {
        projectId: "project-1",
        missionId: "mission-1",
      },
      {
        projectId: "project-2",
        missionId: "mission-2",
      },
    ];

    const markup = renderToStaticMarkup(<TasksPage projectId="project-1" />);

    expect(markup).toContain('data-task-ids="mission-1"');
    expect(markup).toContain('data-artifact-titles="page-screenshot.png"');
    expect(markup).not.toContain("other-project.log");
  });

  it("passes project, route, spec and source metadata to task cards", () => {
    projectState.currentProject = {
      id: "project-1",
      name: "Permission System",
    };
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
        currentSpecId: "spec-1",
        currentRouteId: "route-1",
      },
    ];
    projectState.specs = [
      {
        id: "spec-1",
        projectId: "project-1",
        title: "Permission Spec",
      },
    ];
    projectState.routes = [
      {
        id: "route-1",
        projectId: "project-1",
        specId: "spec-1",
        title: "Spec-first route",
      },
    ];
    projectState.missions = [
      {
        projectId: "project-1",
        missionId: "mission-1",
      },
    ];

    const markup = renderToStaticMarkup(<TasksPage />);

    expect(markup).toContain(
      'data-project-meta="mission-1:Permission System:Spec-first route:Permission Spec:'
    );
  });

  it("builds paired project message and evidence records for operator actions", () => {
    const record = buildProjectOperatorActionRecord({
      action: "mark-blocked",
      reason: "Waiting for security approval",
    });

    expect(record.message).toEqual({
      role: "operator",
      kind: "decision",
      content: "Operator action: mark-blocked\nWaiting for security approval",
    });
    expect(record.evidence).toEqual({
      type: "decision",
      title: "Operator action: mark-blocked",
      detail: "Waiting for security approval",
    });
  });

  it("writes operator actions into ProjectMessage and ProjectEvidence", () => {
    const addProjectMessage = vi.fn();
    const addProjectEvidence = vi.fn();

    recordProjectOperatorAction({
      projectId: "project-1",
      missionId: "mission-1",
      action: "resume",
      addProjectMessage,
      addProjectEvidence,
    });

    expect(addProjectMessage).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceMissionId: "mission-1",
      role: "operator",
      kind: "decision",
      content:
        "Operator action: resume\nOperator action submitted from project execution center.",
    });
    expect(addProjectEvidence).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceMissionId: "mission-1",
      type: "decision",
      title: "Operator action: resume",
      detail: "Operator action submitted from project execution center.",
    });
  });

  it("builds project archive records from task artifacts and log summaries", () => {
    const records = buildProjectTaskArchiveRecords({
      projectId: "project-1",
      missionId: "mission-1",
      detail: {
        ...tasksState.detailsById["mission-1"],
        artifacts: [
          {
            id: "artifact-local",
            title: "Executor report",
            description: "Runtime produced a summary report.",
            kind: "report",
            downloadUrl: "/api/tasks/mission-1/artifacts/0/download",
          },
          {
            id: "artifact-existing",
            title: "Existing report",
            description: "Already archived.",
            kind: "report",
          },
        ],
        logSummary: [
          { label: "Executor", value: "3 runtime events" },
          { label: "Callback", value: "Idle" },
        ],
      },
      existingArtifacts: [
        {
          id: "artifact-archived",
          projectId: "project-1",
          type: "report",
          title: "Existing report",
          sourceMissionId: "mission-1",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      existingEvidence: [
        {
          id: "evidence-archived",
          projectId: "project-1",
          type: "log",
          title: "Task log: Callback",
          detail: "Idle",
          sourceMissionId: "mission-1",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
    });

    expect(records).toEqual({
      artifacts: [
        {
          type: "report",
          title: "Executor report",
          path: "/api/tasks/mission-1/artifacts/0/download",
          contentPreview: "Runtime produced a summary report.",
        },
      ],
      evidence: [
        {
          type: "log",
          title: "Task log: Executor",
          detail: "3 runtime events",
        },
      ],
    });
  });

  it("hides unassigned tasks while a current project is active", () => {
    tasksState.selectedTaskId = "mission-2";
    projectState.currentProject = {
      id: "project-1",
      name: "Permission System",
    };
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
      },
    ];
    projectState.missions = [
      {
        projectId: "project-1",
        missionId: "mission-1",
      },
    ];

    const markup = renderToStaticMarkup(<TasksPage />);

    expect(markup).toContain('data-task-ids="mission-1"');
    expect(markup).not.toContain('data-task-ids="mission-1,mission-2"');
    expect(markup).not.toContain('data-testid="tasks-assign-current-project"');
    expect(markup).toContain("Permission System");
  });

  it("links an unassigned task to the current project with mapped status", () => {
    const linkMissionToProject = vi.fn().mockReturnValue({
      id: "project-mission-1",
    });

    const linked = linkTaskToCurrentProject({
      projectId: "project-1",
      missionId: "mission-2",
      taskStatus: "running",
      linkMissionToProject,
    });

    expect(linked).toEqual({ id: "project-mission-1" });
    expect(linkMissionToProject).toHaveBeenCalledWith({
      projectId: "project-1",
      missionId: "mission-2",
      status: "running",
    });
  });

  it("maps terminal task statuses to project mission statuses", () => {
    expect(mapTaskStatusToProjectMissionStatus("done")).toBe("completed");
    expect(mapTaskStatusToProjectMissionStatus("cancelled")).toBe("cancelled");
    expect(mapTaskStatusToProjectMissionStatus("failed")).toBe("failed");
    expect(mapTaskStatusToProjectMissionStatus("queued")).toBe("queued");
  });

  it("summarizes route, role, runtime and evidence relationships for task details", () => {
    const summary = buildTaskProjectRelationshipSummary({
      detail: {
        ...tasksState.detailsById["mission-1"],
        artifacts: [
          {
            id: "artifact-local",
            title: "Runtime log",
            description: "Executor log",
            kind: "log",
          },
        ],
        logSummary: [{ label: "Executor", value: "3 events" }],
        runtimeChannels: {
          socket: {
            status: "connected",
            label: "Socket",
            detail: "Live",
          },
          callback: {
            status: "idle",
            label: "Callback",
            detail: "Idle",
          },
        },
      },
      projectMission: {
        id: "project-mission-1",
        projectId: "project-1",
        missionId: "mission-1",
        routeId: "route-1",
        status: "running",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      projectRoutes: [
        {
          id: "route-1",
          projectId: "project-1",
          kind: "recommended",
          title: "Spec-first route",
          summary: "Clarify spec, then execute.",
          steps: [{ id: "step-1", title: "Build", role: "Implementer" }],
          riskLevel: "medium",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      projectEvidence: [
        {
          id: "evidence-1",
          projectId: "project-1",
          type: "route",
          title: "Route selected",
          detail: "Selected route",
          sourceMissionId: "mission-1",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      projectArtifacts: [
        {
          id: "artifact-1",
          projectId: "project-1",
          type: "report",
          title: "Execution report",
          sourceMissionId: "mission-1",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      workflowStatus: "running",
    });

    expect(summary).toEqual({
      routeLabel: "Spec-first route",
      roleLabel: "Implementer",
      runtimeLabel: "workflow:running / socket:connected / callback:idle",
      evidenceLabel: "1 evidence / 2 artifacts / 1 logs",
    });
  });

  it("summarizes project clarifications for task takeover context", () => {
    const summary = buildTaskClarificationTakeoverSummary({
      projectId: "project-1",
      detail: {
        ...tasksState.detailsById["mission-1"],
        operatorState: "blocked",
      },
      clarificationQuestions: [
        {
          id: "clarification-answered",
          projectId: "project-1",
          text: "Who approves the launch?",
          reason: "",
          scope: "delivery",
          answerType: "text",
          required: true,
          answer: "Security lead.",
          answeredAt: "2026-04-30T00:00:00.000Z",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
        {
          id: "clarification-skipped",
          projectId: "project-1",
          text: "Which browser should be assumed?",
          reason: "",
          scope: "tech",
          answerType: "single",
          required: false,
          defaultAssumption: "Chrome.",
          skippedAt: "2026-04-30T00:01:00.000Z",
          createdAt: "2026-04-30T00:00:00.000Z",
        },
        {
          id: "clarification-open",
          projectId: "project-1",
          text: "Which rollback window is acceptable?",
          reason: "",
          scope: "risk",
          answerType: "text",
          required: true,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
        {
          id: "clarification-other-project",
          projectId: "project-2",
          text: "Should not be counted.",
          reason: "",
          scope: "risk",
          answerType: "text",
          required: true,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
    });

    expect(summary).toEqual({
      resolvedCount: 2,
      openCount: 1,
      requiredOpenCount: 1,
      skippableOpenCount: 0,
      headline: "Blocked takeover: 2 resolved / 1 open",
      detail: "Which rollback window is acceptable?",
    });
  });
});
