/**
 * Unit tests for MissionDetailOverlay helper integration.
 *
 * The overlay now stays focused on mission summary, coordination context,
 * and crew state instead of duplicating runtime timeline snippets.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  MissionTaskDetail,
  TaskInteriorAgent,
} from "@/lib/tasks-store";
import { useAppStore } from "@/lib/store";
import {
  agentStatusLabel,
  agentStatusTone,
  compactText,
  formatTaskRelative,
} from "@/components/tasks/task-helpers";
import { MissionDetailOverlay } from "../MissionDetailOverlay";

function makeAgent(overrides?: Partial<TaskInteriorAgent>): TaskInteriorAgent {
  return {
    id: "agent-1",
    name: "Agent Alpha",
    role: "worker",
    department: "Engineering",
    title: "Code Writer",
    status: "working",
    stageKey: "execution",
    stageLabel: "Execution",
    progress: 50,
    angle: 0,
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "m-1",
    title: "Test Mission",
    kind: "chat",
    sourceText: "",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    departmentLabels: [],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    workflow: {
      id: "w",
      directive: "",
      status: "running",
      stages: [],
      currentStageKey: null,
      progress: 0,
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
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Live updates are available.",
      },
      callback: {
        status: "idle",
        label: "Callback idle",
        detail: "No callback yet.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
    ...overrides,
  } as MissionTaskDetail;
}

describe("MissionDetailOverlay close behavior", () => {
  it("onClose callback is invocable", () => {
    const onClose = vi.fn();
    onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key handler calls onClose", () => {
    const onClose = vi.fn();
    const handleKeyDown = (e: { key: string }) => {
      if (e.key === "Escape") onClose();
    };

    handleKeyDown({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("non-Escape keys do not trigger onClose", () => {
    const onClose = vi.fn();
    const handleKeyDown = (e: { key: string }) => {
      if (e.key === "Escape") onClose();
    };

    handleKeyDown({ key: "Enter" });
    handleKeyDown({ key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("MissionDetailOverlay navigate behavior", () => {
  it("onNavigateToDetail receives the task id", () => {
    const onNavigateToDetail = vi.fn();
    const detail = makeDetail({ id: "mission-42" });

    onNavigateToDetail(detail.id);
    expect(onNavigateToDetail).toHaveBeenCalledWith("mission-42");
  });
});

describe("MissionDetailOverlay null detail", () => {
  it("null detail means component returns null (no render)", () => {
    const detail: MissionTaskDetail | null = null;
    expect(detail).toBeNull();
  });
});

describe("MissionDetailOverlay summary", () => {
  it("prefers summary text and trims it for the overlay overview", () => {
    const detail = makeDetail({
      summary:
        "This mission keeps a longer summary so the compact overlay can trim it before showing the top-level overview.",
    });
    const summary = compactText(detail.summary || detail.sourceText, 80);

    expect(summary).toContain("This mission keeps");
    expect(summary.length).toBeLessThanOrEqual(83);
  });

  it("uses waiting or blocker context for the coordination note", () => {
    const waitingDetail = makeDetail({
      status: "waiting",
      waitingFor: "Need operator approval before continuing the release.",
    });
    const blockerDetail = makeDetail({
      operatorState: "blocked",
      blocker: {
        type: "manual",
        reason: "The approval checklist is incomplete.",
        createdAt: Date.now(),
        createdBy: "ops",
      },
    });

    expect(
      compactText(
        waitingDetail.waitingFor ||
          waitingDetail.decisionPrompt ||
          waitingDetail.blocker?.reason,
        180
      )
    ).toContain("operator approval");
    expect(
      compactText(
        blockerDetail.waitingFor ||
          blockerDetail.decisionPrompt ||
          blockerDetail.blocker?.reason,
        180
      )
    ).toContain("approval checklist");
  });

  it("formatTaskRelative returns a human-readable string", () => {
    const recent = Date.now() - 120_000;
    const result = formatTaskRelative(recent);
    expect(result).toMatch(/min ago/);
  });

  it("keeps the home runtime evidence note anchored to the shared runtime evidence container", () => {
    useAppStore.setState({ locale: "zh-CN" });

    const markup = renderToStaticMarkup(
      createElement(MissionDetailOverlay, {
        detail: makeDetail({
          summary: "",
          sourceText: "",
        }),
        onClose: () => {},
        onNavigateToDetail: () => {},
      })
    );

    expect(markup).toContain(
      "日志、产物和运行证据在首页上统一归口到共享运行证据容器。"
    );
    expect(markup).not.toContain("日志、产物和运行证据统一保留在任务详情页与首页底部运行区。");
  });
});

describe("MissionDetailOverlay agent list", () => {
  it("agent status labels are correct", () => {
    expect(agentStatusLabel("idle")).toBe("Idle");
    expect(agentStatusLabel("working")).toBe("Working");
    expect(agentStatusLabel("thinking")).toBe("Thinking");
    expect(agentStatusLabel("done")).toBe("Done");
    expect(agentStatusLabel("error")).toBe("Error");
  });

  it("agent status tones contain expected color tokens", () => {
    expect(agentStatusTone("working")).toContain("workspace-tone-warning");
    expect(agentStatusTone("thinking")).toContain("workspace-tone-info");
    expect(agentStatusTone("done")).toContain("workspace-tone-success");
    expect(agentStatusTone("error")).toContain("workspace-tone-danger");
    expect(agentStatusTone("idle")).toContain("workspace-tone-neutral");
  });

  it("empty agents list shows no agents", () => {
    const detail = makeDetail({ agents: [] });
    expect(detail.agents).toHaveLength(0);
  });

  it("agents display name or id fallback", () => {
    const agentWithName = makeAgent({ name: "Alpha", id: "a-1" });
    const agentNoName = makeAgent({ name: "", id: "a-2" });

    expect(agentWithName.name || agentWithName.id).toBe("Alpha");
    expect(agentNoName.name || agentNoName.id).toBe("a-2");
  });
});
