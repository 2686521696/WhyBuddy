import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionTaskDetail } from "@/lib/tasks-store";

import { TaskDetailView } from "../TaskDetailView";

vi.mock("@/components/rag/RAGInfoPanel", () => ({
  RAGInfoPanel: () => null,
}));

vi.mock("@/components/rag/RAGDebugPanel", () => ({
  RAGDebugPanel: () => null,
}));

vi.mock("@/components/tasks/ArtifactPreviewDialog", () => ({
  ArtifactPreviewDialog: () => null,
}));

function makeDetail(overrides?: Partial<MissionTaskDetail>): MissionTaskDetail {
  return {
    id: "mission-1",
    title: "Runtime evidence consolidation",
    kind: "analysis",
    sourceText: "Consolidate runtime evidence into dedicated tabs.",
    status: "failed",
    operatorState: "blocked",
    workflowStatus: "running",
    progress: 58,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    summary: "The runtime evidence should live in the shared dock only.",
    waitingFor: null,
    blocker: null,
    attempt: 2,
    latestOperatorAction: null,
    createdAt: Date.now() - 300_000,
    updatedAt: Date.now() - 30_000,
    startedAt: Date.now() - 240_000,
    completedAt: null,
    departmentLabels: ["Platform"],
    taskCount: 1,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 1,
    attachmentCount: 1,
    issueCount: 1,
    hasWarnings: true,
    lastSignal: "Executor uploaded a partial artifact bundle.",
    workflow: {
      id: "workflow-1",
      directive: "Consolidate runtime evidence into dedicated tabs.",
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
        id: "event-1",
        type: "log",
        time: Date.now() - 120_000,
        level: "warn",
        title: "Executor retried artifact upload",
        description: "The executor retried the artifact upload after a callback delay.",
        actor: "lobster",
      },
    ],
    artifacts: [
      {
        id: "artifact-1",
        title: "Run report",
        description: "A runtime handoff artifact.",
        kind: "report",
        format: "md",
        href: "/api/tasks/mission-1/artifacts/0/download",
        downloadUrl: "/api/tasks/mission-1/artifacts/0/download",
        previewUrl: "/api/tasks/mission-1/artifacts/0/preview",
        downloadKind: "workflow",
      },
    ],
    failureReasons: ["Artifact upload is still waiting on callback confirmation."],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [{ label: "Instance", value: "runner-1" }],
    logSummary: [{ label: "Latest log", value: "Artifact upload pending" }],
    runtimeChannels: {
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Mission socket is connected and can receive live runtime updates.",
      },
      callback: {
        status: "active",
        label: "Callback artifact_uploaded",
        detail: "Last executor callback arrived moments ago.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    securitySummary: {
      level: "balanced",
      user: "node",
      networkMode: "restricted",
      readonlyRootfs: true,
      memoryLimit: "1 GiB",
      cpuLimit: "1",
      pidsLimit: 128,
    },
    executor: {
      name: "lobster",
      jobId: "job-1",
      status: "failed",
    },
    instance: {
      image: "workspace-runner:latest",
    },
    ...overrides,
  };
}

describe("TaskDetailView runtime evidence consolidation", () => {
  it("hides cockpit runtime evidence panels when runtime evidence is deferred", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        variant="cockpit"
        autoHeight
        deferRuntimeEvidence
      />
    );

    expect(markup).not.toContain("Runtime Snapshot");
    expect(markup).not.toContain("Artifacts");
    expect(markup).not.toContain("Executor");
    expect(markup).not.toContain("Failure");
    expect(markup).toContain("安全策略");
  });

  it("also hides cockpit runtime evidence panels without relying on deferRuntimeEvidence", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        variant="cockpit"
        autoHeight
      />
    );

    expect(markup).not.toContain("Runtime Snapshot");
    expect(markup).not.toContain("Artifacts");
    expect(markup).not.toContain("Executor");
    expect(markup).not.toContain("Failure");
    expect(markup).toContain("安全策略");
  });
  it("keeps cockpit variant in a lightweight auxiliary detail stack", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        variant="cockpit"
        autoHeight
      />
    );

    expect(markup).toContain('data-visual-role="cockpit-detail-stack"');
    expect(markup).toContain("gap-2.5");
    expect(markup).toContain("bg-white/45");
    expect(markup).not.toContain("shadow-[0_24px_60px_rgba(112,84,51,0.06)]");
  });

  it("removes the standalone artifacts tab when runtime evidence is deferred", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
        deferRuntimeEvidence
      />
    );

    expect(markup).not.toContain(">Artifacts<");
  });

  it("removes the standalone artifacts tab for the default detail view as well", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
      />
    );

    expect(markup).not.toContain(">交付物<");
    expect(markup).not.toContain("Run report");
    expect(markup).not.toContain("Full deliverable payload for task #");
  });
});
