import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TaskDetailCardsView,
  type TaskDetailCardsViewProps,
} from "../TaskDetailCardsView";
import type {
  MissionTaskDetail,
  TaskAutopilotSummary,
} from "@/lib/tasks-store";

/* ─── Minimal detail fixture ─── */

function makeDetail(
  overrides?: Partial<MissionTaskDetail>,
): MissionTaskDetail {
  return {
    id: "task-1",
    title: "Deploy service",
    kind: "mission",
    sourceText: "Deploy the backend service to production",
    status: "running",
    operatorState: "normal",
    workflowStatus: "running",
    progress: 40,
    currentStageKey: "execution",
    currentStageLabel: "Execution",
    summary: "Deploying backend service",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    departmentLabels: ["Engineering", "DevOps"],
    taskCount: 5,
    completedTaskCount: 2,
    messageCount: 3,
    activeAgentCount: 2,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: {
      id: "wf-1",
      directive: "deploy",
      status: "running",
      current_stage: "execution",
      departments_involved: ["Engineering"],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date().toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [
      {
        key: "planning",
        label: "Planning",
        status: "done",
        progress: 100,
        arcStart: 0,
        arcEnd: 36,
        midAngle: 18,
      },
      {
        key: "execution",
        label: "Execution",
        status: "running",
        progress: 50,
        arcStart: 36,
        arcEnd: 72,
        midAngle: 54,
      },
    ],
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

/* ─── Autopilot summary fixture ─── */

function makeAutopilotSummary(
  overrides?: Partial<TaskAutopilotSummary>,
): TaskAutopilotSummary {
  return {
    version: "1",
    source: "test",
    destination: {
      goal: "Deploy backend",
      subGoals: [
        { id: "sg-1", title: "Build image", status: "done" },
        { id: "sg-2", title: "Run tests", status: "running" },
        { id: "sg-3", title: "Deploy", status: "pending" },
      ],
      successCriteria: ["All tests pass", "Service healthy"],
    },
    route: {
      stages: [
        { key: "build", label: "Build", status: "done", isCurrent: false },
        { key: "test", label: "Test", status: "running", isCurrent: true },
        { key: "deploy", label: "Deploy", status: "pending", isCurrent: false },
      ],
      selected: {
        estimatedDuration: "30min",
      },
    },
    driveState: {
      state: "executing",
    },
    fleet: {
      roles: [
        {
          id: "r-1",
          title: "Planner",
          roleType: "planner",
          status: "done",
        },
        {
          id: "r-2",
          title: "Executor",
          roleType: "executor",
          status: "running",
        },
      ],
    },
    takeover: {
      reason: "Awaiting deployment approval",
    },
    ...overrides,
  } as TaskAutopilotSummary;
}

/* ─── Props helper ─── */

function makeProps(
  overrides?: Partial<TaskDetailCardsViewProps>,
): TaskDetailCardsViewProps {
  return {
    taskId: "task-1",
    detail: makeDetail(),
    autopilotSummary: makeAutopilotSummary(),
    locale: "en-US",
    onSubmitOperatorAction: vi.fn(),
    onLaunchDecision: vi.fn(),
    onSetDecisionNote: vi.fn(),
    decisionNote: "",
    operatorActionLoading: false,
    ...overrides,
  };
}

function render(props: TaskDetailCardsViewProps): string {
  return renderToStaticMarkup(<TaskDetailCardsView {...props} />);
}

/* ─── Tests ─── */

describe("TaskDetailCardsView", () => {
  describe("with full autopilotSummary", () => {
    it("renders the task title in the header card", () => {
      const markup = render(makeProps());
      expect(markup).toContain("Deploy service");
    });

    it("renders the task status badge", () => {
      const markup = render(makeProps());
      // running status should show emerald badge
      expect(markup).toContain("bg-emerald-100");
    });

    it("renders goal card with sub-goals from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("Build image");
      expect(markup).toContain("Run tests");
      expect(markup).toContain("Deploy");
    });

    it("renders goal card title", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Goals");
    });

    it("renders route card with stages from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("Build");
      expect(markup).toContain("Test");
    });

    it("renders route card title", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Route");
    });

    it("renders fleet card with roles from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("Planner");
      expect(markup).toContain("Executor");
    });

    it("renders fleet card title", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Fleet Execution");
    });

    it("renders takeover card title", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Takeover/Evidence");
    });

    it("renders takeover summary from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("Awaiting deployment approval");
    });

    it("renders the command input bar", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Enter task command...");
    });

    it("renders progress percentage from detail", () => {
      const markup = render(makeProps());
      expect(markup).toContain("40%");
    });

    it("renders estimated duration from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("30min");
    });

    it("renders drive state from autopilotSummary", () => {
      const markup = render(makeProps());
      expect(markup).toContain("executing");
    });
  });

  describe("with null autopilotSummary (degraded mode)", () => {
    it("renders the task title from detail", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      expect(markup).toContain("Deploy service");
    });

    it("renders the task status badge from detail", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      expect(markup).toContain("bg-emerald-100");
    });

    it("renders goal card with fallback from detail summary", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      // Should fall back to detail.summary
      expect(markup).toContain("Deploying backend service");
    });

    it("renders route card with fallback from detail stages", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      // Should fall back to detail.stages
      expect(markup).toContain("Planning");
      expect(markup).toContain("Execution");
    });

    it("renders fleet card with fallback from departmentLabels", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      // Should fall back to detail.departmentLabels
      expect(markup).toContain("Engineering");
      expect(markup).toContain("DevOps");
    });

    it("renders takeover card with empty state when no decision", () => {
      const markup = render(
        makeProps({ autopilotSummary: null, locale: "en-US" }),
      );
      expect(markup).toContain("No takeover needed");
    });

    it("does not render estimated duration when autopilotSummary is null", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      expect(markup).not.toContain("30min");
    });

    it("does not render drive state when autopilotSummary is null", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      expect(markup).not.toContain("executing");
    });

    it("renders the command input bar even without autopilotSummary", () => {
      const markup = render(
        makeProps({ autopilotSummary: null, locale: "en-US" }),
      );
      expect(markup).toContain("Enter task command...");
    });

    it("renders progress from detail", () => {
      const markup = render(
        makeProps({ autopilotSummary: null }),
      );
      expect(markup).toContain("40%");
    });
  });

  describe("with pending decision", () => {
    it("renders decision presets as buttons", () => {
      const detail = makeDetail({
        decisionPresets: [
          {
            id: "approve",
            label: "Approve",
            description: "",
            prompt: "",
            tone: "primary",
            action: "mission",
          },
          {
            id: "reject",
            label: "Reject",
            description: "",
            prompt: "",
            tone: "warning",
            action: "mission",
          },
        ],
        decisionPrompt: "Please review the deployment",
      });
      const markup = render(makeProps({ detail }));
      expect(markup).toContain("Approve");
      expect(markup).toContain("Reject");
      expect(markup).toContain("Please review the deployment");
    });
  });

  describe("i18n", () => {
    it("renders Chinese labels for zh-CN locale", () => {
      const markup = render(makeProps({ locale: "zh-CN" }));
      expect(markup).toContain("目标");
      expect(markup).toContain("路线");
      expect(markup).toContain("编队执行");
      expect(markup).toContain("接管/证据");
      expect(markup).toContain("输入任务指令...");
    });

    it("renders English labels for en-US locale", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Goals");
      expect(markup).toContain("Route");
      expect(markup).toContain("Fleet Execution");
      expect(markup).toContain("Takeover/Evidence");
      expect(markup).toContain("Enter task command...");
    });
  });

  describe("layout structure", () => {
    it("uses flex column layout for the container", () => {
      const markup = render(makeProps());
      expect(markup).toContain("flex");
      expect(markup).toContain("h-full");
      expect(markup).toContain("flex-col");
    });

    it("uses overflow-y-auto for the scrollable area", () => {
      const markup = render(makeProps());
      expect(markup).toContain("overflow-y-auto");
    });

    it("does not use the full page background as its cockpit surface", () => {
      const markup = render(makeProps());
      expect(markup).toMatch(
        /^<div class="[^"]*bg-white\/38/
      );
    });

    it("marks the cards surface as a lightweight cockpit auxiliary layer", () => {
      const markup = render(makeProps());
      expect(markup).toContain('data-visual-role="cockpit-auxiliary-detail"');
      expect(markup).toContain("bg-white/38");
      expect(markup).toContain("shadow-[0_12px_28px_rgba(15,23,42,0.06)]");
    });

    it("keeps the command bar compact and translucent in the cockpit auxiliary layer", () => {
      const markup = render(makeProps());
      expect(markup).toContain('data-visual-role="cockpit-auxiliary-command"');
      expect(markup).toContain("bg-white/58");
      expect(markup).toContain("[&amp;_input]:!h-8");
      expect(markup).toContain("[&amp;_button]:!h-8");
    });
  });

  describe("error boundary wrapping", () => {
    // Error boundaries are class components that catch render errors.
    // We verify they are present by checking the structure renders without issues.
    it("renders all five card sections without error", () => {
      const markup = render(makeProps());
      // All card titles should be present
      expect(markup).toContain("Deploy service"); // header
      expect(markup).toContain("Goals"); // goal
      expect(markup).toContain("Route"); // route
      expect(markup).toContain("Fleet Execution"); // fleet
      expect(markup).toContain("Takeover/Evidence"); // takeover
    });
  });
});
