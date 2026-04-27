import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionTaskDetail } from "@/lib/tasks-store";

import { TasksCockpitDetail } from "../TasksCockpitDetail";

function makeDetail(
  overrides?: Partial<MissionTaskDetail>
): MissionTaskDetail {
  return {
    id: "mission-1",
    title: "Integration test task",
    kind: "analysis",
    sourceText: "Test source text for integration.",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 65,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    summary: "Integration test summary.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now() - 300_000,
    updatedAt: Date.now() - 30_000,
    startedAt: Date.now() - 240_000,
    completedAt: null,
    departmentLabels: ["Platform", "QA"],
    taskCount: 4,
    completedTaskCount: 2,
    messageCount: 0,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: {
      id: "workflow-1",
      directive: "Test directive",
      status: "running",
      current_stage: "execute",
      departments_involved: ["Platform"],
      started_at: new Date(Date.now() - 240_000).toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date(Date.now() - 300_000).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [
      {
        id: "evt-1",
        type: "status_change",
        time: Date.now() - 60_000,
        level: "info",
        title: "Task started",
        description: "The task has been started.",
      },
      {
        id: "evt-2",
        type: "progress",
        time: Date.now() - 30_000,
        level: "success",
        title: "Stage completed",
        description: "Planning stage completed.",
      },
    ],
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
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Mission socket is connected.",
      },
      callback: {
        status: "idle",
        label: "Callback idle",
        detail: "No callback has been recorded yet.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    ...overrides,
  };
}

describe("TasksCockpitDetail integration with RightInfoPanel", () => {
  it("renders three-section layout when a task is selected", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    // useI18n defaults to zh-CN without a provider, so check Chinese labels
    expect(markup).toContain("任务概览");
    expect(markup).toContain("实时进展");
    expect(markup).toContain("近期动态");
  });

  it("renders empty state when no task is selected (detail=null)", () => {
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={null}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    // useI18n defaults to zh-CN, so check Chinese empty state
    expect(markup).toContain("选择一个任务查看详情");
    // Should NOT show the three sections
    expect(markup).not.toContain("任务概览");
    expect(markup).not.toContain("实时进展");
    expect(markup).not.toContain("近期动态");
  });

  it("renders Chinese empty state for zh-CN locale when detail is null", () => {
    // TasksCockpitDetail uses useI18n internally, but since we're using
    // renderToStaticMarkup without providers, it defaults to the fallback.
    // We verify the RightInfoPanel is being used by checking for its data-testid.
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={null}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    // The empty state should be rendered via RightInfoPanel
    expect(markup).toContain('data-testid="right-info-panel"');
    expect(markup).toContain('data-testid="empty-state"');
  });

  it("renders the 'View full details' button", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    expect(markup).toContain('data-testid="expand-detail-button"');
  });

  it("renders task overview section with meta information", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    // Check overview section data-testid
    expect(markup).toContain('data-testid="task-overview-section"');
    // Check department labels are rendered
    expect(markup).toContain("Platform");
    expect(markup).toContain("QA");
  });

  it("renders live progress section with progress ring", () => {
    const detail = makeDetail({ progress: 65 });
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    expect(markup).toContain('data-testid="live-progress-section"');
    expect(markup).toContain('data-testid="progress-ring"');
    expect(markup).toContain("65%");
  });

  it("renders recent activity section with timeline events", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    expect(markup).toContain('data-testid="recent-activity-section"');
    expect(markup).toContain("Task started");
    expect(markup).toContain("Stage completed");
  });

  it("renders empty timeline message when no events exist", () => {
    const detail = makeDetail({ timeline: [] });
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    expect(markup).toContain('data-testid="empty-timeline"');
  });

  it("passes autopilotSummary to RightInfoPanel when available", () => {
    const detail = makeDetail({
      autopilotSummary: {
        version: "1",
        source: "test",
        destination: { goal: "Test goal", taskType: "research" },
        route: {
          mode: "standard",
          stages: [
            { key: "s1", label: "Research", status: "running", progress: 40, arcStart: 0, arcEnd: 180, midAngle: 90 },
          ],
          estimatedDuration: "3h",
          candidateRoutes: [],
        },
        driveState: "executing",
        fleet: { roles: [] },
        takeover: { status: "not_required", type: "none" },
        execution: { availableActions: [] },
        recovery: {},
        evidence: { timeline: [] },
        explanation: {},
      } as any,
    });
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        onSubmitOperatorAction={() => Promise.resolve()}
      />
    );

    // Autopilot data should be visible in the overview section
    expect(markup).toContain("3h");
    expect(markup).toContain("research");
    // Autopilot stages should appear in live progress
    expect(markup).toContain("Research");
  });

  it("preserves the same props interface as before (no OfficeTaskCockpit changes needed)", () => {
    // This test verifies the component accepts all the props that
    // OfficeTaskCockpit passes, ensuring backward compatibility.
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote="test note"
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        launchingPresetId={null}
        onSubmitOperatorAction={() => Promise.resolve()}
        operatorActionLoading={{}}
        onDecisionSubmitted={() => {}}
        className="h-full"
      />
    );

    // Should render successfully with all props
    expect(markup).toContain('data-testid="right-info-panel"');
    expect(markup).toContain("任务概览");
  });

  it("applies className to the panel", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TasksCockpitDetail
        detail={detail}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        className="custom-class"
      />
    );

    expect(markup).toContain("custom-class");
  });
});
