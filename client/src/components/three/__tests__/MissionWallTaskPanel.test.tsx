import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";
import type { MissionTaskDetail, MissionTaskSummary } from "@/lib/tasks-store";

import { MissionWallTaskPanel } from "../MissionWallTaskPanel";

function makeMission(
  overrides?: Partial<MissionTaskSummary>
): MissionTaskSummary {
  return {
    id: "mission-1",
    title: "Wall Monitor Mission",
    kind: "chat",
    sourceText: "Monitor task",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 46,
    currentStageKey: "execute",
    currentStageLabel: "Run execution",
    summary: "Mission summary",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    departmentLabels: [],
    taskCount: 4,
    completedTaskCount: 1,
    messageCount: 0,
    activeAgentCount: 3,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "All systems nominal",
    ...overrides,
  };
}

function makeDetail(
  overrides?: Partial<MissionTaskDetail>
): MissionTaskDetail {
  return {
    ...makeMission(),
    workflow: {
      id: "workflow-1",
      directive: "Monitor task",
      status: "running",
      current_stage: "execute",
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
      socket: {
        status: "connected",
        label: "Socket connected",
        detail: "Mission socket is connected and can receive live runtime updates.",
      },
      callback: {
        status: "idle",
        label: "Callback idle",
        detail: "No executor callback has been recorded for this mission yet.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    ...overrides,
  };
}

describe("MissionWallTaskPanel", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "en-US" });
  });

  it("renders a stable standby wall monitor when mission is missing", () => {
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={null} detail={null} />
    );

    expect(markup).toContain("执行监控");
    expect(markup).toContain("目的地");
    expect(markup).toContain("路线");
    expect(markup).toContain("接管");
    expect(markup).toContain("MC");
    expect(markup).toContain("0%");
  });

  it("renders mission title, stage, and progress for the active task", () => {
    const mission = makeMission();
    const detail = makeDetail();
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={mission} detail={detail} />
    );

    expect(markup).toContain("Wall Monitor Mission");
    expect(markup).toContain("Run execution");
    expect(markup).toContain("46%");
    expect(markup).toContain("MC");
    expect(markup).toContain(
      "当前任务正按步骤流推进，日志与运行细节统一留在 Logs / Runtime。"
    );
    expect(markup).not.toContain("All systems nominal");
    expect(markup).not.toContain("Active 0");
    expect(markup).not.toContain("Alerts 0");
    expect(markup).not.toContain("Agent 0");
  });

  it("keeps waiting-detail copy out of the wall center summary", () => {
    const mission = makeMission({
      status: "waiting",
      currentStageLabel: "Await approval",
      waitingFor: "Approve artifact publishing before continuing.",
    });
    const detail = makeDetail({
      status: "waiting",
      currentStageLabel: "Await approval",
      waitingFor: "Approve artifact publishing before continuing.",
      decisionPrompt: "Approve artifact publishing before continuing.",
    });
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={mission} detail={detail} />
    );

    expect(markup).toContain(
      "当前任务停留在等待步骤，详细决策与补充说明统一留在辅助区。"
    );
    expect(markup).not.toContain(
      "Approve artifact publishing before continuing."
    );
  });
  it("keeps failed-step evidence out of the wall center summary", () => {
    const mission = makeMission({
      status: "failed",
      summary: "The executor timed out while waiting for a callback.",
    });
    const detail = makeDetail({
      status: "failed",
      summary: "The executor timed out while waiting for a callback.",
      stages: [
        {
          key: "execute",
          label: "Execute",
          status: "failed",
          progress: 72,
          detail: "Timed out while waiting for callback confirmation.",
          arcStart: 0,
          arcEnd: 120,
          midAngle: 60,
        },
      ],
    });
    const markup = renderToStaticMarkup(
      <MissionWallTaskPanel mission={mission} detail={detail} />
    );

    expect(markup).toContain(
      "当前步骤已进入超时态，排障与后续动作统一留在辅助区与 Runtime。"
    );
    expect(markup).not.toContain(
      "Timed out while waiting for callback confirmation."
    );
  });
});
