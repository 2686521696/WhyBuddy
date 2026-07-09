import { useEffect, useRef } from "react";
import { FolderKanban, LoaderCircle, Search } from "lucide-react";

import { RetryInlineNotice } from "@/components/tasks/RetryInlineNotice";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { workspaceStatusClass } from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import type { MissionTaskSummary } from "@/lib/tasks-store";
import { localizeTaskHubBriefText } from "@/lib/task-hub-copy";
import { cn } from "@/lib/utils";

import {
  formatTaskRelative,
  missionStatusTone,
} from "./task-helpers";

export interface TasksQueueProjectMeta {
  projectName: string | null;
  routeTitle: string | null;
  specTitle: string | null;
  sourceLabel: string;
}

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function taskStatusLabel(
  status: MissionTaskSummary["status"],
  locale: string
) {
  const zh: Record<MissionTaskSummary["status"], string> = {
    queued: "排队中",
    running: "执行中",
    waiting: "等待中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  const en: Record<MissionTaskSummary["status"], string> = {
    queued: "Queued",
    running: "Running",
    waiting: "Waiting",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return locale === "zh-CN" ? zh[status] : en[status];
}

export function TasksQueueRail({
  tasks,
  totalCount,
  activeTaskId,
  highlightedTaskId,
  loading,
  ready,
  error,
  search,
  onSearchChange,
  onSelectTask,
  onRefresh,
  density = "regular",
  projectMetaByTaskId,
  className,
}: {
  tasks: MissionTaskSummary[];
  totalCount: number;
  activeTaskId: string | null;
  highlightedTaskId?: string | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectTask: (taskId: string) => void;
  onRefresh: () => void;
  density?: "regular" | "compact";
  projectMetaByTaskId?: Record<string, TasksQueueProjectMeta>;
  className?: string;
}) {
  const { locale } = useI18n();
  const taskButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const isCompact = density === "compact";
  const runningCount = tasks.filter(task => task.status === "running").length;
  const waitingCount = tasks.filter(task => task.status === "waiting").length;

  useEffect(() => {
    if (!highlightedTaskId) {
      return;
    }

    const button = taskButtonRefs.current.get(highlightedTaskId);
    if (button) {
      button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedTaskId, tasks]);

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col overflow-hidden border transition-all",
        isCompact
          ? "workspace-panel rounded-[14px] border-white/45 bg-white/42 shadow-[0_10px_24px_rgba(15,23,42,0.06)] hover:bg-white/58"
          : "rounded-[24px] border-slate-200/80 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.06)]",
        className
      )}
      data-density={density}
      data-visual-role="cockpit-queue-rail"
    >
      <div
        className={cn(
          "shrink-0 border-b",
          isCompact
            ? "border-stone-200/80 px-2.5 py-2.5"
            : "border-slate-200/80 px-4 py-4"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div
              className={cn(
                "font-semibold text-slate-950",
                isCompact ? "text-[11px]" : "text-base"
              )}
            >
              {t(locale, "任务列表", "Task List")}
            </div>
            <div
              className={cn(
                "mt-1 font-medium text-slate-500",
                isCompact ? "text-[10px]" : "text-xs"
              )}
            >
              {t(
                locale,
                `${tasks.length} 条可见 / 共 ${totalCount} 条`,
                `${tasks.length} visible / ${totalCount} total`
              )}
            </div>
          </div>
          {loading && !ready ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-slate-500" />
          ) : null}
        </div>

        <div className={cn("relative", isCompact ? "mt-2" : "mt-3")}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={t(
              locale,
              "搜索标题、阶段、信号或部门...",
              "Search titles, stages, signals, departments..."
            )}
            className={cn(
              "border-slate-200 bg-slate-50/90 pl-9 text-slate-700 shadow-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-sky-100",
              isCompact
                ? "h-8 rounded-full text-[11px]"
                : "h-10 rounded-[14px] text-xs"
            )}
          />
        </div>

        {!isCompact ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {t(locale, `全部 ${tasks.length}`, `All ${tasks.length}`)}
            </span>
            <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
              {t(
                locale,
                `执行中 ${runningCount}`,
                `Running ${runningCount}`
              )}
            </span>
            <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              {t(
                locale,
                `等待 ${waitingCount}`,
                `Waiting ${waitingCount}`
              )}
            </span>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
          isCompact ? "px-2.5 pb-2" : "px-3 pb-3"
        )}
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div
          className={cn(
            isCompact ? "space-y-1.5 pt-1.5" : "space-y-2 pt-2.5"
          )}
        >
          {error ? (
            <RetryInlineNotice
              title={t(locale, "加载失败", "Failed to load")}
              description={error}
              actionLabel={t(locale, "刷新", "Refresh")}
              onRetry={onRefresh}
            />
          ) : null}

          {!error && tasks.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50/80 p-6 text-center text-slate-500">
              <FolderKanban className="size-5 mb-2 opacity-50" />
              <div className="text-xs font-medium">
                {t(locale, "当前没有任务", "No tasks yet")}
              </div>
            </div>
          ) : null}

          <TooltipProvider delayDuration={300}>
            {tasks.map(task => {
              const active = task.id === activeTaskId;
              const summary = localizeTaskHubBriefText(
                task.summary || task.sourceText,
                locale
              );
              const projectMeta = projectMetaByTaskId?.[task.id] ?? null;
              const projectMetaItems = projectMeta
                ? [
                    projectMeta.projectName
                      ? t(
                          locale,
                          `项目 ${projectMeta.projectName}`,
                          `Project ${projectMeta.projectName}`
                        )
                      : t(locale, "未归档", "Unassigned"),
                    projectMeta.routeTitle
                      ? t(
                          locale,
                          `路线 ${projectMeta.routeTitle}`,
                          `Route ${projectMeta.routeTitle}`
                        )
                      : null,
                    projectMeta.specTitle
                      ? t(
                          locale,
                          `Spec ${projectMeta.specTitle}`,
                          `Spec ${projectMeta.specTitle}`
                        )
                      : null,
                    projectMeta.sourceLabel,
                  ].filter((item): item is string => Boolean(item))
                : [];

              return (
                <button
                  key={task.id}
                  type="button"
                  ref={node => {
                    if (node) {
                      taskButtonRefs.current.set(task.id, node);
                      return;
                    }
                    taskButtonRefs.current.delete(task.id);
                  }}
                  className={cn(
                    "relative w-full overflow-hidden border text-left transition-all flex flex-col gap-2",
                    isCompact
                      ? "rounded-[10px] px-2.5 py-1.5"
                      : "rounded-[16px] px-3 py-3",
                    active
                      ? isCompact
                        ? "border-primary/25 bg-white/62 shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                        : "border-sky-200 bg-sky-50/70 shadow-[0_12px_26px_rgba(14,165,233,0.12)]"
                      : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50/80",
                    task.id === highlightedTaskId &&
                      "ring-2 ring-amber-300 ring-offset-2 ring-offset-background"
                  )}
                  onClick={() => onSelectTask(task.id)}
                >
                  {active && !isCompact ? (
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-sky-500" />
                  ) : null}
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span
                      className={cn(
                        "shrink-0 workspace-status !gap-0.5 font-semibold",
                        isCompact
                          ? "!px-1 !py-0.5 !text-[8px]"
                          : "!px-2 !py-1 !text-[10px]",
                        missionStatusTone(task.status)
                      )}
                    >
                      {taskStatusLabel(task.status, locale)}
                    </span>
                    <span
                      className={cn(
                        "max-w-[74px] shrink-0 truncate text-right font-data font-medium text-slate-400",
                        isCompact ? "text-[8px]" : "text-[10px]"
                      )}
                    >
                      {formatTaskRelative(task.updatedAt, locale)}
                    </span>
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "w-full overflow-hidden text-ellipsis whitespace-nowrap block text-left font-semibold text-slate-900",
                          isCompact ? "text-[10px]" : "text-[13px]"
                        )}
                      >
                        {task.title}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start" className="max-w-[260px] text-xs z-[100] ml-2 break-words">
                      {task.title}
                    </TooltipContent>
                  </Tooltip>

                  {!isCompact ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "w-full overflow-hidden text-ellipsis whitespace-nowrap block text-left font-medium text-slate-500",
                            "text-[11px]"
                          )}
                        >
                          {summary}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" align="start" className="max-w-[260px] text-xs z-[100] ml-2 break-words">
                        {summary}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}

                  {projectMetaItems.length > 0 ? (
                    <div
                      className={cn(
                        "flex w-full min-w-0 flex-wrap gap-1",
                        isCompact && "hidden"
                      )}
                      data-testid={`task-project-meta-${task.id}`}
                    >
                      {projectMetaItems.slice(0, 4).map(item => (
                        <span
                          key={item}
                          className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500"
                          title={item}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {isCompact ? (
                    <div className="flex w-full items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200/80">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            task.hasWarnings
                              ? "bg-[linear-gradient(90deg,#d39b50,#c98257)]"
                              : active
                                ? "bg-[linear-gradient(90deg,#c98257,#b86f45)]"
                                : "bg-[linear-gradient(90deg,#7ea38d,#5e8b72)]"
                          )}
                          style={{ width: `${Math.max(4, task.progress)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[8px] font-semibold text-stone-600">
                        {task.progress}%
                      </span>
                    </div>
                  ) : null}

                  {!isCompact ? (
                    <div className="flex w-full min-w-0 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            task.hasWarnings ? "bg-amber-500" : "bg-sky-500"
                          )}
                          style={{ width: `${Math.max(4, task.progress)}%` }}
                        />
                      </div>
                      <span className="shrink-0 font-data text-[10px] font-semibold text-slate-500">
                        {task.progress}%
                      </span>
                      <span
                        className={workspaceStatusClass(
                          "neutral",
                          "!gap-0.5 !px-1.5 !py-0.5 !text-[9px] font-medium"
                        )}
                      >
                        {t(
                          locale,
                          `${task.taskCount} 个子任务`,
                          `${task.taskCount} tasks`
                        )}
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    </aside>
  );
}
