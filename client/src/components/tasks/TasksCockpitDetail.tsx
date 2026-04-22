import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRightCircle,
  Sparkles,
  UserRound,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
  workspaceToneClass,
} from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import { localizeTaskHubBriefText } from "@/lib/task-hub-copy";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
} from "@/lib/tasks-store";
import type { MissionOperatorActionType } from "@shared/mission/contracts";
import { cn } from "@/lib/utils";

import { StatusPillStack } from "./StatusPillStack";
import { TaskDetailView } from "./TaskDetailView";
import {
  compactText,
  deriveCurrentOwner,
  deriveNextStep,
  derivePrimaryActions,
  deriveTaskBlocker,
  formatTaskRelative,
  missionOperatorStateLabel,
  missionOperatorStateTone,
  missionStatusLabel,
  missionStatusTone,
  taskInsightToneClasses,
  type TaskInsightSummary,
} from "./task-helpers";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function InsightCard({
  item,
  icon,
}: {
  item: TaskInsightSummary;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        "workspace-callout h-full min-w-0 rounded-[12px] px-2 py-1.5",
        taskInsightToneClasses(item.tone)
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[8px] font-semibold uppercase tracking-[0.16em] opacity-75">
            {item.label}
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] font-semibold">
            {item.title}
          </div>
        </div>
        <div className="shrink-0 opacity-70">{icon}</div>
      </div>
      <div className="mt-1 line-clamp-3 text-[10px] leading-4">
        {item.detail}
      </div>
      {item.meta ? (
        <div className="mt-1 line-clamp-2 text-[9px] leading-3 opacity-75">
          {item.meta}
        </div>
      ) : null}
    </div>
  );
}

function DashboardMetric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "h-full min-w-0 rounded-[11px] border px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]",
        workspaceToneClass(tone)
      )}
    >
      <div className="text-[8px] font-semibold uppercase tracking-[0.14em] opacity-75">
        {label}
      </div>
      <div className="mt-1 truncate text-[11px] font-semibold">{value}</div>
      <div className="mt-0.5 line-clamp-2 text-[9px] leading-4 opacity-80">
        {hint}
      </div>
    </div>
  );
}

function ProgressiveItem({
  value,
  title,
  description,
  meta,
  children,
}: {
  value: string;
  title: string;
  description: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="overflow-hidden rounded-[14px] border border-stone-200/80 bg-white/72 px-2"
    >
      <AccordionTrigger className="py-1.5 text-left hover:no-underline">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-stone-900">{title}</div>
          <div className="mt-0.5 text-[10px] leading-4 text-stone-500">
            {description}
            {meta ? ` / ${meta}` : ""}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-1.5">{children}</AccordionContent>
    </AccordionItem>
  );
}

export function TasksCockpitDetail({
  detail,
  decisionNote,
  onDecisionNoteChange,
  onLaunchDecision,
  launchingPresetId,
  onSubmitOperatorAction,
  operatorActionLoading,
  onDecisionSubmitted,
  className,
}: {
  detail: MissionTaskDetail | null;
  decisionNote: string;
  onDecisionNoteChange: (next: string) => void;
  onLaunchDecision: (presetId: string) => void | Promise<void>;
  launchingPresetId?: string | null;
  onSubmitOperatorAction?: (payload: {
    action: MissionOperatorActionType;
    reason?: string;
  }) => void | Promise<void>;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onDecisionSubmitted?: () => void;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  useEffect(() => {
    setExpandedSections([]);
  }, [detail?.id]);

  if (!detail) {
    return (
      <TaskDetailView
        detail={detail}
        decisionNote={decisionNote}
        onDecisionNoteChange={onDecisionNoteChange}
        onLaunchDecision={onLaunchDecision}
        launchingPresetId={launchingPresetId}
        onSubmitOperatorAction={onSubmitOperatorAction}
        operatorActionLoading={operatorActionLoading}
        onDecisionSubmitted={onDecisionSubmitted}
        variant="cockpit"
        className={className}
      />
    );
  }

  const summaryText = compactText(
    localizeTaskHubBriefText(detail.summary || detail.sourceText, locale),
    220
  );
  const primaryActions = derivePrimaryActions(detail, locale);
  const owner = deriveCurrentOwner(detail, locale);
  const blocker = deriveTaskBlocker(detail, locale);
  const nextStep = deriveNextStep(detail, locale);

  const statusItems = [
    {
      key: "mission-status",
      label: missionStatusLabel(detail.status, locale),
      className: missionStatusTone(detail.status),
    },
    {
      key: "operator-status",
      label: missionOperatorStateLabel(detail.operatorState, locale),
      className: missionOperatorStateTone(detail.operatorState),
    },
    {
      key: "kind",
      label: detail.kind,
      className: "workspace-tone-neutral bg-white/75 font-medium",
    },
  ];

  const dashboardMetrics: Array<{
    key: string;
    label: string;
    value: string;
    hint: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
  }> = [
    {
      key: "updated",
      label: copy.tasks.hero.updated,
      value: formatTaskRelative(detail.updatedAt, locale),
      hint:
        compactText(
          detail.currentStageLabel ||
            t(locale, "工作区保持同步", "Workspace in sync"),
          46
        ) || t(locale, "工作区保持同步", "Workspace in sync"),
      tone:
        detail.status === "failed"
          ? "danger"
          : detail.status === "done"
            ? "success"
            : "info",
    },
    {
      key: "attempt",
      label: t(locale, "执行轮次", "Attempt"),
      value: `#${detail.attempt}`,
      hint: `${missionStatusLabel(detail.status, locale)} / ${missionOperatorStateLabel(detail.operatorState, locale)}`,
      tone:
        detail.operatorState === "blocked"
          ? "warning"
          : detail.operatorState === "paused"
            ? "info"
            : "neutral",
    },
  ];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div className="space-y-1.5 pb-2">
          <section className="sticky top-0 z-10 overflow-hidden rounded-[16px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,252,248,0.96),rgba(247,239,229,0.92))] px-2.5 py-2.5 shadow-[0_12px_24px_rgba(99,73,45,0.08)] backdrop-blur">
            <div className="space-y-2">
              <div className="min-w-0">
                <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "任务驾驶舱", "Task cockpit")}
                </div>
                <StatusPillStack items={statusItems} className="mt-1 gap-1" />
                {detail.departmentLabels.length > 0 ? (
                  <StatusPillStack
                    items={detail.departmentLabels.map(label => ({
                      key: `department-${label}`,
                      label,
                      className: "workspace-tone-neutral bg-white/65 font-medium",
                    }))}
                    className="mt-0.5 gap-1"
                  />
                ) : null}
                <h2 className="mt-1 text-[13px] font-semibold tracking-tight text-stone-900">
                  {detail.title}
                </h2>
              </div>

              <div className="rounded-[13px] border border-white/80 bg-white/76 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                <div className="line-clamp-3 text-[10px] leading-5 text-stone-700">
                  {summaryText || copy.tasks.detailView.noDetail}
                </div>
              </div>

              <div className="grid grid-cols-2 auto-rows-fr gap-1.5">
                {dashboardMetrics.map(metric => (
                  <DashboardMetric
                    key={metric.key}
                    label={metric.label}
                    value={metric.value}
                    hint={metric.hint}
                    tone={metric.tone}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 auto-rows-fr gap-1.5 sm:grid-cols-3">
            <InsightCard item={owner} icon={<UserRound className="size-4" />} />
            <InsightCard
              item={blocker}
              icon={<AlertTriangle className="size-4" />}
            />
            <InsightCard
              item={nextStep}
              icon={<ArrowRightCircle className="size-4" />}
            />
          </section>

          <section className="rounded-[14px] border border-stone-200/80 bg-white/82 px-2.5 py-2.5 shadow-[0_10px_22px_rgba(99,73,45,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "操作建议", "Action guidance")}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-stone-600">
                  {t(
                    locale,
                    "首屏任务控制已经收敛到底部 dock，这里保留推荐原因和判断依据。",
                    "First-screen task controls now live in the bottom dock. This card keeps the rationale and guidance."
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {primaryActions.recommended.map(action => (
                  <span
                    key={action.key}
                    className={workspaceStatusClass(
                      action.tone === "primary"
                        ? "success"
                        : action.tone === "danger"
                          ? "danger"
                          : "info",
                      "!gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                    )}
                  >
                    {action.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-1.5 space-y-1.5">
              {primaryActions.recommended.length > 0 ? (
                <div
                  className={cn(
                    workspaceCalloutClass(
                      detail.status === "failed" ? "danger" : "success"
                    ),
                    "px-2 py-1.5 text-[10px]"
                  )}
                >
                  <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.14em]">
                    <Sparkles className="size-4" />
                    {copy.tasks.hero.recommended}
                  </div>
                  <div className="mt-1 space-y-1">
                    {primaryActions.recommended.map(action => (
                      <div
                        key={`${action.key}-description`}
                        className="rounded-[10px] border border-white/45 bg-white/35 px-1.5 py-1"
                      >
                        <span
                          className={workspaceStatusClass(
                            action.tone === "primary"
                              ? "success"
                              : action.tone === "danger"
                                ? "danger"
                                : "info",
                            "!gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold"
                          )}
                        >
                          {action.label}
                        </span>
                        <div className="mt-0.5 line-clamp-3 text-[10px] leading-4">
                          {action.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : primaryActions.passiveMessage ? (
                <div
                  className={cn(
                    workspaceCalloutClass("neutral"),
                    "border-dashed px-2 py-1.5 text-[10px] leading-4 text-[var(--workspace-text-muted)]"
                  )}
                >
                  {primaryActions.passiveMessage}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[14px] border border-stone-200/80 bg-white/82 px-2.5 py-2.5 shadow-[0_10px_22px_rgba(99,73,45,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t(locale, "深层工作区", "Deep workspace")}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-stone-600">
                  {t(
                    locale,
                    "这里保留决策、工作包、成本和安全等深层详情，运行证据统一回到底部折叠区。",
                    "This layer keeps decisions, work packages, cost, and security detail, while runtime evidence moves to the folded dock."
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1 text-[9px] text-stone-500">
                <span className="rounded-full border border-stone-200/80 bg-stone-50/80 px-1 py-0.5 font-medium">
                  {detail.tasks.length} {t(locale, "工作包", "packages")}
                </span>
                <span className="rounded-full border border-stone-200/80 bg-stone-50/80 px-1 py-0.5 font-medium">
                  {detail.decisionHistory.length} {t(locale, "决策", "decisions")}
                </span>
              </div>
            </div>

            <Accordion
              type="multiple"
              value={expandedSections}
              onValueChange={values => setExpandedSections(values as string[])}
              className="mt-1 space-y-1"
            >
              <ProgressiveItem
                value="detail"
                title={t(locale, "完整详情工作区", "Full detail workspace")}
                description={t(
                  locale,
                  "这里保留原有决策、工作包、成本和安全细节；运行证据主入口已经统一后置到折叠区 tabs。",
                  "Keep the original decision, work-package, cost, and security detail here while runtime evidence now lives in the folded dock tabs."
                )}
                meta={t(locale, "完整保留", "Preserved")}
              >
                <TaskDetailView
                  detail={detail}
                  decisionNote={decisionNote}
                  onDecisionNoteChange={onDecisionNoteChange}
                  onLaunchDecision={onLaunchDecision}
                  launchingPresetId={launchingPresetId}
                  onSubmitOperatorAction={onSubmitOperatorAction}
                  operatorActionLoading={operatorActionLoading}
                  onDecisionSubmitted={onDecisionSubmitted}
                  variant="cockpit"
                  autoHeight
                  deferRuntimeEvidence
                  className="pt-1"
                />
              </ProgressiveItem>
            </Accordion>
          </section>
        </div>
      </div>
    </div>
  );
}
