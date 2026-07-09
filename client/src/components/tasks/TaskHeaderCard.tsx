import { cn } from "@/lib/utils";
import type { MissionTaskStatus } from "@/lib/tasks-store";
import type { MissionAutopilotDriveState } from "@shared/mission/autopilot";
import { Clock, Flag } from "lucide-react";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Status badge color mapping ─── */

export const STATUS_BADGE_CLASSES: Record<MissionTaskStatus, string> = {
  running: "bg-emerald-100 text-emerald-700",
  waiting: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  done: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-500",
  queued: "bg-sky-100 text-sky-700",
};

/* ─── Status label mapping ─── */

const STATUS_LABELS: Record<MissionTaskStatus, { zh: string; en: string }> = {
  running: { zh: "运行中", en: "Running" },
  waiting: { zh: "等待中", en: "Waiting" },
  failed: { zh: "失败", en: "Failed" },
  done: { zh: "已完成", en: "Done" },
  cancelled: { zh: "已取消", en: "Cancelled" },
  queued: { zh: "排队中", en: "Queued" },
};

/* ─── Props ─── */

export interface TaskHeaderCardProps {
  title: string;
  description: string | null;
  status: MissionTaskStatus;
  progress: number; // 0-100
  estimatedDuration: string | null; // e.g. "30min", "2h"
  priority: string | null; // e.g. "high", "medium", "low"
  driveState: MissionAutopilotDriveState | null;
  locale: string;
}

/* ─── Component ─── */

export function TaskHeaderCard({
  title,
  description,
  status,
  progress,
  estimatedDuration,
  priority,
  driveState,
  locale,
}: TaskHeaderCardProps): React.ReactElement {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const badgeClasses = STATUS_BADGE_CLASSES[status] ?? "bg-slate-100 text-slate-600";
  const statusLabel = STATUS_LABELS[status]
    ? t(locale, STATUS_LABELS[status].zh, STATUS_LABELS[status].en)
    : status;

  return (
    <div
      className={cn(
        "bg-card text-card-foreground border rounded-lg p-4",
        "flex flex-col gap-3"
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-semibold truncate">
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {estimatedDuration && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              <Clock size={12} />
              {estimatedDuration}
            </span>
          )}
          {priority && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              <Flag size={12} />
              {priority}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {description}
        </p>
      )}

      {/* Status badge + drive state */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
            badgeClasses
          )}
        >
          {statusLabel}
        </span>
        {driveState && (
          <span className="text-xs text-muted-foreground">
            {driveState}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">
            {t(locale, "进度", "Progress")}
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
