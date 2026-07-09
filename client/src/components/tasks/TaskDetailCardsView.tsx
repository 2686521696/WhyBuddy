import { cn } from "@/lib/utils";
import type { MissionTaskDetail, TaskAutopilotSummary } from "@/lib/tasks-store";
import type { MissionOperatorActionType } from "@shared/mission/contracts";

import { TaskHeaderCard } from "./TaskHeaderCard";
import { GoalCard, buildGoalCardData } from "./GoalCard";
import { RouteCard, buildRouteCardData } from "./RouteCard";
import { FleetCard, buildFleetCardData } from "./FleetCard";
import { TakeoverCard } from "./TakeoverCard";
import { CommandInputBar } from "./CommandInputBar";
import { CardErrorBoundary } from "./CardErrorBoundary";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Props ─── */

export interface TaskDetailCardsViewProps {
  taskId: string;
  detail: MissionTaskDetail;
  autopilotSummary: TaskAutopilotSummary | null;
  locale: string;
  onSubmitOperatorAction: (payload: {
    action: MissionOperatorActionType;
    reason?: string;
  }) => Promise<void>;
  onLaunchDecision: (presetId: string) => Promise<void>;
  onSetDecisionNote: (taskId: string, note: string) => void;
  decisionNote: string;
  operatorActionLoading: boolean;
}

/* ─── Data mapping helpers ─── */

function buildHeaderProps(
  detail: MissionTaskDetail,
  autopilotSummary: TaskAutopilotSummary | null | undefined,
) {
  return {
    title: detail.title,
    description: detail.summary || detail.sourceText || null,
    status: detail.status,
    progress: detail.progress,
    estimatedDuration:
      autopilotSummary?.route?.selected?.estimatedDuration ?? null,
    priority: null as string | null,
    driveState: autopilotSummary?.driveState?.state ?? null,
  };
}

function buildTakeoverProps(
  detail: MissionTaskDetail,
  autopilotSummary: TaskAutopilotSummary | null | undefined,
  locale: string,
) {
  const hasPendingDecision =
    detail.decision != null ||
    detail.decisionPresets.length > 0 ||
    Boolean(detail.decisionPrompt);

  return {
    title: t(locale, "接管/证据", "Takeover/Evidence"),
    hasPendingDecision,
    decisionPrompt: detail.decisionPrompt,
    decisionPresets: detail.decisionPresets.map((p) => ({
      id: p.id,
      label: p.label,
    })),
    takeoverSummary: autopilotSummary?.takeover?.reason ?? null,
  };
}

/* ─── Component ─── */

export function TaskDetailCardsView({
  taskId,
  detail,
  autopilotSummary,
  locale,
  onSubmitOperatorAction,
  onLaunchDecision,
  onSetDecisionNote,
  decisionNote,
  operatorActionLoading,
}: TaskDetailCardsViewProps): React.ReactElement {
  // Build data for each card
  const headerProps = buildHeaderProps(detail, autopilotSummary);
  const goalData = buildGoalCardData(autopilotSummary, detail, locale);
  const routeData = buildRouteCardData(autopilotSummary, detail, locale);
  const fleetData = buildFleetCardData(autopilotSummary, detail, locale);
  const takeoverData = buildTakeoverProps(detail, autopilotSummary, locale);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border border-white/45 bg-white/38",
        "shadow-[0_12px_28px_rgba(15,23,42,0.06)] backdrop-blur-md",
        "[&_.bg-card]:bg-white/58 [&_.bg-muted]:bg-white/46 [&_.rounded-lg]:rounded-[12px]",
        "[&_.border]:border-white/45 [&_.p-4]:p-3"
      )}
      data-visual-role="cockpit-auxiliary-detail"
    >
      {/* Header card - does not scroll */}
      <div className="px-3 pt-3">
        <CardErrorBoundary locale={locale} cardName="Header">
          <TaskHeaderCard
            {...headerProps}
            locale={locale}
          />
        </CardErrorBoundary>
      </div>

      {/* Scrollable cards area */}
      <div className="flex-1 overflow-y-auto space-y-2.5 px-3 py-2.5">
        <CardErrorBoundary locale={locale} cardName="Goal">
          <GoalCard
            title={goalData.title}
            goals={goalData.goals}
            overallProgress={goalData.overallProgress}
            locale={locale}
          />
        </CardErrorBoundary>

        <CardErrorBoundary locale={locale} cardName="Route">
          <RouteCard
            title={routeData.title}
            steps={routeData.steps}
            currentStepIndex={routeData.currentStepIndex}
            locale={locale}
          />
        </CardErrorBoundary>

        <CardErrorBoundary locale={locale} cardName="Fleet">
          <FleetCard
            title={fleetData.title}
            members={fleetData.members}
            locale={locale}
          />
        </CardErrorBoundary>

        <CardErrorBoundary locale={locale} cardName="Takeover">
          <TakeoverCard
            title={takeoverData.title}
            hasPendingDecision={takeoverData.hasPendingDecision}
            decisionPrompt={takeoverData.decisionPrompt}
            decisionPresets={takeoverData.decisionPresets}
            decisionNote={decisionNote}
            onSetDecisionNote={(note) => onSetDecisionNote(taskId, note)}
            onLaunchDecision={onLaunchDecision}
            onSubmitOperatorAction={onSubmitOperatorAction}
            operatorActionLoading={operatorActionLoading}
            takeoverSummary={takeoverData.takeoverSummary}
            locale={locale}
          />
        </CardErrorBoundary>
      </div>

      {/* Bottom command input bar - does not scroll */}
      <div
        className={cn(
          "border-t border-white/45 bg-white/58 px-3 py-2 backdrop-blur",
          "[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0",
          "[&_input]:!h-8 [&_input]:!rounded-[10px] [&_input]:!border-white/55 [&_input]:!bg-white/70 [&_input]:!py-1.5 [&_input]:!text-xs [&_input]:focus:!ring-ring/40 [&_input]:focus:!ring-offset-0",
          "[&_button]:!h-8 [&_button]:!w-8 [&_button]:!rounded-[10px]"
        )}
        data-visual-role="cockpit-auxiliary-command"
      >
        <CommandInputBar taskId={taskId} locale={locale} />
      </div>
    </div>
  );
}
