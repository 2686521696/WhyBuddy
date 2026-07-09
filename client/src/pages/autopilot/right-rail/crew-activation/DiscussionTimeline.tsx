/**
 * 讨论时间线组件。
 *
 * 垂直时间线布局，左侧角色圆点 + 连接线。
 * 每条记录显示角色名、内容摘要、时间戳。
 * decision 类型条目使用 `bg-emerald-50 border-l-2 border-emerald-400` 高亮。
 * 阶段完成时自动折叠讨论记录，折叠态显示摘要行。
 *
 * 对应 `.kiro/specs/autopilot-agent-crew-stage-activation` Task 3.1, 3.2。
 * 需求: 3.1, 3.2, 3.3
 */

import { useState, useMemo } from "react";

import type { AppLocale } from "@/lib/locale";

import type { DiscussionEntry } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiscussionTimelineProps {
  /** 讨论条目列表 */
  discussions: DiscussionEntry[];
  /** 当前语言 */
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 格式化时间戳为 HH:mm 格式 */
function formatTimestamp(ts: number, locale: AppLocale): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

/** 按 stageIndex 分组讨论条目 */
function groupByStage(discussions: DiscussionEntry[]): Map<number, DiscussionEntry[]> {
  const map = new Map<number, DiscussionEntry[]>();
  for (const entry of discussions) {
    const group = map.get(entry.stageIndex) ?? [];
    group.push(entry);
    map.set(entry.stageIndex, group);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 子组件：单条讨论条目
// ---------------------------------------------------------------------------

function DiscussionTimelineEntry({
  entry,
  locale,
  isLast,
}: {
  entry: DiscussionEntry;
  locale: AppLocale;
  isLast: boolean;
}) {
  const isDecision = entry.type === "decision";

  return (
    <div className="flex gap-2 min-h-0">
      {/* 左侧：圆点 + 连接线 */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div
          className={`w-1.5 h-1.5 rounded-full mt-1 ${
            isDecision ? "bg-emerald-400" : "bg-white/30"
          }`}
        />
        {!isLast && <div className="w-px flex-1 bg-white/[0.12] mt-0.5" />}
      </div>

      {/* 右侧：内容 */}
      <div
        className={`flex-1 min-w-0 pb-2 ${
          isDecision
            ? "bg-emerald-500/10 border-l-2 border-emerald-400 pl-2 rounded-r"
            : ""
        }`}
      >
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] font-medium text-white/70 truncate">
            {entry.roleName}
          </span>
          <span className="text-[10px] text-white/35 flex-shrink-0">
            {formatTimestamp(entry.timestamp, locale)}
          </span>
        </div>
        <p className="text-[11px] font-normal text-white/60 leading-snug mt-0.5 line-clamp-2">
          {entry.content}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：阶段折叠组
// ---------------------------------------------------------------------------

function StageGroup({
  stageIndex,
  entries,
  locale,
  isCurrentStage,
}: {
  stageIndex: number;
  entries: DiscussionEntry[];
  locale: AppLocale;
  /** 是否为当前活跃阶段（不自动折叠） */
  isCurrentStage: boolean;
}) {
  // 非当前阶段默认折叠
  const [expanded, setExpanded] = useState(isCurrentStage);

  const decisionCount = useMemo(
    () => entries.filter((e) => e.type === "decision").length,
    [entries]
  );

  const summaryText = useMemo(() => {
    const discussionCount = entries.length;
    if (locale === "zh-CN") {
      return `${discussionCount} 条讨论 · ${decisionCount} 个决策`;
    }
    return `${discussionCount} discussion${discussionCount !== 1 ? "s" : ""} · ${decisionCount} decision${decisionCount !== 1 ? "s" : ""}`;
  }, [entries.length, decisionCount, locale]);

  // 当前阶段始终展开
  if (isCurrentStage) {
    return (
      <div className="space-y-0">
        {entries.map((entry, idx) => (
          <DiscussionTimelineEntry
            key={entry.id}
            entry={entry}
            locale={locale}
            isLast={idx === entries.length - 1}
          />
        ))}
      </div>
    );
  }

  // 已完成阶段：可折叠
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 transition-colors py-0.5 w-full text-left"
        aria-expanded={expanded}
      >
        <span className="text-[9px]">{expanded ? "▾" : "▸"}</span>
        <span className="font-medium">
          {locale === "zh-CN" ? `阶段 ${stageIndex + 1}` : `Stage ${stageIndex + 1}`}
        </span>
        {!expanded && (
          <span className="text-white/35 ml-1">{summaryText}</span>
        )}
      </button>

      {expanded && (
        <div className="space-y-0 mt-1">
          {entries.map((entry, idx) => (
            <DiscussionTimelineEntry
              key={entry.id}
              entry={entry}
              locale={locale}
              isLast={idx === entries.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * 讨论时间线。
 *
 * 垂直时间线布局，按阶段分组，已完成阶段自动折叠。
 */
export function DiscussionTimeline({ discussions, locale }: DiscussionTimelineProps) {
  if (!discussions || discussions.length === 0) return null;

  const stageGroups = useMemo(() => groupByStage(discussions), [discussions]);

  // 当前阶段为最大 stageIndex
  const currentStageIndex = useMemo(() => {
    let max = 0;
    for (const entry of discussions) {
      if (entry.stageIndex > max) max = entry.stageIndex;
    }
    return max;
  }, [discussions]);

  const sortedStages = useMemo(
    () => Array.from(stageGroups.entries()).sort(([a], [b]) => a - b),
    [stageGroups]
  );

  return (
    <div className="flex flex-col gap-1">
      {sortedStages.map(([stageIdx, entries]) => (
        <StageGroup
          key={stageIdx}
          stageIndex={stageIdx}
          entries={entries}
          locale={locale}
          isCurrentStage={stageIdx === currentStageIndex}
        />
      ))}
    </div>
  );
}
