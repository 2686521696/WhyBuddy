import {
  startTransition,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { OfficeAgentInspectorPanel } from "@/components/office/OfficeAgentInspectorPanel";
import {
  buildOfficeCockpitAvailability,
  resolveWorkflowForSelectedTask,
} from "@/components/office/office-task-cockpit-utils";
import {
  OfficeMemoryReportsPanel,
  OfficeWorkflowFlowPanel,
  OfficeWorkflowHistoryPanel,
} from "@/components/office/OfficeWorkflowContextPanels";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import {
  TasksQueueRail,
  type TasksQueueProjectMeta,
} from "@/components/tasks/TasksQueueRail";
import {
  compactText,
  missionOperatorStateTone,
  missionStatusTone,
} from "@/components/tasks/task-helpers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewportTier, useViewportWidth } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import {
  filterProjectScopedWorkflows,
  resolveProjectMissionIds,
  resolveScopedWorkflow,
} from "@/lib/project-task-scope";
import {
  selectCurrentProject,
  useProjectStore,
  type AddProjectArtifactInput,
  type AddProjectEvidenceInput,
  type AddProjectMessageInput,
  type LinkProjectMissionInput,
  type ProjectArtifact,
  type ProjectClarificationQuestion,
  type ProjectEvidence,
  type ProjectMission,
  type ProjectMissionStatus,
  type ProjectRoute,
} from "@/lib/project-store";
import {
  useTasksStore,
  type MissionTaskDetail,
  type MissionTaskStatus,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/workflow-store";
import type {
  MissionOperatorActionType,
  MissionOperatorState,
} from "@shared/mission/contracts";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function taskStatusLabel(status: MissionTaskStatus, locale: string) {
  const zh: Record<MissionTaskStatus, string> = {
    queued: "排队中",
    running: "执行中",
    waiting: "等待中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  const en: Record<MissionTaskStatus, string> = {
    queued: "Queued",
    running: "Running",
    waiting: "Waiting",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return locale === "zh-CN" ? zh[status] : en[status];
}

function operatorStateLabel(state: MissionOperatorState, locale: string) {
  const zh: Record<MissionOperatorState, string> = {
    active: "进行中",
    paused: "已暂停",
    blocked: "已阻塞",
    terminating: "终止中",
  };
  const en: Record<MissionOperatorState, string> = {
    active: "Active",
    paused: "Paused",
    blocked: "Blocked",
    terminating: "Terminating",
  };
  return locale === "zh-CN" ? zh[state] : en[state];
}

export function buildProjectOperatorActionRecord(params: {
  action: MissionOperatorActionType;
  reason?: string;
}) {
  const detail =
    params.reason?.trim() ||
    "Operator action submitted from project execution center.";
  const title = `Operator action: ${params.action}`;
  const content = `${title}\n${detail}`;

  return {
    message: {
      role: "operator",
      kind: "decision",
      content,
    } satisfies Omit<AddProjectMessageInput, "projectId" | "sourceMissionId">,
    evidence: {
      type: "decision",
      title,
      detail,
    } satisfies Omit<AddProjectEvidenceInput, "projectId" | "sourceMissionId">,
  };
}

export function recordProjectOperatorAction(params: {
  projectId?: string | null;
  missionId?: string | null;
  action: MissionOperatorActionType;
  reason?: string;
  addProjectMessage: (input: AddProjectMessageInput) => unknown;
  addProjectEvidence: (input: AddProjectEvidenceInput) => unknown;
}) {
  if (!params.projectId || !params.missionId) return;
  const record = buildProjectOperatorActionRecord({
    action: params.action,
    reason: params.reason,
  });

  params.addProjectMessage({
    projectId: params.projectId,
    sourceMissionId: params.missionId,
    ...record.message,
  });
  params.addProjectEvidence({
    projectId: params.projectId,
    sourceMissionId: params.missionId,
    ...record.evidence,
  });
}

function mapTaskArtifactKindToProjectType(
  kind: MissionTaskDetail["artifacts"][number]["kind"]
): AddProjectArtifactInput["type"] {
  switch (kind) {
    case "report":
    case "department_report":
      return "report";
    case "attachment":
    case "file":
    case "url":
      return "doc";
    case "log":
      return "report";
    default:
      return "other";
  }
}

export function buildProjectTaskArchiveRecords(params: {
  projectId?: string | null;
  missionId?: string | null;
  detail?: MissionTaskDetail | null;
  existingArtifacts?: ProjectArtifact[];
  existingEvidence?: ProjectEvidence[];
}): {
  artifacts: Array<
    Omit<AddProjectArtifactInput, "projectId" | "sourceMissionId">
  >;
  evidence: Array<
    Omit<AddProjectEvidenceInput, "projectId" | "sourceMissionId">
  >;
} {
  if (!params.projectId || !params.missionId || !params.detail) {
    return { artifacts: [], evidence: [] };
  }

  const existingArtifactKeys = new Set(
    (params.existingArtifacts ?? [])
      .filter(
        item =>
          item.projectId === params.projectId &&
          item.sourceMissionId === params.missionId
      )
      .map(item => item.title.trim().toLowerCase())
  );
  const existingEvidenceKeys = new Set(
    (params.existingEvidence ?? [])
      .filter(
        item =>
          item.projectId === params.projectId &&
          item.sourceMissionId === params.missionId
      )
      .map(item => `${item.type}:${item.title.trim().toLowerCase()}`)
  );

  const artifacts = params.detail.artifacts
    .map(artifact => {
      const title = artifact.title?.trim();
      if (!title) return null;
      const contentPreview =
        artifact.description?.trim() ||
        artifact.content?.trim() ||
        artifact.filename?.trim() ||
        artifact.href?.trim() ||
        undefined;
      const path =
        artifact.downloadUrl ||
        artifact.previewUrl ||
        artifact.href ||
        artifact.filename ||
        undefined;

      return {
        type: mapTaskArtifactKindToProjectType(artifact.kind),
        title,
        path,
        contentPreview,
      } satisfies Omit<
        AddProjectArtifactInput,
        "projectId" | "sourceMissionId"
      >;
    })
    .filter(
      (
        artifact
      ): artifact is Omit<
        AddProjectArtifactInput,
        "projectId" | "sourceMissionId"
      > => Boolean(artifact)
    )
    .filter(
      artifact => !existingArtifactKeys.has(artifact.title.trim().toLowerCase())
    );

  const evidence = params.detail.logSummary
    .map(entry => {
      const title = entry.label?.trim();
      const detail = entry.value?.trim();
      if (!title || !detail) return null;
      return {
        type: "log",
        title: `Task log: ${title}`,
        detail,
      } satisfies Omit<
        AddProjectEvidenceInput,
        "projectId" | "sourceMissionId"
      >;
    })
    .filter(
      (
        item
      ): item is Omit<
        AddProjectEvidenceInput,
        "projectId" | "sourceMissionId"
      > => Boolean(item)
    )
    .filter(
      item =>
        !existingEvidenceKeys.has(
          `${item.type}:${item.title.trim().toLowerCase()}`
        )
    );

  return { artifacts, evidence };
}

export function mapTaskStatusToProjectMissionStatus(
  status: MissionTaskStatus
): ProjectMissionStatus {
  switch (status) {
    case "done":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    default:
      return "queued";
  }
}

export function linkTaskToCurrentProject(params: {
  projectId?: string | null;
  missionId?: string | null;
  taskStatus: MissionTaskStatus;
  linkMissionToProject: (input: LinkProjectMissionInput) => unknown;
}) {
  if (!params.projectId || !params.missionId) return null;
  return params.linkMissionToProject({
    projectId: params.projectId,
    missionId: params.missionId,
    status: mapTaskStatusToProjectMissionStatus(params.taskStatus),
  });
}

export interface TaskProjectRelationshipSummary {
  routeLabel: string;
  roleLabel: string;
  runtimeLabel: string;
  evidenceLabel: string;
}

export interface TaskClarificationTakeoverSummary {
  resolvedCount: number;
  openCount: number;
  requiredOpenCount: number;
  skippableOpenCount: number;
  headline: string;
  detail: string;
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find(value => value && value.trim())?.trim() ?? null;
}

export function buildTaskProjectRelationshipSummary(params: {
  detail: MissionTaskDetail | null;
  projectMission: ProjectMission | null;
  projectRoutes: ProjectRoute[];
  projectEvidence: ProjectEvidence[];
  projectArtifacts: ProjectArtifact[];
  workflowStatus?: string | null;
}): TaskProjectRelationshipSummary {
  const route = params.projectMission?.routeId
    ? params.projectRoutes.find(
        item => item.id === params.projectMission?.routeId
      )
    : null;
  const fallbackRoute = params.projectMission
    ? params.projectRoutes.find(
        item => item.projectId === params.projectMission?.projectId
      )
    : null;
  const resolvedRoute = route ?? fallbackRoute ?? null;
  const routeLabel =
    resolvedRoute?.title ??
    params.detail?.currentStageLabel ??
    params.projectMission?.status ??
    "No route linked";

  const routeRole = firstNonEmpty(
    resolvedRoute?.steps?.map(step => step.role) ?? []
  );
  const detailRole = firstNonEmpty([
    params.detail?.agents[0]?.role,
    params.detail?.agents[0]?.department,
    params.detail?.departmentLabels[0],
  ]);
  const roleLabel = routeRole ?? detailRole ?? "No role assigned";

  const runtimeParts = [
    params.workflowStatus ? `workflow:${params.workflowStatus}` : null,
    params.detail?.runtimeChannels.socket.status
      ? `socket:${params.detail.runtimeChannels.socket.status}`
      : null,
    params.detail?.runtimeChannels.callback.status
      ? `callback:${params.detail.runtimeChannels.callback.status}`
      : null,
  ].filter((item): item is string => Boolean(item));
  const runtimeLabel =
    runtimeParts.length > 0 ? runtimeParts.join(" / ") : "No runtime signal";

  const relatedEvidence = params.projectMission
    ? params.projectEvidence.filter(
        item =>
          item.sourceMissionId === params.projectMission?.missionId ||
          item.projectId === params.projectMission?.projectId
      )
    : [];
  const relatedArtifacts = params.projectMission
    ? params.projectArtifacts.filter(
        item =>
          item.sourceMissionId === params.projectMission?.missionId ||
          item.projectId === params.projectMission?.projectId
      )
    : [];
  const localArtifactCount = params.detail?.artifacts.length ?? 0;
  const localLogCount = params.detail?.logSummary.length ?? 0;
  const evidenceLabel = `${relatedEvidence.length} evidence / ${
    relatedArtifacts.length + localArtifactCount
  } artifacts / ${localLogCount} logs`;

  return {
    routeLabel,
    roleLabel,
    runtimeLabel,
    evidenceLabel,
  };
}

export function buildTaskClarificationTakeoverSummary(params: {
  projectId?: string | null;
  clarificationQuestions: ProjectClarificationQuestion[];
  detail?: MissionTaskDetail | null;
}): TaskClarificationTakeoverSummary | null {
  if (!params.projectId) return null;

  const projectQuestions = params.clarificationQuestions.filter(
    question => question.projectId === params.projectId
  );
  if (!projectQuestions.length) return null;

  const openQuestions = projectQuestions.filter(
    question => !question.answeredAt && !question.skippedAt
  );
  const answeredQuestions = projectQuestions.filter(
    question => question.answeredAt
  );
  const skippedQuestions = projectQuestions.filter(
    question => question.skippedAt
  );
  const resolvedCount = answeredQuestions.length + skippedQuestions.length;
  const requiredOpenCount = openQuestions.filter(
    question => question.required
  ).length;
  const skippableOpenCount = openQuestions.filter(
    question => !question.required || Boolean(question.defaultAssumption)
  ).length;
  const firstOpenQuestion = openQuestions[0];
  const latestResolvedQuestion =
    [...answeredQuestions, ...skippedQuestions].at(-1) ?? null;
  const takeoverPrefix =
    params.detail?.operatorState === "blocked"
      ? "Blocked takeover"
      : "Takeover context";
  const detail =
    firstOpenQuestion?.text ??
    (latestResolvedQuestion
      ? `${latestResolvedQuestion.text}: ${
          latestResolvedQuestion.answer ??
          latestResolvedQuestion.defaultAssumption ??
          "Captured"
        }`
      : "Project clarifications are available for operator follow-up.");

  return {
    resolvedCount,
    openCount: openQuestions.length,
    requiredOpenCount,
    skippableOpenCount,
    headline: `${takeoverPrefix}: ${resolvedCount} resolved / ${openQuestions.length} open`,
    detail,
  };
}

type TasksWorkbenchTab = "task" | "flow" | "agent" | "memory" | "history";

const taskWorkbenchTriggerClassName =
  "min-h-[38px] rounded-[12px] border border-transparent px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-500 transition data-[state=active]:border-sky-100 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-[0_10px_22px_rgba(14,165,233,0.1)]";

function isTasksWorkbenchTab(value: string): value is TasksWorkbenchTab {
  return (
    value === "task" ||
    value === "flow" ||
    value === "agent" ||
    value === "memory" ||
    value === "history"
  );
}

function TasksWorkbenchContextShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/55 bg-white/46 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur-md">
      <div className="shrink-0 px-1 pb-3">
        <div className="text-sm font-semibold text-stone-900">{title}</div>
        <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function TasksWorkbenchEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-stone-300/80 bg-white/62 px-6 py-8 text-center">
      <div className="max-w-md">
        <div className="text-base font-semibold text-stone-900">{title}</div>
        <p className="mt-2 text-sm leading-6 text-stone-500">{description}</p>
      </div>
    </div>
  );
}

function TaskProjectRelationshipStrip({
  locale,
  summary,
}: {
  locale: string;
  summary: TaskProjectRelationshipSummary;
}) {
  const items = [
    {
      label: t(locale, "路线", "Route"),
      value: summary.routeLabel,
    },
    {
      label: t(locale, "角色", "Role"),
      value: summary.roleLabel,
    },
    {
      label: t(locale, "运行时", "Runtime"),
      value: summary.runtimeLabel,
    },
    {
      label: t(locale, "证据", "Evidence"),
      value: summary.evidenceLabel,
    },
  ];

  return (
    <div
      className="mt-4 grid gap-2 md:grid-cols-4"
      data-testid="tasks-project-relationship-strip"
    >
      {items.map(item => (
        <div
          key={item.label}
          className="min-w-0 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {item.label}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-700">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

interface TasksPageProps {
  initialTaskId?: string | null;
  projectId?: string | null;
  className?: string;
}

export default function TasksPage({
  initialTaskId = null,
  projectId = null,
  className,
}: TasksPageProps = {}) {
  const { locale, copy } = useI18n();
  const { isMobile } = useViewportTier();
  const width = useViewportWidth();
  const ensureReady = useTasksStore(state => state.ensureReady);
  const refresh = useTasksStore(state => state.refresh);
  const selectTask = useTasksStore(state => state.selectTask);
  const submitOperatorAction = useTasksStore(
    state => state.submitOperatorAction
  );
  const setDecisionNote = useTasksStore(state => state.setDecisionNote);
  const launchDecision = useTasksStore(state => state.launchDecision);
  const tasks = useTasksStore(state => state.tasks);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const loading = useTasksStore(state => state.loading);
  const ready = useTasksStore(state => state.ready);
  const error = useTasksStore(state => state.error);
  const decisionNotes = useTasksStore(state => state.decisionNotes);
  const operatorActionLoadingByMissionId = useTasksStore(
    state => state.operatorActionLoadingByMissionId
  );
  const storeCurrentProject = useProjectStore(selectCurrentProject);
  const ensureProjectsReady = useProjectStore(state => state.ensureReady);
  const projects = useProjectStore(state => state.projects);
  const selectProject = useProjectStore(state => state.selectProject);
  const projectSpecs = useProjectStore(state => state.specs);
  const projectRoutes = useProjectStore(state => state.routes);
  const projectMissions = useProjectStore(state => state.missions);
  const projectArtifacts = useProjectStore(state => state.artifacts);
  const projectEvidence = useProjectStore(state => state.evidence);
  const projectClarificationQuestions = useProjectStore(
    state => state.clarificationQuestions
  );
  const addProjectMessage = useProjectStore(state => state.addProjectMessage);
  const addProjectArtifact = useProjectStore(state => state.addProjectArtifact);
  const addProjectEvidence = useProjectStore(state => state.addProjectEvidence);
  const linkMissionToProject = useProjectStore(
    state => state.linkMissionToProject
  );
  const workflows = useWorkflowStore(state => state.workflows);
  const agents = useWorkflowStore(state => state.agents);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const currentWorkflowId = useWorkflowStore(state => state.currentWorkflowId);
  const fetchAgents = useWorkflowStore(state => state.fetchAgents);
  const fetchStages = useWorkflowStore(state => state.fetchStages);
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);
  const setCurrentWorkflow = useWorkflowStore(
    state => state.setCurrentWorkflow
  );

  const [search, setSearch] = useState("");
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<TasksWorkbenchTab>("task");

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const isWideDesktop = width >= 1280;
  const isLockedCockpit = width >= 1440 && !isMobile;
  const isProjectScopedRoute = Boolean(projectId);
  const routeProject = useMemo(
    () =>
      projectId
        ? (projects.find(
            project => project.id === projectId && project.status !== "archived"
          ) ?? null)
        : null,
    [projectId, projects]
  );
  const currentProject =
    routeProject ?? (isProjectScopedRoute ? null : storeCurrentProject);

  useEffect(() => {
    ensureProjectsReady();
  }, [ensureProjectsReady]);

  useEffect(() => {
    if (routeProject && storeCurrentProject?.id !== routeProject.id) {
      selectProject(routeProject.id);
    }
  }, [routeProject, selectProject, storeCurrentProject?.id]);

  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  useEffect(() => {
    void fetchAgents();
    void fetchStages();
    void fetchWorkflows();
  }, [fetchAgents, fetchStages, fetchWorkflows]);

  useEffect(() => {
    if (initialTaskId) {
      startTransition(() => {
        selectTask(initialTaskId);
      });
    }
  }, [initialTaskId, selectTask]);

  useEffect(() => {
    if (!highlightedTaskId || typeof window === "undefined") {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedTaskId(current =>
        current === highlightedTaskId ? null : current
      );
    }, 2400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedTaskId]);

  const projectScopedMissionIds = useMemo(() => {
    if (!currentProject) return null;
    return new Set(
      projectMissions
        .filter(mission => mission.projectId === currentProject.id)
        .map(mission => mission.missionId)
    );
  }, [currentProject, projectMissions]);
  const projectWorkflowMissionIds = useMemo(
    () => resolveProjectMissionIds(currentProject?.id ?? null, projectMissions),
    [currentProject?.id, projectMissions]
  );
  const scopedWorkflows = useMemo(
    () => filterProjectScopedWorkflows(workflows, projectWorkflowMissionIds),
    [projectWorkflowMissionIds, workflows]
  );
  const scopedCurrentWorkflow = useMemo(
    () => resolveScopedWorkflow(currentWorkflow, projectWorkflowMissionIds),
    [currentWorkflow, projectWorkflowMissionIds]
  );
  const linkedMissionIds = useMemo(
    () => new Set(projectMissions.map(mission => mission.missionId)),
    [projectMissions]
  );
  const projectScopedTasks = useMemo(() => {
    if (isProjectScopedRoute && !currentProject) return [];
    if (!currentProject || !projectScopedMissionIds) return tasks;
    return tasks.filter(task => projectScopedMissionIds.has(task.id));
  }, [currentProject, isProjectScopedRoute, projectScopedMissionIds, tasks]);
  const unassignedTaskCount = useMemo(() => {
    if (!currentProject) return 0;
    return tasks.filter(task => !linkedMissionIds.has(task.id)).length;
  }, [currentProject, linkedMissionIds, tasks]);
  const outsideProjectTaskCount = useMemo(() => {
    if (!currentProject || !projectScopedMissionIds) return 0;
    return tasks.filter(task => !projectScopedMissionIds.has(task.id)).length;
  }, [currentProject, projectScopedMissionIds, tasks]);
  const taskScopeTotalCount = projectScopedTasks.length;
  const taskProjectMetaById = useMemo<
    Record<string, TasksQueueProjectMeta>
  >(() => {
    const projectsById = new Map(
      projects.map(project => [project.id, project])
    );
    const specsById = new Map(projectSpecs.map(spec => [spec.id, spec]));
    const routesById = new Map(projectRoutes.map(route => [route.id, route]));
    const metaByTaskId: Record<string, TasksQueueProjectMeta> = {};

    tasks.forEach(task => {
      const projectMission = projectMissions.find(
        mission => mission.missionId === task.id
      );
      const project = projectMission
        ? (projectsById.get(projectMission.projectId) ?? null)
        : null;
      const route = projectMission?.routeId
        ? (routesById.get(projectMission.routeId) ?? null)
        : project?.currentRouteId
          ? (routesById.get(project.currentRouteId) ?? null)
          : null;
      const spec = route?.specId
        ? (specsById.get(route.specId) ?? null)
        : project?.currentSpecId
          ? (specsById.get(project.currentSpecId) ?? null)
          : null;

      metaByTaskId[task.id] = {
        projectName: project?.name ?? null,
        routeTitle: route?.title ?? null,
        specTitle: spec?.title ?? null,
        sourceLabel: projectMission
          ? t(locale, "项目归档", "Project archive")
          : t(locale, "未归档任务", "Unassigned task"),
      };
    });

    return metaByTaskId;
  }, [locale, projectMissions, projectRoutes, projectSpecs, projects, tasks]);
  const filteredTasks = useMemo(() => {
    if (!deferredSearch) return projectScopedTasks;
    return projectScopedTasks.filter(task => {
      const searchable = [
        task.title,
        task.sourceText,
        task.summary,
        task.currentStageLabel,
        task.waitingFor,
        ...task.departmentLabels,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(deferredSearch);
    });
  }, [deferredSearch, projectScopedTasks]);

  const selectedTaskInScope =
    selectedTaskId && filteredTasks.some(task => task.id === selectedTaskId)
      ? selectedTaskId
      : null;
  const activeTaskId =
    (selectedTaskInScope && detailsById[selectedTaskInScope]
      ? selectedTaskInScope
      : null) ||
    filteredTasks[0]?.id ||
    null;
  const selectedDetail = activeTaskId
    ? detailsById[activeTaskId] || null
    : null;
  const selectedTaskSummary =
    tasks.find(task => task.id === activeTaskId) || null;
  const activeTaskIsUnassigned = false;
  const activeProjectMission = useMemo(() => {
    if (!activeTaskId) return null;
    return (
      projectMissions.find(
        mission =>
          mission.missionId === activeTaskId &&
          (!currentProject || mission.projectId === currentProject.id)
      ) ?? null
    );
  }, [activeTaskId, currentProject, projectMissions]);
  const decisionNote = activeTaskId ? decisionNotes[activeTaskId] || "" : "";
  const activeWorkflow = useMemo(
    () =>
      resolveWorkflowForSelectedTask({
        taskId: activeTaskId,
        workflows: scopedWorkflows,
        currentWorkflow: scopedCurrentWorkflow,
      }),
    [activeTaskId, scopedCurrentWorkflow, scopedWorkflows]
  );
  const availability = useMemo(
    () =>
      buildOfficeCockpitAvailability({
        detail: selectedDetail,
        workflow: activeWorkflow,
        agents,
        workflows: scopedWorkflows,
      }),
    [activeWorkflow, agents, scopedWorkflows, selectedDetail]
  );
  const relationshipSummary = useMemo(
    () =>
      buildTaskProjectRelationshipSummary({
        detail: selectedDetail,
        projectMission: activeProjectMission,
        projectRoutes,
        projectEvidence,
        projectArtifacts,
        workflowStatus: activeWorkflow?.status ?? null,
      }),
    [
      activeProjectMission,
      activeWorkflow?.status,
      projectArtifacts,
      projectEvidence,
      projectRoutes,
      selectedDetail,
    ]
  );
  const clarificationTakeoverSummary = useMemo(
    () =>
      buildTaskClarificationTakeoverSummary({
        projectId: currentProject?.id ?? null,
        clarificationQuestions: projectClarificationQuestions,
        detail: selectedDetail,
      }),
    [currentProject?.id, projectClarificationQuestions, selectedDetail]
  );
  const taskArchiveRecords = useMemo(
    () =>
      buildProjectTaskArchiveRecords({
        projectId: currentProject?.id ?? null,
        missionId: activeTaskId,
        detail: selectedDetail,
        existingArtifacts: projectArtifacts,
        existingEvidence: projectEvidence,
      }),
    [
      activeTaskId,
      currentProject?.id,
      projectArtifacts,
      projectEvidence,
      selectedDetail,
    ]
  );

  useEffect(() => {
    const workflowForTask = resolveWorkflowForSelectedTask({
      taskId: activeTaskId,
      workflows: scopedWorkflows,
      currentWorkflow: scopedCurrentWorkflow,
    });

    if (workflowForTask && workflowForTask.id !== currentWorkflowId) {
      setCurrentWorkflow(workflowForTask.id);
      return;
    }

    if (!workflowForTask && currentWorkflowId) {
      setCurrentWorkflow(null);
    }
  }, [
    activeTaskId,
    currentWorkflowId,
    setCurrentWorkflow,
    scopedCurrentWorkflow,
    scopedWorkflows,
  ]);

  useEffect(() => {
    if (!currentProject?.id || !activeTaskId) return;

    for (const artifact of taskArchiveRecords.artifacts) {
      addProjectArtifact({
        projectId: currentProject.id,
        sourceMissionId: activeTaskId,
        ...artifact,
      });
    }

    for (const evidence of taskArchiveRecords.evidence) {
      addProjectEvidence({
        projectId: currentProject.id,
        sourceMissionId: activeTaskId,
        ...evidence,
      });
    }
  }, [
    activeTaskId,
    addProjectArtifact,
    addProjectEvidence,
    currentProject?.id,
    taskArchiveRecords,
  ]);

  async function handleLaunchDecision(presetId: string) {
    if (!activeTaskId) return;
    setLaunchingPresetId(presetId);
    try {
      await launchDecision(activeTaskId, presetId);
    } finally {
      setLaunchingPresetId(null);
    }
  }

  async function handleSubmitOperatorAction(payload: {
    action: MissionOperatorActionType;
    reason?: string;
  }) {
    if (!activeTaskId) return;
    try {
      await submitOperatorAction(activeTaskId, {
        action: payload.action,
        reason: payload.reason,
      });
      recordProjectOperatorAction({
        projectId: currentProject?.id,
        missionId: activeTaskId,
        action: payload.action,
        reason: payload.reason,
        addProjectMessage,
        addProjectEvidence,
      });
      toast.success(
        copy.tasks.listPage.actionSuccess(
          copy.tasks.statuses.action[
            payload.action === "mark-blocked" ? "markBlocked" : payload.action
          ]
        )
      );
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : copy.tasks.listPage.actionError;
      toast.error(message);
      throw submitError;
    }
  }

  function handleLinkActiveTaskToCurrentProject() {
    if (!currentProject || !activeTaskId || !selectedTaskSummary) return;
    const linked = linkTaskToCurrentProject({
      projectId: currentProject.id,
      missionId: activeTaskId,
      taskStatus: selectedTaskSummary.status,
      linkMissionToProject,
    });
    if (!linked) {
      toast.error(
        t(
          locale,
          "无法将任务归入当前项目。",
          "Failed to attach the task to the current project."
        )
      );
      return;
    }
    setHighlightedTaskId(activeTaskId);
    toast.success(
      t(
        locale,
        "已将任务归入当前项目。",
        "Task attached to the current project."
      )
    );
  }

  const refreshCurrent = () =>
    void refresh({ preferredTaskId: activeTaskId || null });
  const focusTitle =
    selectedDetail?.title ||
    selectedTaskSummary?.title ||
    t(locale, "等待选择任务", "Pick a task to inspect");
  const focusSummary =
    compactText(
      selectedDetail?.summary ||
        selectedTaskSummary?.summary ||
        selectedTaskSummary?.sourceText ||
        t(
          locale,
          "任务页现在只负责展示队列、任务详情和执行轨迹；发起与补充信息入口统一保留在办公室首页。",
          "Tasks is now display-only for queue, details, and execution history. Launch and clarification live on the office home page."
        ),
      220
    ) ||
    t(
      locale,
      "任务页现在只负责展示队列、任务详情和执行轨迹；发起与补充信息入口统一保留在办公室首页。",
      "Tasks is now display-only for queue, details, and execution history. Launch and clarification live on the office home page."
    );
  const lastUpdatedLabel = selectedDetail?.updatedAt
    ? new Intl.DateTimeFormat(locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(selectedDetail.updatedAt))
    : t(locale, "暂无", "n/a");
  const progressValue =
    selectedDetail?.progress ?? selectedTaskSummary?.progress ?? 0;
  const taskOverviewPanel = (
    <section
      className="rounded-[24px] border border-slate-200/80 bg-white px-5 py-4 shadow-[0_18px_42px_rgba(15,23,42,0.06)]"
      data-testid="tasks-page-focus-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>{t(locale, "任务中心", "Tasks")}</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-900">
              {t(locale, "任务详情", "Task Detail")}
            </span>
          </div>
          <div className="mt-3 text-xl font-semibold tracking-tight text-slate-950 md:text-2xl">
            {focusTitle}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            {focusSummary}
          </p>
        </div>

        <div className="grid min-w-[172px] shrink-0 gap-1 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-[11px] font-semibold text-slate-500">
            {t(locale, "可见任务数", "Visible Tasks")}
          </span>
          <span className="font-data text-2xl font-semibold text-slate-950">
            {filteredTasks.length}
            <span className="ml-1 text-sm font-medium text-slate-400">
              / {taskScopeTotalCount}
            </span>
          </span>
        </div>
      </div>

      {activeTaskIsUnassigned && currentProject ? (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-dashed border-sky-200 bg-sky-50/70 px-3 py-2"
          data-testid="tasks-assign-current-project"
        >
          <div className="min-w-0 text-xs leading-5 text-slate-600">
            <span className="font-semibold text-slate-800">
              {t(locale, "未归档任务", "Unassigned task")}
            </span>
            <span className="ml-2">
              {t(
                locale,
                `可归入 ${currentProject.name}`,
                `Can be attached to ${currentProject.name}`
              )}
            </span>
          </div>
          <button
            type="button"
            className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"
            onClick={handleLinkActiveTaskToCurrentProject}
          >
            {t(locale, "归入当前项目", "Attach to project")}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <span
          className={cn(
            "workspace-status px-3 py-1 text-xs font-semibold",
            selectedDetail
              ? missionStatusTone(selectedDetail.status)
              : "workspace-tone-neutral"
          )}
        >
          {selectedDetail
            ? taskStatusLabel(selectedDetail.status, locale)
            : t(locale, "待选择", "No selection")}
        </span>
        <span
          className={cn(
            "workspace-status px-3 py-1 text-xs font-semibold",
            selectedDetail
              ? missionOperatorStateTone(selectedDetail.operatorState)
              : "workspace-tone-neutral"
          )}
        >
          {selectedDetail
            ? operatorStateLabel(selectedDetail.operatorState, locale)
            : t(locale, "只读展示", "Display only")}
        </span>
        <span className="workspace-status workspace-tone-info px-3 py-1 text-xs font-semibold">
          {t(locale, `进度 ${progressValue}%`, `Progress ${progressValue}%`)}
        </span>
        <span className="workspace-status workspace-tone-neutral px-3 py-1 text-xs font-semibold">
          {t(
            locale,
            `最近更新 ${lastUpdatedLabel}`,
            `Updated ${lastUpdatedLabel}`
          )}
        </span>
      </div>

      <TaskProjectRelationshipStrip
        locale={locale}
        summary={relationshipSummary}
      />
      {clarificationTakeoverSummary ? (
        <div
          className="mt-2 rounded-[14px] border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950"
          data-testid="tasks-clarification-takeover-summary"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {clarificationTakeoverSummary.headline}
            </span>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              {clarificationTakeoverSummary.requiredOpenCount} required /{" "}
              {clarificationTakeoverSummary.skippableOpenCount} skippable
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-emerald-800">
            {clarificationTakeoverSummary.detail}
          </p>
        </div>
      ) : null}
    </section>
  );
  const taskDetailPanel = (
    <TasksCockpitDetail
      detail={selectedDetail}
      decisionNote={decisionNote}
      onDecisionNoteChange={value => {
        if (!activeTaskId) return;
        setDecisionNote(activeTaskId, value);
      }}
      onLaunchDecision={handleLaunchDecision}
      launchingPresetId={launchingPresetId}
      onSubmitOperatorAction={handleSubmitOperatorAction}
      operatorActionLoading={
        activeTaskId
          ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
          : {}
      }
      onDecisionSubmitted={refreshCurrent}
      className="h-full min-h-0"
    />
  );
  const taskWorkbenchPanel = (
    <Tabs
      value={activeTab}
      onValueChange={value => {
        if (isTasksWorkbenchTab(value)) {
          setActiveTab(value);
        }
      }}
      className="min-h-0 flex-1 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_42px_rgba(15,23,42,0.06)]"
      data-testid="tasks-page-detail-column"
    >
      <TabsList className="grid h-auto w-full grid-cols-5 gap-1 rounded-[16px] border border-slate-200 bg-slate-50 p-1">
        <TabsTrigger className={taskWorkbenchTriggerClassName} value="task">
          {t(locale, "任务", "Task")}
        </TabsTrigger>
        <TabsTrigger className={taskWorkbenchTriggerClassName} value="flow">
          {t(locale, "团队流", "Flow")}
        </TabsTrigger>
        <TabsTrigger className={taskWorkbenchTriggerClassName} value="agent">
          Agent
        </TabsTrigger>
        <TabsTrigger className={taskWorkbenchTriggerClassName} value="memory">
          {t(locale, "记忆", "Memory")}
        </TabsTrigger>
        <TabsTrigger className={taskWorkbenchTriggerClassName} value="history">
          {t(locale, "历史", "History")}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="task"
        className="mt-3 h-full min-h-0 flex-1 overflow-hidden"
      >
        {taskDetailPanel}
      </TabsContent>

      <TabsContent
        value="flow"
        className="mt-3 h-full min-h-0 flex-1 overflow-hidden"
      >
        <TasksWorkbenchContextShell
          title={t(locale, "团队流", "Flow")}
          description={t(
            locale,
            "围绕当前任务展示 workflow 阶段、组织结构、输入附件和工作包。",
            "Inspect workflow stages, organization context, input attachments, and work packages around the selected task."
          )}
        >
          <OfficeWorkflowFlowPanel
            workflow={activeWorkflow}
            missionDetail={selectedDetail}
            onOpenTask={taskId => {
              setActiveTab("task");
              startTransition(() => {
                selectTask(taskId);
              });
            }}
          />
        </TasksWorkbenchContextShell>
      </TabsContent>

      <TabsContent
        value="agent"
        className="mt-3 h-full min-h-0 flex-1 overflow-hidden"
      >
        <TasksWorkbenchContextShell
          title="Agent"
          description={t(
            locale,
            "查看办公室 Agent、团队站位和 heartbeat 状态，任务页不再提供发起入口。",
            "Inspect office agents, team placement, and heartbeat state without adding a launch entry to the tasks page."
          )}
        >
          {availability.agent ? (
            <OfficeAgentInspectorPanel
              className="h-full"
              embedded
              projectId={currentProject?.id ?? null}
            />
          ) : (
            <TasksWorkbenchEmptyState
              title={t(
                locale,
                "还没有可查看的 Agent",
                "No agent is available yet"
              )}
              description={t(
                locale,
                "等待团队或场景 Agent 建立后，这里会显示 Agent 详情与状态。",
                "After team or scene agents are available, this tab will show agent details and status."
              )}
            />
          )}
        </TasksWorkbenchContextShell>
      </TabsContent>

      <TabsContent
        value="memory"
        className="mt-3 h-full min-h-0 flex-1 overflow-hidden"
      >
        <TasksWorkbenchContextShell
          title={t(locale, "记忆与报告", "Memory and reports")}
          description={t(
            locale,
            "复用办公室上下文面板查看最近记忆、搜索结果和 heartbeat 报告。",
            "Reuse the office context panel for recent memory, search results, and heartbeat reports."
          )}
        >
          <OfficeMemoryReportsPanel workflow={activeWorkflow} />
        </TasksWorkbenchContextShell>
      </TabsContent>

      <TabsContent
        value="history"
        className="mt-3 h-full min-h-0 flex-1 overflow-hidden"
      >
        <TasksWorkbenchContextShell
          title={t(locale, "历史", "History")}
          description={t(
            locale,
            "保留 workflow 连续性，选择有 mission 的历史项时同步任务队列焦点。",
            "Keep workflow continuity visible and sync the task queue focus when a history item has a mission."
          )}
        >
          <OfficeWorkflowHistoryPanel
            workflow={activeWorkflow}
            activeWorkflowId={activeWorkflow?.id || null}
            projectId={currentProject?.id ?? null}
            onSelectWorkflow={workflowId => {
              setCurrentWorkflow(workflowId);
              const matched = scopedWorkflows.find(
                workflow => workflow.id === workflowId
              );
              if (matched?.missionId) {
                startTransition(() => {
                  selectTask(matched.missionId!);
                });
              }
              setActiveTab("flow");
            }}
          />
        </TasksWorkbenchContextShell>
      </TabsContent>
    </Tabs>
  );

  return (
    <div
      className={cn(
        "bg-slate-50 text-slate-900",
        isMobile
          ? "min-h-screen pb-28 pt-[calc(env(safe-area-inset-top)+96px)]"
          : isLockedCockpit
            ? "h-screen overflow-hidden"
            : "min-h-screen pb-32 pt-3",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1680px] flex-col px-4 md:px-5",
          isLockedCockpit ? "h-full py-5" : "min-h-screen py-5"
        )}
        data-testid="tasks-page-dashboard"
      >
        {currentProject ? (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-sky-100 bg-white/78 px-4 py-3 text-sm shadow-[0_12px_28px_rgba(14,165,233,0.08)]"
            data-testid="tasks-project-scope-banner"
          >
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                {t(locale, "项目执行中心", "Project execution center")}
              </div>
              <div className="mt-1 truncate font-semibold text-slate-900">
                {currentProject.name}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                {t(
                  locale,
                  `当前项目任务 ${taskScopeTotalCount}`,
                  `Project tasks ${taskScopeTotalCount}`
                )}
              </span>
              {isProjectScopedRoute ? (
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                  {t(
                    locale,
                    `已隐藏项目外任务 ${outsideProjectTaskCount}`,
                    `Hidden outside project ${outsideProjectTaskCount}`
                  )}
                </span>
              ) : (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                  {t(
                    locale,
                    `未归档 ${unassignedTaskCount}`,
                    `Unassigned ${unassignedTaskCount}`
                  )}
                </span>
              )}
            </div>
          </div>
        ) : null}
        {isWideDesktop ? (
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-5 xl:grid-cols-[328px_minmax(0,1fr)]",
              isLockedCockpit && "overflow-hidden"
            )}
          >
            <TasksQueueRail
              tasks={filteredTasks}
              totalCount={taskScopeTotalCount}
              activeTaskId={activeTaskId}
              highlightedTaskId={highlightedTaskId}
              loading={loading}
              ready={ready}
              error={error}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={taskId => {
                startTransition(() => {
                  selectTask(taskId);
                });
              }}
              onRefresh={refreshCurrent}
              projectMetaByTaskId={taskProjectMetaById}
              className={cn(
                isLockedCockpit ? "h-full min-h-0" : "min-h-[640px]"
              )}
            />

            <div className="min-w-0 flex min-h-0 flex-col gap-5">
              <div className={cn(isLockedCockpit && "shrink-0")}>
                {taskOverviewPanel}
              </div>

              {taskWorkbenchPanel}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {taskOverviewPanel}

            <TasksQueueRail
              tasks={filteredTasks}
              totalCount={taskScopeTotalCount}
              activeTaskId={activeTaskId}
              highlightedTaskId={highlightedTaskId}
              loading={loading}
              ready={ready}
              error={error}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={taskId => {
                startTransition(() => {
                  selectTask(taskId);
                });
              }}
              onRefresh={refreshCurrent}
              projectMetaByTaskId={taskProjectMetaById}
              className="min-h-[320px] max-h-[460px]"
            />

            <div className="min-h-[560px]">{taskWorkbenchPanel}</div>
          </div>
        )}
      </div>
    </div>
  );
}
