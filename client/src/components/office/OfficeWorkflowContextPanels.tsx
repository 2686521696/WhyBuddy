import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CircleAlert,
  Download,
  FileClock,
  HeartPulse,
  Layers3,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
} from "lucide-react";
import { normalizeWorkflowAttachments } from "@shared/workflow-input";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";
import type { MissionTaskDetail } from "@/lib/tasks-store";
import {
  selectHeartbeatReportsForAgent,
  selectHeartbeatStatusForAgent,
  selectOfficeAgentOptions,
  selectPrimaryOfficeAgentId,
  selectWorkflowOrganization,
} from "@/lib/workflow-selectors";
import { cn } from "@/lib/utils";
import { useWorkflowStore, type WorkflowInfo } from "@/lib/workflow-store";
import type {
  AigcMonitoringInstanceDetail,
  AigcMonitoringSessionDetail,
  GraphInstanceSnapshot,
  GraphNodeRunSnapshot,
} from "@/lib/runtime/types";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(locale: string, value: string | null | undefined) {
  if (!value) {
    return t(locale, "暂无", "Not yet");
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function summarizeText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 180
) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function workflowStatusTone(status: WorkflowInfo["status"]) {
  switch (status) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "completed_with_errors":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function heartbeatTone(state: string | null | undefined) {
  switch (state) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "scheduled":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function workflowStatusLabel(locale: string, status: WorkflowInfo["status"]) {
  switch (status) {
    case "running":
      return t(locale, "执行中", "Running");
    case "completed":
      return t(locale, "已完成", "Completed");
    case "completed_with_errors":
      return t(locale, "完成但有问题", "Completed with issues");
    case "failed":
      return t(locale, "失败", "Failed");
    default:
      return t(locale, "准备中", "Pending");
  }
}

function graphRuntimeTone(status: GraphNodeRunSnapshot["status"]) {
  switch (status) {
    case "EXECUTING":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "EXECUTED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "WAITING_INPUT":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "EXCEPTION":
    case "FORCE_TERMINATED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function graphRuntimeLabel(locale: string, status: GraphNodeRunSnapshot["status"]) {
  switch (status) {
    case "EXECUTING":
      return t(locale, "执行中", "Executing");
    case "EXECUTED":
      return t(locale, "已执行", "Executed");
    case "WAITING_INPUT":
      return t(locale, "等待输入", "Waiting input");
    case "EXCEPTION":
      return t(locale, "异常", "Exception");
    case "FORCE_TERMINATED":
      return t(locale, "已终止", "Terminated");
    default:
      return t(locale, "待执行", "Pending");
  }
}

function monitoringStatusTone(status: string | null | undefined) {
  switch (status) {
    case "EXECUTING":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "EXECUTED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "WAITING_INPUT":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "EXCEPTION":
    case "FORCE_TERMINATED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-600";
  }
}

function monitoringStatusLabel(locale: string, status: string | null | undefined) {
  switch (status) {
    case "EXECUTING":
      return t(locale, "执行中", "Executing");
    case "EXECUTED":
      return t(locale, "已执行", "Executed");
    case "WAITING_INPUT":
      return t(locale, "等待录入", "Waiting input");
    case "EXCEPTION":
      return t(locale, "执行异常", "Exception");
    case "FORCE_TERMINATED":
      return t(locale, "强制结束", "Force terminated");
    default:
      return t(locale, "未执行", "Pending");
  }
}

function summarizeGraphInstance(instance: GraphInstanceSnapshot | null) {
  if (!instance) {
    return {
      total: 0,
      executing: 0,
      executed: 0,
      waiting: 0,
      exception: 0,
    };
  }

  return instance.nodeRuns.reduce(
    (summary, node) => {
      summary.total += 1;
      if (node.status === "EXECUTING") summary.executing += 1;
      if (node.status === "EXECUTED") summary.executed += 1;
      if (node.status === "WAITING_INPUT") summary.waiting += 1;
      if (node.status === "EXCEPTION" || node.status === "FORCE_TERMINATED") {
        summary.exception += 1;
      }
      return summary;
    },
    {
      total: 0,
      executing: 0,
      executed: 0,
      waiting: 0,
      exception: 0,
    }
  );
}

function summarizeMonitoringInstance(
  instance: AigcMonitoringInstanceDetail | null
) {
  if (!instance) {
    return {
      total: 0,
      executing: 0,
      executed: 0,
      pending: 0,
      exception: 0,
    };
  }

  return instance.nodes.reduce(
    (summary, node) => {
      summary.total += 1;
      if (node.status === "EXECUTING") summary.executing += 1;
      if (node.status === "EXECUTED") summary.executed += 1;
      if (node.status === "PENDING") summary.pending += 1;
      if (node.status === "EXCEPTION") summary.exception += 1;
      return summary;
    },
    {
      total: 0,
      executing: 0,
      executed: 0,
      pending: 0,
      exception: 0,
    }
  );
}

function presentMonitoringLink(
  value: string | null | undefined,
  fallback: string
) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function summarizeSessionMessage(
  message: AigcMonitoringSessionDetail["messages"][number],
  locale: string
) {
  const toolCallSummary =
    message.toolCalls && message.toolCalls.length > 0
      ? message.toolCalls.map(tool => tool.name).join(", ")
      : "";
  const merged = [message.content, message.thinking, toolCallSummary]
    .filter(Boolean)
    .join(" ");

  return summarizeText(
    merged,
    t(locale, "暂无会话内容", "No session content yet"),
    140
  );
}

function OfficeTabEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-stone-300/80 bg-white/62 px-8 py-10 text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-stone-900">{title}</div>
        <div className="mt-2 text-sm leading-6 text-stone-500">
          {description}
        </div>
      </div>
    </div>
  );
}

function ContextCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-stone-200/80 bg-white/78 px-4 py-4 shadow-[0_14px_36px_rgba(99,73,45,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-stone-700">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-[#b06f46]">
            {icon}
          </span>
          <div className="text-sm font-semibold text-stone-900">{title}</div>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StageBar({
  locale,
  currentStage,
}: {
  locale: string;
  currentStage: string | null;
}) {
  const stages = useWorkflowStore(state => state.stages);
  const activeIndex = stages.findIndex(stage => stage.id === currentStage);

  if (stages.length === 0) {
    return (
      <div className="text-sm text-stone-500">
        {currentStage || t(locale, "暂无阶段", "No stage yet")}
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const done = activeIndex >= 0 && index < activeIndex;
        const active = stage.id === currentStage;

        return (
          <span
            key={stage.id}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold",
              active
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-stone-200 bg-stone-50 text-stone-500"
            )}
          >
            {stage.label}
          </span>
        );
      })}
    </div>
  );
}

export function OfficeWorkflowFlowPanel({
  workflow,
  missionDetail,
  onOpenTask,
}: {
  workflow: WorkflowInfo | null;
  missionDetail: MissionTaskDetail | null;
  onOpenTask: (taskId: string) => void;
}) {
  const { locale } = useI18n();
  const workflowTasks = useWorkflowStore(state => state.tasks);
  const graphInstance = useWorkflowStore(
    state => state.currentWorkflowGraphInstance
  );
  const downloadWorkflowReport = useWorkflowStore(
    state => state.downloadWorkflowReport
  );
  const downloadDepartmentReport = useWorkflowStore(
    state => state.downloadDepartmentReport
  );

  const organization = useMemo(
    () => selectWorkflowOrganization(workflow),
    [workflow]
  );
  const attachments = useMemo(
    () => normalizeWorkflowAttachments(workflow?.results?.input?.attachments),
    [workflow]
  );
  const groupedTasks = useMemo(() => {
    return Object.entries(
      workflowTasks.reduce<Record<string, typeof workflowTasks>>(
        (acc, task) => {
          (acc[task.department] ||= []).push(task);
          return acc;
        },
        {}
      )
    );
  }, [workflowTasks]);
  const nodesByDepartment = useMemo(() => {
    const nodes = organization?.nodes ?? [];

    return Object.entries(
      nodes.reduce<Record<string, typeof nodes>>((acc, node) => {
        (acc[node.departmentLabel] ||= []).push(node);
        return acc;
      }, {})
    );
  }, [organization]);
  const graphSummary = useMemo(
    () => summarizeGraphInstance(graphInstance),
    [graphInstance]
  );

  if (!workflow) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有团队流上下文", "No workflow context yet")}
        description={t(
          locale,
          "快速任务会直接进入 mission，团队流发起成功后这里会显示 stage、组织摘要、输入附件和任务工作包。",
          "Mission launches land directly in the task flow. After a workflow launch succeeds, this tab shows stages, organization context, input attachments, and work packages."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "团队流概览", "Team flow overview")}
          icon={<Layers3 className="size-4" />}
          action={
            workflow.missionId ? (
              <Button
                type="button"
                variant="outline"
                className="workspace-control rounded-full"
                onClick={() => onOpenTask(workflow.missionId!)}
              >
                {t(locale, "打开任务", "Open task")}
                <ArrowRight className="size-4" />
              </Button>
            ) : null
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-stone-900">
                {workflow.directive}
              </div>
              <div className="mt-2 text-sm leading-6 text-stone-600">
                {summarizeText(
                  organization?.reasoning,
                  t(
                    locale,
                    "团队已经建立，后续执行上下文会持续同步到这里。",
                    "The team is prepared and the workflow context will continue syncing here."
                  )
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  workflowStatusTone(workflow.status)
                )}
              >
                {workflowStatusLabel(locale, workflow.status)}
              </span>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[10px] font-semibold text-stone-500">
                {formatDate(locale, workflow.created_at)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "当前阶段", "Current stage")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {workflow.current_stage || t(locale, "准备中", "Pending")}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "输入附件", "Input attachments")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {attachments.length}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "任务工作包", "Work packages")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {missionDetail?.taskCount || workflowTasks.length || 0}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <StageBar locale={locale} currentStage={workflow.current_stage} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void downloadWorkflowReport(workflow.id, "md")}
            >
              <Download className="size-4" />
              {t(locale, "导出总报告", "Export workflow report")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void downloadWorkflowReport(workflow.id, "json")}
            >
              <Download className="size-4" />
              JSON
            </Button>
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "组织与角色摘要", "Organization and role summary")}
          icon={<BriefcaseBusiness className="size-4" />}
        >
          {organization ? (
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-3">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.departments.length}{" "}
                  {t(locale, "个部门", "departments")}
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.nodes.length} {t(locale, "个节点", "nodes")}
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm text-stone-700">
                  {organization.taskProfile}
                </div>
              </div>

              {nodesByDepartment.map(([department, nodes]) => (
                <div
                  key={department}
                  className="rounded-[20px] border border-stone-200/80 bg-white/80 px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-900">
                      {department}
                    </div>
                    {workflowTasks.find(task => task.department === department)
                      ?.manager_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="workspace-control rounded-full"
                        onClick={() =>
                          void downloadDepartmentReport(
                            workflow.id,
                            workflowTasks.find(
                              task => task.department === department
                            )!.manager_id,
                            "md"
                          )
                        }
                      >
                        <Download className="size-4" />
                        {t(locale, "部门报告", "Department report")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 xl:grid-cols-2">
                    {nodes.map(node => (
                      <div
                        key={node.id}
                        className="rounded-[18px] border border-stone-200/80 bg-stone-50/85 px-3 py-3"
                      >
                        <div className="text-sm font-semibold text-stone-900">
                          {node.name} · {node.title}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-stone-500">
                          {summarizeText(
                            node.responsibility,
                            t(locale, "暂无角色说明", "No responsibility yet"),
                            120
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm leading-6 text-stone-500">
              {t(
                locale,
                "当前 workflow 还没有组织摘要，后续生成后会在这里展示。",
                "This workflow does not have an organization summary yet."
              )}
            </div>
          )}
        </ContextCard>

        <ContextCard
          title={t(locale, "运行图实例", "Graph instance runtime")}
          icon={<Bot className="size-4" />}
        >
          {graphInstance ? (
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-4">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t(locale, "节点总数", "Total nodes")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-stone-900">
                    {graphSummary.total}
                  </div>
                </div>
                <div className="rounded-[18px] border border-sky-200/80 bg-sky-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                    {t(locale, "执行中", "Executing")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sky-900">
                    {graphSummary.executing}
                  </div>
                </div>
                <div className="rounded-[18px] border border-emerald-200/80 bg-emerald-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {t(locale, "已执行", "Executed")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-emerald-900">
                    {graphSummary.executed}
                  </div>
                </div>
                <div className="rounded-[18px] border border-rose-200/80 bg-rose-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                    {t(locale, "异常节点", "Exceptions")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-rose-900">
                    {graphSummary.exception}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-3">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t(locale, "运行状态", "Runtime status")}
                  </div>
                  <div className="mt-1">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        graphRuntimeTone(graphInstance.status)
                      )}
                    >
                      {graphRuntimeLabel(locale, graphInstance.status)}
                    </span>
                  </div>
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t(locale, "消息数量", "Messages")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-stone-900">
                    {graphInstance.telemetry.messageCount}
                  </div>
                </div>
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {t(locale, "边转移", "Edge transitions")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-stone-900">
                    {graphInstance.edgeTransitions.length}
                  </div>
                </div>
              </div>

              {graphInstance.telemetry.waitingFor ? (
                <div className="rounded-[18px] border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-sm leading-6 text-amber-800">
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="font-semibold">
                        {t(locale, "当前等待", "Currently waiting")}
                      </div>
                      <div>{graphInstance.telemetry.waitingFor}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {graphInstance.nodeRuns.map(node => (
                  <div
                    key={node.nodeId}
                    className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-stone-900">
                          {node.title}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-stone-500">
                          {[node.departmentLabel, node.role, node.stageKey]
                            .filter(Boolean)
                            .join(" / ") || t(locale, "未标注", "Unlabeled")}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                          graphRuntimeTone(node.status)
                        )}
                      >
                        {graphRuntimeLabel(locale, node.status)}
                      </span>
                    </div>

                    {node.outputPreview ? (
                      <div className="mt-2 text-xs leading-6 text-stone-600">
                        {summarizeText(
                          node.outputPreview,
                          t(locale, "暂无输出摘要", "No output summary"),
                          160
                        )}
                      </div>
                    ) : null}

                    {node.error ? (
                      <div className="mt-2 rounded-[14px] border border-rose-200/80 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                        {node.error}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm leading-6 text-stone-500">
              {t(
                locale,
                "当前还没有可展示的运行图实例。在高级运行时下打开 workflow 后，这里会同步节点执行状态、等待原因和边转移情况。",
                "No graph instance snapshot is available yet. In advanced runtime, this panel will sync node execution state, waiting reasons, and edge transitions."
              )}
            </div>
          )}
        </ContextCard>

        <div className="grid gap-3 xl:grid-cols-2">
          <ContextCard
            title={t(locale, "输入附件", "Input attachments")}
            icon={<Paperclip className="size-4" />}
          >
            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="text-sm font-semibold text-stone-900">
                      {attachment.name}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        attachment.excerpt,
                        t(locale, "暂无摘要", "No excerpt"),
                        120
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "这个 workflow 没有输入附件。",
                  "This workflow does not include input attachments."
                )}
              </div>
            )}
          </ContextCard>

          <ContextCard
            title={t(locale, "任务摘要", "Task summary")}
            icon={<Sparkles className="size-4" />}
          >
            <div className="space-y-3">
              {groupedTasks.length > 0 ? (
                groupedTasks.map(([department, items]) => (
                  <div
                    key={department}
                    className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                  >
                    <div className="text-sm font-semibold text-stone-900">
                      {department}
                    </div>
                    <div className="mt-2 space-y-2">
                      {items.slice(0, 3).map(item => (
                        <div
                          key={item.id}
                          className="text-xs leading-6 text-stone-600"
                        >
                          #{item.id} · {item.description}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm leading-6 text-stone-500">
                  {t(
                    locale,
                    "还没有同步到可展示的工作项。",
                    "No work items are available yet."
                  )}
                </div>
              )}

              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                <div className="text-sm font-semibold text-stone-900">
                  {t(locale, "运行证据归口", "Runtime evidence")}
                </div>
                <div className="mt-1 text-xs leading-6 text-stone-500">
                  {t(
                    locale,
                    "产物、日志和 executor 状态已经统一回到首页共享运行证据容器，这里只保留任务工作项摘要。",
                    "Artifacts, logs, and executor state now live in the shared Office home runtime evidence container, so this panel keeps only work-item summaries."
                  )}
                </div>
              </div>
            </div>
          </ContextCard>
        </div>
      </div>
    </div>
  );
}

export function OfficeMemoryReportsPanel({
  workflow,
}: {
  workflow: WorkflowInfo | null;
}) {
  const { locale, copy } = useI18n();
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const agents = useWorkflowStore(state => state.agents);
  const agentMemoryRecent = useWorkflowStore(state => state.agentMemoryRecent);
  const agentMemorySearchResults = useWorkflowStore(
    state => state.agentMemorySearchResults
  );
  const isMemoryLoading = useWorkflowStore(state => state.isMemoryLoading);
  const memoryError = useWorkflowStore(state => state.memoryError);
  const memoryQuery = useWorkflowStore(state => state.memoryQuery);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const heartbeatReports = useWorkflowStore(state => state.heartbeatReports);
  const runningHeartbeatAgentId = useWorkflowStore(
    state => state.runningHeartbeatAgentId
  );
  const fetchAgentRecentMemory = useWorkflowStore(
    state => state.fetchAgentRecentMemory
  );
  const searchAgentMemory = useWorkflowStore(state => state.searchAgentMemory);
  const fetchHeartbeatStatuses = useWorkflowStore(
    state => state.fetchHeartbeatStatuses
  );
  const fetchHeartbeatReports = useWorkflowStore(
    state => state.fetchHeartbeatReports
  );
  const runHeartbeat = useWorkflowStore(state => state.runHeartbeat);
  const downloadHeartbeatReport = useWorkflowStore(
    state => state.downloadHeartbeatReport
  );
  const setSelectedMemoryAgent = useWorkflowStore(
    state => state.setSelectedMemoryAgent
  );
  const setMemoryQuery = useWorkflowStore(state => state.setMemoryQuery);
  const [draft, setDraft] = useState("");

  const officeAgentOptions = useMemo(
    () => selectOfficeAgentOptions({ workflow, agents, locale }),
    [agents, locale, workflow]
  );
  const activeAgentId = useMemo(
    () =>
      selectPrimaryOfficeAgentId({
        workflow,
        agents,
        selectedAgentId: selectedPet,
      }),
    [agents, selectedPet, workflow]
  );
  const activeAgent =
    officeAgentOptions.find(option => option.agent.id === activeAgentId)
      ?.agent ?? null;
  const heartbeatStatus = useMemo(
    () => selectHeartbeatStatusForAgent(heartbeatStatuses, activeAgentId),
    [activeAgentId, heartbeatStatuses]
  );
  const agentReports = useMemo(
    () => selectHeartbeatReportsForAgent(heartbeatReports, activeAgentId, 6),
    [activeAgentId, heartbeatReports]
  );

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }

    setSelectedMemoryAgent(activeAgentId);
    setMemoryQuery("");
    setDraft("");
    void fetchAgentRecentMemory(activeAgentId, workflow?.id, 6);
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(activeAgentId, 6);
  }, [
    activeAgentId,
    fetchAgentRecentMemory,
    fetchHeartbeatReports,
    fetchHeartbeatStatuses,
    setMemoryQuery,
    setSelectedMemoryAgent,
    workflow?.id,
  ]);

  useEffect(() => {
    setDraft(memoryQuery);
  }, [memoryQuery]);

  if (!activeAgentId || !activeAgent) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有可查看的 Agent", "No agent is available yet")}
        description={t(
          locale,
          "点击场景中的 Agent，或等待 workflow 建立组织后，这里会展示记忆和 heartbeat 报告。",
          "Click an agent in the scene or wait for the workflow to establish the team to see memory and heartbeat reports here."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "记忆与报告焦点", "Memory and report focus")}
          icon={<HeartPulse className="size-4" />}
        >
          <div className="flex flex-wrap gap-2">
            {officeAgentOptions.map(option => (
              <button
                key={option.agent.id}
                type="button"
                onClick={() => setSelectedPet(option.agent.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  option.agent.id === activeAgentId
                    ? "border-[#d07a4f] bg-[#d07a4f] text-white"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                )}
              >
                {option.agent.name}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "当前 Agent", "Active agent")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {activeAgent.name}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                Heartbeat
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                  heartbeatTone(heartbeatStatus?.state)
                )}
              >
                {heartbeatStatus?.state || t(locale, "未同步", "Not synced")}
              </div>
            </div>
            <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "最近成功", "Last success")}
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-900">
                {formatDate(locale, heartbeatStatus?.lastSuccessAt || null)}
              </div>
            </div>
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "记忆检索", "Memory search")}
          icon={<Search className="size-4" />}
          action={
            <Button
              type="button"
              className="rounded-full bg-[#d07a4f] text-white hover:bg-[#bf6c43]"
              onClick={() => {
                const query = draft.trim();
                if (!query) return;
                setMemoryQuery(query);
                void searchAgentMemory(activeAgentId, query, 5);
              }}
            >
              <Search className="size-4" />
              {t(locale, "搜索", "Search")}
            </Button>
          }
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const query = draft.trim();
                  if (!query) return;
                  setMemoryQuery(query);
                  void searchAgentMemory(activeAgentId, query, 5);
                }
              }}
              placeholder={t(
                locale,
                "搜索这个 Agent 的记忆、经验和最近判断",
                "Search this agent's memory, experience, and recent reasoning"
              )}
              className="w-full rounded-full border border-stone-200 bg-stone-50/90 py-3 pl-10 pr-4 text-sm text-stone-700 outline-none transition-colors focus:border-stone-300"
            />
          </div>

          {memoryError ? (
            <div className="mt-3 rounded-[18px] border border-rose-200/80 bg-rose-50 px-3 py-3 text-sm leading-6 text-rose-700">
              {memoryError.detail || memoryError.message}
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            {(memoryQuery.trim()
              ? agentMemorySearchResults
              : agentMemoryRecent
            ).map((entry, index) => (
              <div
                key={`${"workflowId" in entry ? entry.workflowId : ""}-${index}`}
                className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
              >
                {"directive" in entry ? (
                  <>
                    <div className="text-sm font-semibold text-stone-900">
                      {entry.directive}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        entry.summary,
                        copy.common.unavailable,
                        140
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-stone-900">
                        {entry.stage || entry.type}
                      </div>
                      {isMemoryLoading ? (
                        <Loader2 className="size-4 animate-spin text-stone-400" />
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {summarizeText(
                        entry.preview || entry.content,
                        copy.common.unavailable,
                        160
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {!isMemoryLoading &&
            (memoryQuery.trim()
              ? agentMemorySearchResults.length === 0
              : agentMemoryRecent.length === 0) ? (
              <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "这个 Agent 暂时没有可展示的记忆记录。",
                  "This agent does not have memory records to show yet."
                )}
              </div>
            ) : null}
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "Heartbeat 报告", "Heartbeat reports")}
          icon={<Sparkles className="size-4" />}
          action={
            <Button
              type="button"
              className="rounded-full bg-[#5E8B72] text-white hover:bg-[#4c775f]"
              disabled={runningHeartbeatAgentId === activeAgentId}
              onClick={() => void runHeartbeat(activeAgentId)}
            >
              {runningHeartbeatAgentId === activeAgentId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <HeartPulse className="size-4" />
              )}
              {t(locale, "立即生成", "Run now")}
            </Button>
          }
        >
          <div className="space-y-2">
            {agentReports.length > 0 ? (
              agentReports.map(report => (
                <div
                  key={report.reportId}
                  className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-stone-900">
                        {report.title}
                      </div>
                      <div className="mt-1 text-xs text-stone-400">
                        {formatDate(locale, report.generatedAt)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="workspace-control rounded-full"
                      onClick={() =>
                        void downloadHeartbeatReport(
                          report.agentId,
                          report.reportId,
                          "md"
                        )
                      }
                    >
                      <Download className="size-4" />
                      MD
                    </Button>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-stone-600">
                    {summarizeText(
                      report.summaryPreview,
                      copy.common.unavailable,
                      150
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
                {t(
                  locale,
                  "还没有 heartbeat 报告，点击上方按钮可以立即生成。",
                  "No heartbeat report is available yet. Use the button above to generate one."
                )}
              </div>
            )}
          </div>
        </ContextCard>
      </div>
    </div>
  );
}

export function OfficeWorkflowHistoryPanel({
  workflow,
  activeWorkflowId,
  onSelectWorkflow,
}: {
  workflow: WorkflowInfo | null;
  activeWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
}) {
  const { locale } = useI18n();
  const workflows = useWorkflowStore(state => state.workflows);
  const workflowsError = useWorkflowStore(state => state.workflowsError);
  const graphInstance = useWorkflowStore(
    state => state.currentWorkflowGraphInstance
  );
  const monitoringInstances = useWorkflowStore(state => state.monitoringInstances);
  const monitoringInstance = useWorkflowStore(
    state => state.currentWorkflowMonitoringInstance
  );
  const monitoringSession = useWorkflowStore(
    state => state.currentWorkflowMonitoringSession
  );
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);
  const fetchWorkflowGraphInstance = useWorkflowStore(
    state => state.fetchWorkflowGraphInstance
  );
  const fetchWorkflowMonitoringInstance = useWorkflowStore(
    state => state.fetchWorkflowMonitoringInstance
  );
  const fetchWorkflowMonitoringSession = useWorkflowStore(
    state => state.fetchWorkflowMonitoringSession
  );
  const terminateWorkflowMonitoringInstance = useWorkflowStore(
    state => state.terminateWorkflowMonitoringInstance
  );
  const [isTerminating, setIsTerminating] = useState(false);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  useEffect(() => {
    if (!workflow?.id) {
      return;
    }

    void fetchWorkflowGraphInstance(workflow.id);
    void fetchWorkflowMonitoringInstance(workflow.id);
    void fetchWorkflowMonitoringSession(workflow.id);
  }, [
    fetchWorkflowGraphInstance,
    fetchWorkflowMonitoringInstance,
    fetchWorkflowMonitoringSession,
    workflow?.id,
  ]);

  const monitoringListItem = useMemo(() => {
    if (!workflow?.id) {
      return null;
    }

    return (
      monitoringInstances.find(item => item.instanceUuid === workflow.id) || null
    );
  }, [monitoringInstances, workflow?.id]);

  const monitoringSummary = useMemo(
    () => summarizeMonitoringInstance(monitoringInstance),
    [monitoringInstance]
  );
  const graphSummary = useMemo(
    () => summarizeGraphInstance(graphInstance),
    [graphInstance]
  );
  const graphNodePreview = useMemo(
    () => graphInstance?.nodeRuns.slice(0, 4) || [],
    [graphInstance]
  );
  const monitoringNodePreview = useMemo(
    () => monitoringInstance?.nodes.slice(0, 4) || [],
    [monitoringInstance]
  );
  const monitoringMessagesPreview = useMemo(
    () => monitoringSession?.messages.slice(-3).reverse() || [],
    [monitoringSession]
  );
  const monitoringProjectionLinks = useMemo(() => {
    if (!monitoringInstance) {
      return [];
    }

    const fallback = t(locale, "未记录", "Not recorded");
    return [
      {
        label: t(locale, "Workflow", "Workflow"),
        value: presentMonitoringLink(
          monitoringInstance.links.workflowId,
          workflow?.id || fallback
        ),
      },
      {
        label: t(locale, "Mission", "Mission"),
        value: presentMonitoringLink(
          monitoringInstance.links.missionId,
          workflow?.missionId || fallback
        ),
      },
      {
        label: t(locale, "Session", "Session"),
        value: presentMonitoringLink(
          monitoringInstance.links.sessionId,
          monitoringSession?.sessionId || fallback
        ),
      },
      {
        label: t(locale, "Replay", "Replay"),
        value: presentMonitoringLink(monitoringInstance.links.replayId, fallback),
      },
      {
        label: t(locale, "Audit", "Audit"),
        value: presentMonitoringLink(monitoringInstance.links.auditId, fallback),
      },
    ];
  }, [
    locale,
    monitoringInstance,
    monitoringSession?.sessionId,
    workflow?.id,
    workflow?.missionId,
  ]);

  async function handleTerminateMonitoringInstance() {
    if (!workflow?.id || isTerminating) {
      return;
    }

    setIsTerminating(true);
    try {
      await terminateWorkflowMonitoringInstance(
        workflow.id,
        "office-history-compatibility-panel"
      );
      await fetchWorkflowMonitoringInstance(workflow.id);
      await fetchWorkflowMonitoringSession(workflow.id);
    } finally {
      setIsTerminating(false);
    }
  }

  if (workflows.length === 0 && !workflowsError) {
    return (
      <OfficeTabEmptyState
        title={t(locale, "还没有历史记录", "No workflow history yet")}
        description={t(
          locale,
          "历史 tab 会保留 workflow 连续性摘要，后续也可以继续兼容旧的 session 视图。",
          "The history tab keeps workflow continuity visible and stays compatible with the legacy session view."
        )}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-3">
        <ContextCard
          title={t(locale, "历史与兼容摘要", "History and compatibility")}
          icon={<FileClock className="size-4" />}
        >
          <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3 text-sm leading-6 text-stone-600">
            {t(
              locale,
              "办公室驾驶舱负责当前运行态与高频上下文，/tasks 仍保留全屏深链，旧 workflow panel 继续承担兼容入口与 session 历史。",
              "The office cockpit owns the active runtime and high-frequency context, while /tasks stays as the fullscreen deep-link page and the legacy workflow panel remains the compatibility entry for session history."
            )}
          </div>
        </ContextCard>

        <ContextCard
          title={t(locale, "web-aigc 兼容监控", "web-aigc compatibility monitor")}
          icon={<Bot className="size-4" />}
          action={
            workflow ? (
              <Button
                type="button"
                className="rounded-full bg-[#c65d38] text-white hover:bg-[#ad502f]"
                disabled={isTerminating || !monitoringInstance}
                onClick={() => void handleTerminateMonitoringInstance()}
              >
                {isTerminating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CircleAlert className="size-4" />
                )}
                {t(locale, "强制终止", "Terminate")}
              </Button>
            ) : null
          }
        >
          {!workflow ? (
            <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
              {t(
                locale,
                "先选择一个 workflow，这里会显示 web-aigc 编排实例摘要、节点执行和最近会话消息。",
                "Select a workflow to view the web-aigc orchestration summary, node execution, and recent session messages."
              )}
            </div>
          ) : monitoringInstance ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "执行状态", "Execution status")}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        monitoringStatusTone(monitoringInstance.status)
                      )}
                    >
                      {monitoringStatusLabel(locale, monitoringInstance.status)}
                    </span>
                    <span className="text-xs text-stone-500">
                      {monitoringInstance.executor ||
                        t(locale, "未记录执行器", "Unknown executor")}
                    </span>
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "编排信息", "Orchestration")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-stone-900">
                    {monitoringInstance.orchestrationCode}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-stone-500">
                    {monitoringInstance.orchestrationName}
                    {typeof monitoringInstance.orchestrationVersion === "number"
                      ? ` · v${monitoringInstance.orchestrationVersion}`
                      : ""}
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "节点概览", "Node summary")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
                    <span>{t(locale, "总数", "Total")}: {monitoringSummary.total}</span>
                    <span>{t(locale, "执行中", "Executing")}: {monitoringSummary.executing}</span>
                    <span>{t(locale, "已完成", "Executed")}: {monitoringSummary.executed}</span>
                    <span>{t(locale, "待执行", "Pending")}: {monitoringSummary.pending}</span>
                    <span>{t(locale, "异常", "Exception")}: {monitoringSummary.exception}</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "时间轴", "Timeline")}
                  </div>
                  <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
                    <div>
                      {t(locale, "开始时间", "Started")}:{" "}
                      {formatDate(locale, monitoringInstance.startTime)}
                    </div>
                    <div>
                      {t(locale, "最近更新", "Last updated")}:{" "}
                      {formatDate(locale, monitoringInstance.lastUpdateTime)}
                    </div>
                    <div>
                      {t(locale, "结束时间", "Finished")}:{" "}
                      {formatDate(locale, monitoringInstance.endTime)}
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "兼容映射", "Compatibility mapping")}
                  </div>
                  <div className="mt-2 space-y-1 text-sm leading-6 text-stone-600">
                    <div>
                      {t(locale, "实例标识", "Instance")}:{" "}
                      {monitoringListItem?.instanceUuid || workflow.id}
                    </div>
                    <div>
                      {t(locale, "来源应用", "Source app")}:{" "}
                      {monitoringInstance.sourceApp ||
                        monitoringListItem?.sourceApp ||
                        t(locale, "未记录", "Not recorded")}
                    </div>
                    <div>
                      {t(locale, "分类", "Category")}:{" "}
                      {monitoringInstance.category ||
                        monitoringListItem?.category ||
                        t(locale, "未分类", "Uncategorized")}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                  {t(locale, "投影链路", "Projection links")}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {monitoringProjectionLinks.map(link => (
                    <div
                      key={link.label}
                      className="rounded-[16px] border border-stone-200/80 bg-white/85 px-3 py-3"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                        {link.label}
                      </div>
                      <div className="mt-1 break-all text-sm font-semibold text-stone-900">
                        {link.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-900">
                      {t(locale, "节点执行快照", "Node execution snapshot")}
                    </div>
                    <div className="text-xs text-stone-400">
                      {t(locale, "展示前 4 个节点", "Showing first 4 nodes")}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {monitoringNodePreview.length > 0 ? (
                      monitoringNodePreview.map(node => (
                        <div
                          key={node.nodeId}
                          className="rounded-[16px] border border-stone-200/80 bg-white/80 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-stone-900">
                                {node.nodeLabel}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-stone-500">
                                {node.nodeType}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                                monitoringStatusTone(node.status)
                              )}
                            >
                              {monitoringStatusLabel(locale, node.status)}
                            </span>
                          </div>
                          <div className="mt-2 text-xs leading-5 text-stone-500">
                            {t(locale, "开始", "Started")}:{" "}
                            {formatDate(locale, node.startTime)}
                            {" · "}
                            {t(locale, "结束", "Finished")}:{" "}
                            {formatDate(locale, node.endTime)}
                          </div>
                          {node.errorMessage ? (
                            <div className="mt-2 text-xs leading-5 text-rose-700">
                              {node.errorMessage}
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[16px] border border-dashed border-stone-300 bg-white/70 px-3 py-3 text-sm leading-6 text-stone-500">
                        {t(
                          locale,
                          "当前没有可展示的节点执行数据。",
                          "No node execution data is available yet."
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-900">
                      {t(locale, "最近会话消息", "Recent session messages")}
                    </div>
                    <div className="text-xs text-stone-400">
                      {monitoringSession?.sessionId
                        ? `${t(locale, "会话", "Session")}: ${monitoringSession.sessionId}`
                        : t(locale, "未关联会话", "No session linked")}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {monitoringMessagesPreview.length > 0 ? (
                      monitoringMessagesPreview.map(message => (
                        <div
                          key={message.id}
                          className="rounded-[16px] border border-stone-200/80 bg-white/80 px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-stone-500">
                              {message.role}
                            </div>
                            <div className="text-[11px] text-stone-400">
                              {formatDate(locale, message.timestamp)}
                            </div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-stone-600">
                            {summarizeSessionMessage(message, locale)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[16px] border border-dashed border-stone-300 bg-white/70 px-3 py-3 text-sm leading-6 text-stone-500">
                        {t(
                          locale,
                          "当前还没有可预览的 session 消息。",
                          "No session messages are available yet."
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
              {t(
                locale,
                "当前 workflow 还没有映射到 web-aigc 兼容监控实例，或兼容接口尚未返回数据。",
                "This workflow is not mapped to a web-aigc compatibility instance yet, or the compatibility API has not returned data."
              )}
            </div>
          )}
        </ContextCard>

        <ContextCard
          title={t(
            locale,
            "Graph runtime compatibility",
            "Graph runtime compatibility"
          )}
          icon={<Sparkles className="size-4" />}
        >
          {!workflow ? (
            <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
              {t(
                locale,
                "Select a workflow to view the graph runtime snapshot, waiting state, and node preview.",
                "Select a workflow to view the graph runtime snapshot, waiting state, and node preview."
              )}
            </div>
          ) : graphInstance ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "Runtime status", "Runtime status")}
                  </div>
                  <div className="mt-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        graphRuntimeTone(graphInstance.status)
                      )}
                    >
                      {graphRuntimeLabel(locale, graphInstance.status)}
                    </span>
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "Total nodes", "Total nodes")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-stone-900">
                    {graphSummary.total}
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "Edge transitions", "Edge transitions")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-stone-900">
                    {graphInstance.edgeTransitions.length}
                  </div>
                </div>

                <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {t(locale, "Compatibility summary", "Compatibility summary")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
                    <span>
                      {t(locale, "Executing", "Executing")}: {graphSummary.executing}
                    </span>
                    <span>
                      {t(locale, "Executed", "Executed")}: {graphSummary.executed}
                    </span>
                    <span>
                      {t(locale, "Waiting", "Waiting")}: {graphSummary.waiting}
                    </span>
                    <span>
                      {t(locale, "Exception", "Exception")}: {graphSummary.exception}
                    </span>
                  </div>
                </div>
              </div>

              {graphInstance.telemetry.waitingFor ? (
                <div className="rounded-[18px] border border-amber-200/80 bg-amber-50/80 px-3 py-3 text-sm leading-6 text-amber-800">
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="font-semibold">
                        {t(locale, "Currently waiting", "Currently waiting")}
                      </div>
                      <div>{graphInstance.telemetry.waitingFor}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[18px] border border-stone-200/80 bg-stone-50/80 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-stone-900">
                    {t(locale, "Graph node preview", "Graph node preview")}
                  </div>
                  <div className="text-xs text-stone-400">
                    {t(locale, "Showing first 4 nodes", "Showing first 4 nodes")}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {graphNodePreview.length > 0 ? (
                    graphNodePreview.map(node => (
                      <div
                        key={node.nodeId}
                        className="rounded-[16px] border border-stone-200/80 bg-white/80 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-stone-900">
                              {node.title}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-stone-500">
                              {[node.departmentLabel, node.role, node.stageKey]
                                .filter(Boolean)
                                .join(" / ") ||
                                t(locale, "Unlabeled", "Unlabeled")}
                            </div>
                          </div>
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                              graphRuntimeTone(node.status)
                            )}
                          >
                            {graphRuntimeLabel(locale, node.status)}
                          </span>
                        </div>
                        {node.outputPreview ? (
                          <div className="mt-2 text-xs leading-5 text-stone-500">
                            {summarizeText(
                              node.outputPreview,
                              t(locale, "No output summary", "No output summary"),
                              140
                            )}
                          </div>
                        ) : null}
                        {node.error ? (
                          <div className="mt-2 text-xs leading-5 text-rose-700">
                            {node.error}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-stone-300 bg-white/70 px-3 py-3 text-sm leading-6 text-stone-500">
                      {t(
                        locale,
                        "No graph runtime nodes are available yet.",
                        "No graph runtime nodes are available yet."
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-3 py-3 text-sm leading-6 text-stone-500">
              {t(
                locale,
                "No graph runtime snapshot is available for the current workflow yet.",
                "No graph runtime snapshot is available for the current workflow yet."
              )}
            </div>
          )}
        </ContextCard>

        {workflowsError ? (
          <ContextCard
            title={t(locale, "历史加载失败", "History load failed")}
            icon={<Bot className="size-4" />}
          >
            <div className="text-sm leading-6 text-rose-700">
              {workflowsError.detail || workflowsError.message}
            </div>
          </ContextCard>
        ) : null}

        <ContextCard
          title={t(locale, "最近 workflow", "Recent workflows")}
          icon={<Layers3 className="size-4" />}
          action={
            <Button
              type="button"
              variant="outline"
              className="workspace-control rounded-full"
              onClick={() => void fetchWorkflows()}
            >
              {t(locale, "刷新", "Refresh")}
            </Button>
          }
        >
          <div className="space-y-2">
            {workflows.map(workflow => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onSelectWorkflow(workflow.id)}
                className={cn(
                  "w-full rounded-[20px] border px-3.5 py-3 text-left transition-colors",
                  workflow.id === activeWorkflowId
                    ? "border-[#d07a4f]/40 bg-[linear-gradient(180deg,rgba(255,248,234,0.98),rgba(255,241,220,0.94))]"
                    : "border-stone-200/80 bg-stone-50/70 hover:bg-stone-50"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold text-stone-900">
                      {workflow.directive}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-stone-500">
                      {workflow.missionId
                        ? `${t(locale, "Mission", "Mission")}: ${workflow.missionId}`
                        : t(
                            locale,
                            "等待 mission 关联",
                            "Waiting for mission link"
                          )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        workflowStatusTone(workflow.status)
                      )}
                    >
                      {workflowStatusLabel(locale, workflow.status)}
                    </span>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {formatDate(locale, workflow.created_at)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ContextCard>
      </div>
    </div>
  );
}
