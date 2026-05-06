import { describe, expect, it } from "vitest";

import type { ScreenshotFrame } from "@/lib/sandbox-store";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";

import {
  resolveBrowserContextLabel,
  resolveBrowserPreviewFrames,
  resolvePaneStatusLabel,
  resolveReplayScreenshotArtifact,
  resolveReplayTerminalArtifact,
  resolveSandboxMonitorMission,
} from "../sandbox-monitor-helpers";

function makeMission(
  overrides?: Partial<MissionTaskSummary>
): MissionTaskSummary {
  return {
    id: "mission-1",
    title: "Mission One",
    kind: "chat",
    sourceText: "",
    status: "done",
    operatorState: "active",
    workflowStatus: "completed",
    progress: 100,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: 1_710_000_000_000,
    updatedAt: 1_710_000_000_100,
    startedAt: 1_710_000_000_000,
    completedAt: 1_710_000_000_100,
    departmentLabels: [],
    taskCount: 3,
    completedTaskCount: 3,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    ...overrides,
  };
}

function makeDetail(id: string, title: string): MissionTaskDetail {
  return {
    ...makeMission({
      id,
      title,
      status: "running",
      workflowStatus: "running",
      progress: 50,
      updatedAt: 1_710_000_000_200,
    }),
    workflow: {
      id: `wf-${id}`,
      directive: title,
      status: "running",
      current_stage: null,
      departments_involved: [],
      started_at: null,
      completed_at: null,
      results: null,
      created_at: new Date(1_710_000_000_000).toISOString(),
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
    decisionHistory: [],
    operatorActions: [],
    runtimeChannels: {
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Mission socket is connected.",
      },
      callback: {
        status: "idle",
        label: "Callback idle",
        detail: "No executor callback has been recorded.",
      },
    },
  };
}

function makeFrame(id: string): ScreenshotFrame {
  return {
    stepIndex: 1,
    imageData: id,
    width: 1280,
    height: 720,
    timestamp: "2026-04-14T10:00:00.000Z",
  };
}

describe("resolveSandboxMonitorMission", () => {
  it("prefers the explicitly selected task when it exists", () => {
    const selected = makeMission({ id: "selected", status: "done" });
    const running = makeMission({ id: "running", status: "running" });
    const detail = makeDetail("selected", "Selected Mission");

    const result = resolveSandboxMonitorMission(
      [selected, running],
      { selected: detail },
      "selected"
    );

    expect(result.displayMission?.id).toBe("selected");
    expect(result.missionDetail?.id).toBe("selected");
  });

  it("falls back to the running mission when no task is selected", () => {
    const queued = makeMission({ id: "queued", status: "queued" });
    const running = makeMission({ id: "running", status: "running" });

    const result = resolveSandboxMonitorMission([queued, running], {}, null);

    expect(result.displayMission?.id).toBe("running");
    expect(result.missionDetail).toBeNull();
  });

  it("does not display an out-of-scope selected task when callers pass scoped missions", () => {
    const inScope = makeMission({ id: "project-mission", status: "waiting" });

    const result = resolveSandboxMonitorMission(
      [inScope],
      {},
      "other-project-mission"
    );

    expect(result.selectedMission).toBeNull();
    expect(result.displayMission?.id).toBe("project-mission");
  });

  it("falls back to the most recently created mission when no running or waiting mission exists", () => {
    const older = makeMission({
      id: "older",
      status: "done",
      createdAt: 1_710_000_000_000,
    });
    const newer = makeMission({
      id: "newer",
      status: "failed",
      createdAt: 1_710_000_000_999,
    });

    const result = resolveSandboxMonitorMission([older, newer], {}, "missing");

    expect(result.displayMission?.id).toBe("newer");
  });

  it("returns nulls when there are no missions", () => {
    const result = resolveSandboxMonitorMission([], {}, null);

    expect(result.selectedMission).toBeNull();
    expect(result.displayMission).toBeNull();
    expect(result.missionDetail).toBeNull();
  });
});

describe("resolveBrowserPreviewFrames", () => {
  it("uses the latest screenshot as current when available", () => {
    const previous = makeFrame("previous");
    const latest = makeFrame("latest");

    const result = resolveBrowserPreviewFrames(latest, previous);

    expect(result.current?.imageData).toBe("latest");
    expect(result.previous?.imageData).toBe("previous");
  });

  it("keeps the last valid screenshot visible when the latest frame is absent", () => {
    const previous = makeFrame("previous");

    const result = resolveBrowserPreviewFrames(null, previous);

    expect(result.current?.imageData).toBe("previous");
    expect(result.previous).toBeNull();
  });

  it("returns nulls when no screenshots exist", () => {
    const result = resolveBrowserPreviewFrames(null, null);

    expect(result.current).toBeNull();
    expect(result.previous).toBeNull();
  });

  it("uses a replay screenshot when no live frame exists", () => {
    const replay = makeFrame("replay");

    const result = resolveBrowserPreviewFrames(null, null, replay);

    expect(result.current?.imageData).toBe("replay");
    expect(result.previous).toBeNull();
  });

  it("keeps live screenshots ahead of replay screenshots", () => {
    const replay = makeFrame("replay");
    const latest = makeFrame("latest");

    const result = resolveBrowserPreviewFrames(latest, null, replay);

    expect(result.current?.imageData).toBe("latest");
  });
});

describe("resolve replay artifacts", () => {
  it("prefers live preview replay frame for browser fallback", () => {
    const detail = makeDetail("mission-1", "Replay Mission");
    detail.artifacts = [
      {
        id: "page-screenshot",
        title: "page-screenshot.png",
        description: "",
        kind: "file",
        filename: "page-screenshot.png",
        previewType: "image",
        previewUrl: "/page",
      },
      {
        id: "live-preview-frame",
        title: "live-preview-frame-0001.png",
        description: "",
        kind: "file",
        filename: "live-preview-frame-0001.png",
        previewType: "image",
        previewUrl: "/frame",
      },
    ];

    expect(resolveReplayScreenshotArtifact(detail)?.previewUrl).toBe("/frame");
  });

  it("prefers terminal live replay before executor log", () => {
    const detail = makeDetail("mission-1", "Replay Mission");
    detail.artifacts = [
      {
        id: "executor-log",
        title: "executor.log",
        description: "",
        kind: "log",
        filename: "executor.log",
        previewType: "log",
        previewUrl: "/executor-log",
      },
      {
        id: "terminal-live",
        title: "terminal-live.log",
        description: "",
        kind: "log",
        filename: "terminal-live.log",
        previewType: "log",
        previewUrl: "/terminal-live",
      },
    ];

    expect(resolveReplayTerminalArtifact(detail)?.previewUrl).toBe(
      "/terminal-live"
    );
  });

  it("ignores replay artifacts without preview URLs", () => {
    const detail = makeDetail("mission-1", "Replay Mission");
    detail.artifacts = [
      {
        id: "live-preview-frame",
        title: "live-preview-frame-0001.png",
        description: "",
        kind: "file",
        filename: "live-preview-frame-0001.png",
        previewType: "image",
      },
    ];

    expect(resolveReplayScreenshotArtifact(detail)).toBeNull();
  });
});

describe("resolvePaneStatusLabel", () => {
  it("covers standby, running, waiting, failed, and done states", () => {
    expect(resolvePaneStatusLabel("en-US", null, "terminal", false)).toBe(
      "Standby"
    );
    expect(resolvePaneStatusLabel("en-US", "running", "terminal", true)).toBe(
      "Live"
    );
    expect(resolvePaneStatusLabel("en-US", "running", "browser", false)).toBe(
      "Booting"
    );
    expect(resolvePaneStatusLabel("en-US", "waiting", "browser", false)).toBe(
      "Hold"
    );
    expect(resolvePaneStatusLabel("en-US", "failed", "terminal", false)).toBe(
      "Alert"
    );
    expect(resolvePaneStatusLabel("en-US", "done", "terminal", false)).toBe(
      "Done"
    );
    expect(resolvePaneStatusLabel("en-US", "done", "browser", false)).toBe(
      "Archive"
    );
  });
});

describe("resolveBrowserContextLabel", () => {
  it("prefers the current stage label", () => {
    expect(
      resolveBrowserContextLabel("en-US", "Review stage", "Mission title")
    ).toBe("Review stage");
  });

  it("falls back to the mission title and trims long values", () => {
    const label = resolveBrowserContextLabel(
      "en-US",
      null,
      "A very long browser context label that should be compacted for the wall"
    );

    expect(label.length).toBeLessThanOrEqual(31);
    expect(label.endsWith("...")).toBe(true);
  });

  it("returns a standby context when both stage and title are absent", () => {
    expect(resolveBrowserContextLabel("en-US", null, null)).toBe(
      "Waiting for browser context"
    );
  });
});
