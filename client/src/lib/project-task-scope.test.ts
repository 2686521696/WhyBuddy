import { describe, expect, it } from "vitest";

import {
  countProjectScopedTasksByStatus,
  filterProjectScopedWorkflows,
  isMissionInProjectScope,
  isTaskInProjectScope,
  isWorkflowInProjectScope,
  resolveProjectTaskScope,
  resolveProjectMissionIds,
  resolveScopedWorkflow,
  resolveScopedSelectedTaskId,
} from "./project-task-scope";
import type { ProjectMission } from "./project-store";
import type { MissionTaskSummary } from "./tasks-store";

function makeTask(
  id: string,
  status: MissionTaskSummary["status"] = "running"
): MissionTaskSummary {
  return {
    id,
    title: id,
    kind: "general",
    sourceText: "",
    status,
    operatorState: "active",
    workflowStatus: status === "done" ? "completed" : "running",
    progress: status === "done" ? 100 : 50,
    currentStageKey: null,
    currentStageLabel: null,
    summary: "",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: 1,
    updatedAt: 1,
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
  };
}

function link(projectId: string, missionId: string): ProjectMission {
  return {
    id: `${projectId}-${missionId}`,
    projectId,
    missionId,
    status: "running",
    linkedAt: "2026-05-05T00:00:00.000Z",
  };
}

describe("project task scope", () => {
  it("returns all tasks when no project is selected", () => {
    const tasks = [makeTask("a"), makeTask("b")];
    const scope = resolveProjectTaskScope({
      projectId: null,
      projectMissions: [link("project-1", "a")],
      tasks,
    });

    expect(scope.missionIds).toBeNull();
    expect(scope.tasks.map(task => task.id)).toEqual(["a", "b"]);
    expect(scope.outsideCount).toBe(0);
  });

  it("keeps only tasks linked to the selected project", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const scope = resolveProjectTaskScope({
      projectId: "project-1",
      projectMissions: [
        link("project-1", "a"),
        link("project-2", "b"),
        link("project-1", "missing"),
      ],
      tasks,
    });

    expect(scope.tasks.map(task => task.id)).toEqual(["a"]);
    expect(scope.totalCount).toBe(1);
    expect(scope.outsideCount).toBe(2);
    expect(isTaskInProjectScope("a", scope)).toBe(true);
    expect(isTaskInProjectScope("b", scope)).toBe(false);
  });

  it("rejects a globally selected task outside the project scope", () => {
    const scope = resolveProjectTaskScope({
      projectId: "project-1",
      projectMissions: [link("project-1", "a")],
      tasks: [makeTask("a"), makeTask("b")],
    });

    expect(
      resolveScopedSelectedTaskId({
        selectedTaskId: "b",
        scope,
        hasDetail: () => true,
      })
    ).toBeNull();
    expect(
      resolveScopedSelectedTaskId({
        selectedTaskId: "a",
        scope,
        hasDetail: () => true,
      })
    ).toBe("a");
  });

  it("counts status values inside the already scoped task list", () => {
    expect(
      countProjectScopedTasksByStatus(
        [makeTask("a", "running"), makeTask("b", "waiting")],
        "running"
      )
    ).toBe(1);
  });

  it("builds reusable mission and workflow scope guards", () => {
    const missionIds = resolveProjectMissionIds("project-1", [
      link("project-1", "a"),
      link("project-2", "b"),
    ]);
    const workflows = [
      { id: "workflow-a", missionId: "a" },
      { id: "workflow-b", missionId: "b" },
      { id: "workflow-unlinked", missionId: null },
    ];

    expect(isMissionInProjectScope("a", missionIds)).toBe(true);
    expect(isMissionInProjectScope("b", missionIds)).toBe(false);
    expect(isWorkflowInProjectScope(workflows[0], missionIds)).toBe(true);
    expect(isWorkflowInProjectScope(workflows[1], missionIds)).toBe(false);
    expect(filterProjectScopedWorkflows(workflows, missionIds)).toEqual([
      workflows[0],
    ]);
    expect(resolveScopedWorkflow(workflows[1], missionIds)).toBeNull();
    expect(resolveScopedWorkflow(workflows[0], missionIds)).toBe(workflows[0]);
  });
});
