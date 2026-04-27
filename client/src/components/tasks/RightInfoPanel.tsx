import { Component, useState, type ReactNode } from "react";
import { Clock, Target, Timer, User, ChevronDown, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  MissionTaskDetail,
  TaskAutopilotSummary,
  TaskTimelineEvent,
} from "@/lib/tasks-store";
import {
  formatDuration,
  formatRelativeTime,
  deriveSubMetrics,
  dotColorClass,
  prepareTimelineEvents,
  type SubMetric,
} from "./right-info-helpers";

/* ------------------------------------------------------------------ */
/*  i18n helper                                                        */
/* ------------------------------------------------------------------ */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_TIMELINE_DISPLAY = 10;

/* ------------------------------------------------------------------ */
/*  SectionErrorBoundary                                               */
/* ------------------------------------------------------------------ */

interface SectionErrorBoundaryProps {
  children: ReactNode;
  locale: string;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 text-center text-[11px] text-[var(--muted-foreground)]"
          data-testid="section-error"
        >
          {t(this.props.locale, "此区域加载失败", "Failed to load this section")}
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  MetaRow                                                            */
/* ------------------------------------------------------------------ */

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[var(--muted-foreground)]">{icon}</span>
      <span className="text-[10px] text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className="ml-auto text-[11px] font-medium text-[var(--card-foreground)] font-mono tabular-nums">
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TaskOverviewSection                                                */
/* ------------------------------------------------------------------ */

interface TaskOverviewSectionProps {
  detail: MissionTaskDetail;
  autopilot?: TaskAutopilotSummary;
  locale: string;
}

function TaskOverviewSection({
  detail,
  autopilot,
  locale,
}: TaskOverviewSectionProps) {
  const createdTime = detail.createdAt
    ? formatRelativeTime(detail.createdAt, locale)
    : "—";

  const estimatedCompletion = autopilot?.route?.estimatedDuration
    ? autopilot.route.estimatedDuration
    : "—";

  const elapsed =
    detail.createdAt && detail.createdAt > 0
      ? formatDuration(Date.now() - detail.createdAt, locale)
      : "—";

  const creator =
    autopilot?.destination?.taskType || detail.kind || "—";

  const tags = detail.departmentLabels ?? [];

  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm"
      data-testid="task-overview-section"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        {t(locale, "任务概览", "Task Overview")}
      </h3>
      <div className="mt-2 space-y-2">
        <MetaRow
          icon={<Clock size={12} />}
          label={t(locale, "创建时间", "Created")}
          value={createdTime}
        />
        <MetaRow
          icon={<Target size={12} />}
          label={t(locale, "预估完成", "Est. Completion")}
          value={estimatedCompletion}
        />
        <MetaRow
          icon={<Timer size={12} />}
          label={t(locale, "已用时间", "Elapsed")}
          value={elapsed}
        />
        <MetaRow
          icon={<User size={12} />}
          label={t(locale, "创建者", "Creator")}
          value={creator}
        />
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px] text-[var(--secondary-foreground)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  ProgressRing                                                       */
/* ------------------------------------------------------------------ */

function ProgressRing({
  value,
  size = 80,
  strokeWidth = 6,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      className="rotate-[-90deg]"
      data-testid="progress-ring"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  SubMetricItem                                                      */
/* ------------------------------------------------------------------ */

function SubMetricItem({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <div className="h-1.5 flex-1 rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] font-medium font-mono tabular-nums text-[var(--card-foreground)]">
          {value}%
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LiveProgressSection                                                */
/* ------------------------------------------------------------------ */

interface LiveProgressSectionProps {
  detail: MissionTaskDetail;
  autopilot?: TaskAutopilotSummary;
  locale: string;
}

function LiveProgressSection({
  detail,
  autopilot,
  locale,
}: LiveProgressSectionProps) {
  const subMetrics: SubMetric[] = deriveSubMetrics(detail, autopilot, locale);
  const clamped = Math.min(Math.max(detail.progress, 0), 100);

  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm"
      data-testid="live-progress-section"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        {t(locale, "实时进展", "Live Progress")}
      </h3>
      <div className="mt-3 flex items-center gap-4">
        <div className="relative">
          <ProgressRing value={detail.progress} />
          <span className="absolute inset-0 flex items-center justify-center text-[18px] font-bold font-mono tabular-nums text-[var(--card-foreground)]">
            {clamped}%
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {subMetrics.map((metric) => (
            <SubMetricItem
              key={metric.label}
              label={metric.label}
              value={metric.value}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  ActivityTimelineItem                                               */
/* ------------------------------------------------------------------ */

function ActivityTimelineItem({
  event,
  locale,
  isLast,
}: {
  event: TaskTimelineEvent;
  locale: string;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-2.5 py-1.5">
      {/* Timeline axis */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "size-2 shrink-0 rounded-full",
            dotColorClass(event.level)
          )}
        />
        {!isLast && <div className="mt-1 w-px flex-1 bg-[var(--border)]" />}
      </div>
      {/* Content */}
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-[var(--card-foreground)]">
            {event.title}
          </span>
          <span className="shrink-0 text-[9px] font-mono tabular-nums text-[var(--muted-foreground)]">
            {formatRelativeTime(event.time, locale)}
          </span>
        </div>
        {event.description && (
          <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--muted-foreground)]">
            {event.description}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RecentActivitySection                                              */
/* ------------------------------------------------------------------ */

interface RecentActivitySectionProps {
  timeline: TaskTimelineEvent[];
  locale: string;
}

function RecentActivitySection({
  timeline,
  locale,
}: RecentActivitySectionProps) {
  const [showAll, setShowAll] = useState(false);

  const sorted = prepareTimelineEvents(timeline, timeline.length);
  const displayedEvents = showAll
    ? sorted
    : sorted.slice(0, MAX_TIMELINE_DISPLAY);

  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm"
      data-testid="recent-activity-section"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        {t(locale, "近期动态", "Recent Activity")}
      </h3>
      {sorted.length > 0 ? (
        <div className="mt-2 space-y-0">
          {displayedEvents.map((event, index) => (
            <ActivityTimelineItem
              key={event.id}
              event={event}
              locale={locale}
              isLast={index === displayedEvents.length - 1}
            />
          ))}
          {sorted.length > MAX_TIMELINE_DISPLAY && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded py-1 text-[10px] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
              data-testid="view-all-button"
            >
              <ChevronDown size={12} />
              {t(locale, "查看全部", "View all")} ({sorted.length})
            </button>
          )}
        </div>
      ) : (
        <div
          className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]"
          data-testid="empty-timeline"
        >
          {t(locale, "暂无动态", "No activity yet")}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  RightInfoPanel (exported)                                          */
/* ------------------------------------------------------------------ */

export interface RightInfoPanelProps {
  detail: MissionTaskDetail | null;
  autopilotSummary?: TaskAutopilotSummary;
  locale: string;
  onExpandDetail?: () => void;
  className?: string;
}

export function RightInfoPanel({
  detail,
  autopilotSummary,
  locale,
  onExpandDetail,
  className,
}: RightInfoPanelProps) {
  return (
    <div
      className={cn("flex min-h-0 flex-col overflow-y-auto", className)}
      style={{
        minWidth: "300px",
        maxWidth: "360px",
        scrollbarGutter: "stable",
        backgroundColor: "var(--background)",
      }}
      data-testid="right-info-panel"
    >
      {detail ? (
        <div className="space-y-3 p-3">
          <SectionErrorBoundary locale={locale}>
            <TaskOverviewSection
              detail={detail}
              autopilot={autopilotSummary}
              locale={locale}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary locale={locale}>
            <LiveProgressSection
              detail={detail}
              autopilot={autopilotSummary}
              locale={locale}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary locale={locale}>
            <RecentActivitySection
              timeline={detail.timeline ?? []}
              locale={locale}
            />
          </SectionErrorBoundary>
          {onExpandDetail && (
            <button
              onClick={onExpandDetail}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] py-2 text-[11px] font-medium text-[var(--card-foreground)] hover:bg-[var(--secondary)]"
              data-testid="expand-detail-button"
            >
              {t(locale, "查看完整详情", "View full details")}
            </button>
          )}
        </div>
      ) : (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
          data-testid="empty-state"
        >
          <Inbox size={32} className="text-[var(--muted-foreground)]" />
          <span className="text-[12px] text-[var(--muted-foreground)]">
            {t(
              locale,
              "选择一个任务查看详情",
              "Select a task to view details"
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Re-exports for testing                                             */
/* ------------------------------------------------------------------ */

export {
  TaskOverviewSection,
  LiveProgressSection,
  RecentActivitySection,
  ProgressRing,
  SubMetricItem,
  MetaRow,
  ActivityTimelineItem,
  SectionErrorBoundary,
  MAX_TIMELINE_DISPLAY,
};
export type {
  TaskOverviewSectionProps,
  LiveProgressSectionProps,
  RecentActivitySectionProps,
};
