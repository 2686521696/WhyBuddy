import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useNLCommandStore } from "@/lib/nl-command-store";
import type { MissionTaskSummary } from "@/lib/tasks-store";

import { TasksCommandDock } from "../TasksCommandDock";

function makeTask(overrides?: Partial<MissionTaskSummary>): MissionTaskSummary {
  const now = Date.now();
  return {
    id: "mission-1",
    title: "Active compact dock task",
    kind: "analysis",
    sourceText: "The command dock should stay compact.",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 44,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    summary: "The command dock should stay compact.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: now - 120_000,
    updatedAt: now - 15_000,
    startedAt: now - 100_000,
    completedAt: null,
    departmentLabels: ["Platform"],
    taskCount: 2,
    completedTaskCount: 1,
    messageCount: 0,
    activeAgentCount: 1,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: null,
    ...overrides,
  };
}

describe("TasksCommandDock", () => {
  it("renders bare dense mode as a lightweight command float", () => {
    useNLCommandStore.setState({
      commands: [],
      currentCommand: null,
      currentAnalysis: null,
      currentDialog: null,
      currentPlan: null,
      draftText: "",
      lastSubmission: null,
      loading: false,
      error: null,
    });

    const markup = renderToStaticMarkup(
      <TasksCommandDock
        createMission={() => Promise.resolve(null)}
        tasks={[makeTask()]}
        activeTask={makeTask()}
        onOpenCreateDialog={vi.fn()}
        onRefresh={vi.fn()}
        bare
        dense
        compact
      />
    );

    expect(markup).toContain('data-visual-role="cockpit-command-float"');
    expect(markup).toContain("bg-white/58");
    expect(markup).toContain("shadow-[0_10px_24px_rgba(15,23,42,0.06)]");
    expect(markup).not.toContain("bg-[linear-gradient(180deg,rgba(255,255,255,0.94)");
    expect(markup).not.toContain("h-full");
  });
});
