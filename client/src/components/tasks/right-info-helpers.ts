import type {
  MissionTaskDetail,
  TaskAutopilotSummary,
  TaskTimelineEvent,
} from "@/lib/tasks-store";

/* ------------------------------------------------------------------ */
/*  i18n helper                                                        */
/* ------------------------------------------------------------------ */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ------------------------------------------------------------------ */
/*  SubMetric type                                                     */
/* ------------------------------------------------------------------ */

export interface SubMetric {
  label: string;
  /** 0-100 */
  value: number;
}

/* ------------------------------------------------------------------ */
/*  formatDuration                                                     */
/* ------------------------------------------------------------------ */

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * - >= 24h  → "Xd Yh"
 * - >= 1h   → "Xh Ym"
 * - >= 1m   → "Xm Ys"
 * - < 1m    → "Xs"
 *
 * Returns "—" for invalid input (NaN, negative, non-finite).
 */
export function formatDuration(ms: number, _locale?: string): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/* ------------------------------------------------------------------ */
/*  formatRelativeTime                                                 */
/* ------------------------------------------------------------------ */

/**
 * Format a timestamp (ms since epoch) as a relative time string.
 *
 * Returns "—" for invalid timestamps (NaN, 0, negative, non-finite).
 */
export function formatRelativeTime(
  timestamp: number,
  locale: string = "en-US",
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";

  const diff = Date.now() - timestamp;
  if (diff < 0) return "—";

  const minutes = Math.max(1, Math.round(diff / 60_000));

  if (minutes < 60) {
    return t(locale, `${minutes}分钟前`, `${minutes}m ago`);
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return t(locale, `${hours}小时前`, `${hours}h ago`);
  }

  const days = Math.round(hours / 24);
  return t(locale, `${days}天前`, `${days}d ago`);
}

/* ------------------------------------------------------------------ */
/*  deriveSubMetrics                                                   */
/* ------------------------------------------------------------------ */

/**
 * Derive sub-metrics from autopilot route stages, detail stages, or
 * a fallback completedTaskCount / taskCount ratio.
 *
 * Priority:
 *   1. autopilot.route.stages  (up to 4)
 *   2. detail.stages           (up to 4)
 *   3. single "Tasks Done" metric from completedTaskCount / taskCount
 */
export function deriveSubMetrics(
  detail: MissionTaskDetail,
  autopilot?: TaskAutopilotSummary,
  locale: string = "en-US",
): SubMetric[] {
  // Priority 1: autopilot route stages
  const routeStages = autopilot?.route?.stages;
  if (routeStages && routeStages.length > 0) {
    return routeStages.slice(0, 4).map(stage => ({
      label: stage.label || stage.key,
      value: stage.status === "done" ? 100 : stage.status === "running" ? 50 : 0,
    }));
  }

  // Priority 2: detail stages
  if (detail.stages && detail.stages.length > 0) {
    return detail.stages.slice(0, 4).map(stage => ({
      label: stage.label,
      value: stage.progress,
    }));
  }

  // Priority 3: fallback to single metric
  const total = detail.taskCount || 1;
  const completed = detail.completedTaskCount || 0;
  return [
    {
      label: t(locale, "任务完成", "Tasks Done"),
      value: Math.round((completed / total) * 100),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  dotColorClass                                                      */
/* ------------------------------------------------------------------ */

const DOT_COLOR_MAP: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-amber-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
};

const DOT_COLOR_DEFAULT = "bg-[var(--muted-foreground)]";

/**
 * Map a timeline event level to a dot color CSS class.
 *
 * Known levels: info → blue, success → green, warning/warn → amber, error → red.
 * Unknown levels fall back to muted-foreground gray.
 */
export function dotColorClass(level: string): string {
  return DOT_COLOR_MAP[level] ?? DOT_COLOR_DEFAULT;
}

/* ------------------------------------------------------------------ */
/*  prepareTimelineEvents                                              */
/* ------------------------------------------------------------------ */

/**
 * Sort timeline events by `time` descending (newest first) and truncate
 * to `maxCount` entries.
 *
 * Returns a new array — the input is not mutated.
 */
export function prepareTimelineEvents(
  events: TaskTimelineEvent[],
  maxCount: number,
): TaskTimelineEvent[] {
  return [...events]
    .sort((a, b) => b.time - a.time)
    .slice(0, maxCount);
}
