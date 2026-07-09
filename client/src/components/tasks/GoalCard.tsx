import { cn } from "@/lib/utils";
import type { TaskAutopilotSummary, MissionTaskDetail } from "@/lib/tasks-store";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Status icon mapping ─── */

const STATUS_ICONS: Record<GoalItemStatus, { icon: string; className: string }> = {
  completed: { icon: "✓", className: "text-emerald-500" },
  in_progress: { icon: "●", className: "text-blue-500 animate-pulse" },
  pending: { icon: "○", className: "text-muted-foreground" },
};

/* ─── Types ─── */

export type GoalItemStatus = "completed" | "in_progress" | "pending";

export interface GoalItem {
  label: string;
  status: GoalItemStatus;
  progress?: number; // 0-100, optional
}

export interface GoalCardProps {
  title: string;                       // i18n: "目标" / "Goals"
  goals: GoalItem[];
  overallProgress: number;             // 0-100
  locale: string;
}

/* ─── Data mapping helper ─── */

/**
 * Build GoalCard data from autopilotSummary and selectedDetail.
 *
 * Priority:
 * 1. `destination.subGoals` (if array and non-empty)
 * 2. `destination.successCriteria` (if array and non-empty)
 * 3. Fallback: `selectedDetail.summary` or `selectedDetail.title` as a single goal
 */
export function buildGoalCardData(
  autopilotSummary: TaskAutopilotSummary | null | undefined,
  selectedDetail: Pick<MissionTaskDetail, "summary" | "title" | "progress"> | null | undefined,
  locale: string,
): Pick<GoalCardProps, "title" | "goals" | "overallProgress"> {
  const title = t(locale, "目标", "Goals");

  // Try subGoals first
  const subGoals = autopilotSummary?.destination?.subGoals;
  if (Array.isArray(subGoals) && subGoals.length > 0) {
    const goals: GoalItem[] = subGoals.map((sg) => {
      const status = mapSubGoalStatus(sg.status);
      return {
        label: sg.title || sg.id,
        status,
        progress: status === "completed" ? 100 : status === "in_progress" ? 50 : 0,
      };
    });
    const completedCount = goals.filter((g) => g.status === "completed").length;
    const overallProgress = goals.length > 0
      ? Math.round((completedCount / goals.length) * 100)
      : 0;
    return { title, goals, overallProgress };
  }

  // Try successCriteria
  const successCriteria = autopilotSummary?.destination?.successCriteria;
  if (Array.isArray(successCriteria) && successCriteria.length > 0) {
    const goals: GoalItem[] = successCriteria.map((criterion) => ({
      label: criterion,
      status: "pending" as const,
    }));
    return { title, goals, overallProgress: 0 };
  }

  // Fallback: use selectedDetail summary or title
  if (selectedDetail) {
    const fallbackLabel = selectedDetail.summary || selectedDetail.title;
    if (fallbackLabel) {
      return {
        title,
        goals: [{ label: fallbackLabel, status: "pending" as const }],
        overallProgress: selectedDetail.progress ?? 0,
      };
    }
  }

  return { title, goals: [], overallProgress: 0 };
}

function mapSubGoalStatus(
  status: string | null | undefined,
): GoalItemStatus {
  switch (status) {
    case "done":
    case "completed":
      return "completed";
    case "running":
    case "in_progress":
      return "in_progress";
    default:
      return "pending";
  }
}

/* ─── Component ─── */

export function GoalCard({
  title,
  goals,
  overallProgress,
  locale,
}: GoalCardProps): React.ReactElement {
  const clampedProgress = Math.max(0, Math.min(100, overallProgress));

  return (
    <div
      className={cn(
        "bg-card text-card-foreground border rounded-lg p-4",
        "flex flex-col gap-3",
      )}
    >
      {/* Card title */}
      <h4 className="text-sm font-semibold">{title}</h4>

      {/* Goal list or empty state */}
      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {t(locale, "暂无目标数据", "No goals available")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {goals.map((goal, index) => {
            const { icon, className: iconClassName } = STATUS_ICONS[goal.status];
            return (
              <li key={index} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("flex-shrink-0 text-base leading-none", iconClassName)}>
                    {icon}
                  </span>
                  <span className="truncate">{goal.label}</span>
                </div>
                {typeof goal.progress === "number" && (
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {Math.max(0, Math.min(100, goal.progress))}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Overall progress bar */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">
            {t(locale, "整体进度", "Overall Progress")}
          </span>
          <span className="text-xs text-muted-foreground">
            {clampedProgress}%
          </span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
