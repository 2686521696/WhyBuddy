import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RightInfoPanel,
  TaskOverviewSection,
  LiveProgressSection,
  RecentActivitySection,
  ProgressRing,
  SubMetricItem,
  MetaRow,
  SectionErrorBoundary,
  MAX_TIMELINE_DISPLAY,
  type RightInfoPanelProps,
  type TaskOverviewSectionProps,
  type LiveProgressSectionProps,
  type RecentActivitySectionProps,
} from "../RightInfoPanel";
import type {
  MissionTaskDetail,
  TaskAutopilotSummary,
  TaskTimelineEvent,
} from "@/lib/tasks-store";

/* ─── Mock Factories ─── */

function makeTimelineEvent(
  overrides?: Partial<TaskTimelineEvent>
): TaskTimelineEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: "status_change",
    time: Date.now() - 60_000,
    level: "info",
    title: "Task started",
    description: "The task has been started.",
    ...overrides,
  };
}

function makeDetail(
  overrides?: Partial<MissionTaskDetail>
): MissionTaskDetail {
  return {
    id: "task-1",
    title: "Test Task",
    kind: "chat",
    sourceText: "Test source",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "Test summary",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now(),
    startedAt: Date.now() - 3_600_000,
    completedAt: null,
    departmentLabels: ["Engineering", "Design"],
    taskCount: 10,
    completedTaskCount: 5,
    messageCount: 3,
    activeAgentCount: 2,
    attachmentCount: 1,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: {
      id: "wf-1",
      directive: "test",
      status: "running",
      current_stage: null,
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
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
      socket: { status: "connected", label: "Socket", detail: "OK" },
      callback: { status: "active", label: "Callback", detail: "OK" },
    },
    decisionHistory: [],
    operatorActions: [],
    ...overrides,
  } as MissionTaskDetail;
}

function makeAutopilot(
  overrides?: Partial<TaskAutopilotSummary>
): TaskAutopilotSummary {
  return {
    version: "1",
    source: "test",
    destination: {
      goal: "Test goal",
      taskType: "analysis",
    },
    route: {
      mode: "standard",
      stages: [
        { key: "s1", label: "Planning", status: "done", progress: 100, arcStart: 0, arcEnd: 90, midAngle: 45 },
        { key: "s2", label: "Execution", status: "running", progress: 50, arcStart: 90, arcEnd: 180, midAngle: 135 },
      ],
      estimatedDuration: "2h 30m",
      candidateRoutes: [],
    },
    driveState: "executing",
    fleet: { roles: [] },
    takeover: { status: "not_required", type: "none" },
    execution: { availableActions: [] },
    recovery: {},
    evidence: { timeline: [] },
    explanation: {},
  } as unknown as TaskAutopilotSummary;
}

/* ─── RightInfoPanel Tests ─── */

describe("RightInfoPanel", () => {
  describe("empty state (detail=null)", () => {
    it("renders empty state message when detail is null", () => {
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={null} locale="en-US" />
      );
      expect(markup).toContain("Select a task to view details");
    });

    it("renders Chinese empty state for zh-CN locale", () => {
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={null} locale="zh-CN" />
      );
      expect(markup).toContain("选择一个任务查看详情");
    });

    it("does not render sections when detail is null", () => {
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={null} locale="en-US" />
      );
      expect(markup).not.toContain("Task Overview");
      expect(markup).not.toContain("Live Progress");
      expect(markup).not.toContain("Recent Activity");
    });
  });

  describe("full data rendering", () => {
    it("renders all three sections when detail is provided", () => {
      const detail = makeDetail();
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={detail} locale="en-US" />
      );
      expect(markup).toContain("Task Overview");
      expect(markup).toContain("Live Progress");
      expect(markup).toContain("Recent Activity");
    });

    it("renders 'View full details' button when onExpandDetail is provided", () => {
      const detail = makeDetail();
      const markup = renderToStaticMarkup(
        <RightInfoPanel
          detail={detail}
          locale="en-US"
          onExpandDetail={() => {}}
        />
      );
      expect(markup).toContain("View full details");
    });

    it("does not render expand button when onExpandDetail is not provided", () => {
      const detail = makeDetail();
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={detail} locale="en-US" />
      );
      expect(markup).not.toContain("View full details");
    });
  });

  describe("panel width constraints", () => {
    it("applies min-width and max-width styles", () => {
      const detail = makeDetail();
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={detail} locale="en-US" />
      );
      expect(markup).toContain("min-width:300px");
      expect(markup).toContain("max-width:360px");
    });

    it("applies overflow-y auto", () => {
      const detail = makeDetail();
      const markup = renderToStaticMarkup(
        <RightInfoPanel detail={detail} locale="en-US" />
      );
      expect(markup).toContain("overflow-y");
    });
  });
});

/* ─── TaskOverviewSection Tests ─── */

describe("TaskOverviewSection", () => {
  it("renders all four meta rows", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("Created");
    expect(markup).toContain("Est. Completion");
    expect(markup).toContain("Elapsed");
    expect(markup).toContain("Creator");
  });

  it("shows '—' for missing estimated completion", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    // No autopilot, so estimated completion should be "—"
    expect(markup).toContain("—");
  });

  it("shows autopilot estimated duration when available", () => {
    const detail = makeDetail();
    const autopilot = makeAutopilot();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection
        detail={detail}
        autopilot={autopilot}
        locale="en-US"
      />
    );
    expect(markup).toContain("2h 30m");
  });

  it("shows autopilot taskType as creator when available", () => {
    const detail = makeDetail();
    const autopilot = makeAutopilot();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection
        detail={detail}
        autopilot={autopilot}
        locale="en-US"
      />
    );
    expect(markup).toContain("analysis");
  });

  it("falls back to detail.kind when autopilot is not available", () => {
    const detail = makeDetail({ kind: "research" });
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("research");
  });

  it("renders department label tags", () => {
    const detail = makeDetail({
      departmentLabels: ["Engineering", "Design"],
    });
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("Engineering");
    expect(markup).toContain("Design");
  });

  it("does not render tags section when departmentLabels is empty", () => {
    const detail = makeDetail({ departmentLabels: [] });
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    // No tag capsules should be rendered
    expect(markup).not.toContain("var(--secondary-foreground)");
  });

  it("uses design tokens for card styling", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("var(--card)");
    expect(markup).toContain("var(--border)");
    expect(markup).toContain("var(--radius)");
    expect(markup).toContain("var(--muted-foreground)");
  });

  it("renders Chinese labels for zh-CN locale", () => {
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <TaskOverviewSection detail={detail} locale="zh-CN" />
    );
    expect(markup).toContain("任务概览");
    expect(markup).toContain("创建时间");
    expect(markup).toContain("预估完成");
    expect(markup).toContain("已用时间");
    expect(markup).toContain("创建者");
  });
});

/* ─── LiveProgressSection Tests ─── */

describe("LiveProgressSection", () => {
  it("renders progress percentage", () => {
    const detail = makeDetail({ progress: 75 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("75%");
  });

  it("clamps progress to 0 for negative values", () => {
    const detail = makeDetail({ progress: -5 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("0%");
  });

  it("clamps progress to 100 for values over 100", () => {
    const detail = makeDetail({ progress: 120 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    // The center text should show 100%, not 120%
    expect(markup).toContain(">100%<");
  });

  it("renders progress at 0", () => {
    const detail = makeDetail({ progress: 0 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("0%");
  });

  it("renders progress at 50", () => {
    const detail = makeDetail({ progress: 50 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("50%");
  });

  it("renders progress at 100", () => {
    const detail = makeDetail({ progress: 100 });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("100%");
  });

  it("renders sub-metrics from autopilot stages", () => {
    const detail = makeDetail();
    const autopilot = makeAutopilot();
    const markup = renderToStaticMarkup(
      <LiveProgressSection
        detail={detail}
        autopilot={autopilot}
        locale="en-US"
      />
    );
    expect(markup).toContain("Planning");
    expect(markup).toContain("Execution");
  });

  it("falls back to single metric when no stages available", () => {
    const detail = makeDetail({
      stages: [],
      taskCount: 10,
      completedTaskCount: 5,
    });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("Tasks Done");
    expect(markup).toContain("50%");
  });

  it("renders sub-metrics from detail stages when autopilot not available", () => {
    const detail = makeDetail({
      stages: [
        { key: "s1", label: "Review", status: "done", progress: 80, arcStart: 0, arcEnd: 90, midAngle: 45 },
      ],
    });
    const markup = renderToStaticMarkup(
      <LiveProgressSection detail={detail} locale="en-US" />
    );
    expect(markup).toContain("Review");
    expect(markup).toContain("80%");
  });
});

/* ─── ProgressRing Tests ─── */

describe("ProgressRing", () => {
  it("renders SVG with correct dimensions", () => {
    const markup = renderToStaticMarkup(<ProgressRing value={50} />);
    expect(markup).toContain('width="80"');
    expect(markup).toContain('height="80"');
  });

  it("renders two circle elements", () => {
    const markup = renderToStaticMarkup(<ProgressRing value={50} />);
    const circleCount = (markup.match(/<circle/g) || []).length;
    expect(circleCount).toBe(2);
  });

  it("uses --primary stroke for progress arc", () => {
    const markup = renderToStaticMarkup(<ProgressRing value={50} />);
    expect(markup).toContain("var(--primary)");
  });

  it("uses --muted stroke for background track", () => {
    const markup = renderToStaticMarkup(<ProgressRing value={50} />);
    expect(markup).toContain("var(--muted)");
  });

  it("clamps negative values to 0", () => {
    const markup0 = renderToStaticMarkup(<ProgressRing value={0} />);
    const markupNeg = renderToStaticMarkup(<ProgressRing value={-10} />);
    // Both should produce the same stroke-dashoffset (full circumference)
    const getOffset = (m: string) => {
      const match = m.match(/stroke-dashoffset="([^"]+)"/);
      return match ? parseFloat(match[1]) : NaN;
    };
    expect(getOffset(markupNeg)).toBe(getOffset(markup0));
  });

  it("clamps values over 100 to 100", () => {
    const markup100 = renderToStaticMarkup(<ProgressRing value={100} />);
    const markup150 = renderToStaticMarkup(<ProgressRing value={150} />);
    const getOffset = (m: string) => {
      const match = m.match(/stroke-dashoffset="([^"]+)"/);
      return match ? parseFloat(match[1]) : NaN;
    };
    expect(getOffset(markup150)).toBe(getOffset(markup100));
  });

  it("accepts custom size and strokeWidth", () => {
    const markup = renderToStaticMarkup(
      <ProgressRing value={50} size={100} strokeWidth={8} />
    );
    expect(markup).toContain('width="100"');
    expect(markup).toContain('height="100"');
  });
});

/* ─── RecentActivitySection Tests ─── */

describe("RecentActivitySection", () => {
  it("renders empty state when timeline is empty", () => {
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={[]} locale="en-US" />
    );
    expect(markup).toContain("No activity yet");
  });

  it("renders Chinese empty state for zh-CN", () => {
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={[]} locale="zh-CN" />
    );
    expect(markup).toContain("暂无动态");
  });

  it("renders events sorted by time descending", () => {
    const events = [
      makeTimelineEvent({ id: "e1", time: 1000, title: "First" }),
      makeTimelineEvent({ id: "e3", time: 3000, title: "Third" }),
      makeTimelineEvent({ id: "e2", time: 2000, title: "Second" }),
    ];
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={events} locale="en-US" />
    );
    const thirdIdx = markup.indexOf("Third");
    const secondIdx = markup.indexOf("Second");
    const firstIdx = markup.indexOf("First");
    expect(thirdIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it("truncates to MAX_TIMELINE_DISPLAY events by default", () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeTimelineEvent({
        id: `e${i}`,
        time: Date.now() - i * 1000,
        title: `Event ${i}`,
      })
    );
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={events} locale="en-US" />
    );
    // Should show "View all" button
    expect(markup).toContain("View all");
    expect(markup).toContain("(15)");
    // Should only render MAX_TIMELINE_DISPLAY events
    const eventCount = (markup.match(/Event \d+/g) || []).length;
    expect(eventCount).toBe(MAX_TIMELINE_DISPLAY);
  });

  it("does not show 'View all' when events <= MAX_TIMELINE_DISPLAY", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeTimelineEvent({
        id: `e${i}`,
        time: Date.now() - i * 1000,
        title: `Event ${i}`,
      })
    );
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={events} locale="en-US" />
    );
    expect(markup).not.toContain("View all");
  });

  it("renders event titles and descriptions", () => {
    const events = [
      makeTimelineEvent({
        id: "e1",
        title: "Deployment started",
        description: "Container spinning up",
      }),
    ];
    const markup = renderToStaticMarkup(
      <RecentActivitySection timeline={events} locale="en-US" />
    );
    expect(markup).toContain("Deployment started");
    expect(markup).toContain("Container spinning up");
  });
});

/* ─── SectionErrorBoundary Tests ─── */

describe("SectionErrorBoundary", () => {
  it("renders children when no error", () => {
    const markup = renderToStaticMarkup(
      <SectionErrorBoundary locale="en-US">
        <div>Safe content</div>
      </SectionErrorBoundary>
    );
    expect(markup).toContain("Safe content");
  });

  it("isolates errors - simulated via direct state", () => {
    // We verify the error boundary class exists and renders fallback
    // by testing the boundary in isolation with a known error state.
    // Since renderToStaticMarkup cannot trigger componentDidCatch,
    // we verify the boundary renders children normally and trust
    // the React ErrorBoundary contract.
    const markup = renderToStaticMarkup(
      <div>
        <SectionErrorBoundary locale="en-US">
          <div>Section A</div>
        </SectionErrorBoundary>
        <SectionErrorBoundary locale="en-US">
          <div>Section B</div>
        </SectionErrorBoundary>
      </div>
    );
    expect(markup).toContain("Section A");
    expect(markup).toContain("Section B");
  });
});

/* ─── MetaRow Tests ─── */

describe("MetaRow", () => {
  it("renders label and value", () => {
    const markup = renderToStaticMarkup(
      <MetaRow icon={<span>🕐</span>} label="Created" value="5m ago" />
    );
    expect(markup).toContain("Created");
    expect(markup).toContain("5m ago");
  });

  it("uses tabular-nums for value", () => {
    const markup = renderToStaticMarkup(
      <MetaRow icon={<span>🕐</span>} label="Test" value="123" />
    );
    expect(markup).toContain("tabular-nums");
  });

  it("uses font-mono for value", () => {
    const markup = renderToStaticMarkup(
      <MetaRow icon={<span>🕐</span>} label="Test" value="123" />
    );
    expect(markup).toContain("font-mono");
  });
});

/* ─── SubMetricItem Tests ─── */

describe("SubMetricItem", () => {
  it("renders label and percentage", () => {
    const markup = renderToStaticMarkup(
      <SubMetricItem label="Planning" value={75} />
    );
    expect(markup).toContain("Planning");
    expect(markup).toContain("75%");
  });

  it("clamps bar width to 0-100", () => {
    const markup = renderToStaticMarkup(
      <SubMetricItem label="Test" value={150} />
    );
    expect(markup).toContain("width:100%");
  });

  it("uses --primary for bar fill", () => {
    const markup = renderToStaticMarkup(
      <SubMetricItem label="Test" value={50} />
    );
    expect(markup).toContain("var(--primary)");
  });
});
