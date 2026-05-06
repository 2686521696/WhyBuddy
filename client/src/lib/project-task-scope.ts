import type { ProjectMission } from "./project-store";
import type { MissionTaskSummary } from "./tasks-store";
import type { WorkflowInfo } from "./workflow-store";

export interface ProjectTaskScopeInput {
  projectId?: string | null;
  projectMissions: ProjectMission[];
  tasks: MissionTaskSummary[];
}

export interface ProjectTaskScope {
  missionIds: Set<string> | null;
  tasks: MissionTaskSummary[];
  totalCount: number;
  outsideCount: number;
}

export function resolveProjectTaskScope({
  projectId,
  projectMissions,
  tasks,
}: ProjectTaskScopeInput): ProjectTaskScope {
  const safeTasks = tasks ?? [];
  if (!projectId) {
    return {
      missionIds: null,
      tasks: safeTasks,
      totalCount: safeTasks.length,
      outsideCount: 0,
    };
  }

  const missionIds = new Set(
    projectMissions
      .filter(mission => mission.projectId === projectId)
      .map(mission => mission.missionId)
  );
  const scopedTasks = safeTasks.filter(task => missionIds.has(task.id));

  return {
    missionIds,
    tasks: scopedTasks,
    totalCount: scopedTasks.length,
    outsideCount: safeTasks.length - scopedTasks.length,
  };
}

export function isTaskInProjectScope(
  taskId: string | null | undefined,
  scope: ProjectTaskScope
) {
  if (!taskId) return false;
  return scope.missionIds ? scope.missionIds.has(taskId) : true;
}

export function resolveScopedSelectedTaskId(params: {
  selectedTaskId?: string | null;
  scope: ProjectTaskScope;
  hasDetail?: (taskId: string) => boolean;
}) {
  const selectedTaskId = params.selectedTaskId ?? null;
  if (!isTaskInProjectScope(selectedTaskId, params.scope)) return null;
  if (params.hasDetail && selectedTaskId) {
    return params.hasDetail(selectedTaskId) ? selectedTaskId : null;
  }
  return selectedTaskId;
}

export function countProjectScopedTasksByStatus(
  tasks: MissionTaskSummary[],
  status: MissionTaskSummary["status"]
) {
  return tasks.filter(task => task.status === status).length;
}

export function resolveProjectMissionIds(
  projectId: string | null | undefined,
  projectMissions: ProjectMission[]
): Set<string> | null {
  if (!projectId) return null;
  return new Set(
    projectMissions
      .filter(mission => mission.projectId === projectId)
      .map(mission => mission.missionId)
  );
}

export function isMissionInProjectScope(
  missionId: string | null | undefined,
  missionIds: Set<string> | null
) {
  if (!missionId) return false;
  return missionIds ? missionIds.has(missionId) : true;
}

export function isWorkflowInProjectScope(
  workflow: Pick<WorkflowInfo, "missionId"> | null | undefined,
  missionIds: Set<string> | null
) {
  if (!missionIds) return true;
  return workflow?.missionId ? missionIds.has(workflow.missionId) : false;
}

export function filterProjectScopedWorkflows<T extends Pick<WorkflowInfo, "missionId">>(
  workflows: T[],
  missionIds: Set<string> | null
) {
  if (!missionIds) return workflows;
  return workflows.filter(workflow => isWorkflowInProjectScope(workflow, missionIds));
}

export function resolveScopedWorkflow<T extends Pick<WorkflowInfo, "missionId">>(
  workflow: T | null | undefined,
  missionIds: Set<string> | null
): T | null {
  if (!workflow) return null;
  return isWorkflowInProjectScope(workflow, missionIds) ? workflow : null;
}
