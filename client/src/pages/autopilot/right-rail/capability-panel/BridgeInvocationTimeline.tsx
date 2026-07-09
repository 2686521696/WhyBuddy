/**
 * 能力 Bridge 调用时间线组件
 *
 * 垂直时间线展示所有调用记录，左侧 1px 连接线，
 * 使用 framer-motion AnimatePresence 管理条目进入/退出动画。
 * 并行调用并排展示，已完成旧记录折叠为摘要行。
 *
 * 对应 spec：`.kiro/specs/autopilot-capability-bridge-runtime-panel/`
 * - 需求 1.5, 2.1, 2.2, 2.3
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, type FC } from "react";

import type { AppLocale } from "@/lib/locale";

import { BridgeInvocationCard } from "./BridgeInvocationCard";
import type { BridgeInvocation } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BridgeInvocationTimelineProps {
  /** 全部调用记录 */
  invocations: BridgeInvocation[];
  /** 当前语言环境 */
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 折叠阈值：超过此数量的已完成记录将被折叠 */
const COLLAPSE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// 动画配置
// ---------------------------------------------------------------------------

/**
 * 获取条目动画变体。
 *
 * 当 `prefers-reduced-motion` 启用时，所有 duration 设为 0，
 * 保留状态切换但跳过视觉过渡。
 */
function getItemVariants(reduceMotion: boolean) {
  const enterDuration = reduceMotion ? 0 : 0.2;
  const exitDuration = reduceMotion ? 0 : 0.15;
  return {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0, transition: { duration: enterDuration } },
    exit: { opacity: 0, height: 0, transition: { duration: exitDuration } },
  };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 按 stageIndex 分组，相同 stageIndex 的调用视为并行。
 */
function groupByStage(
  invocations: BridgeInvocation[]
): { stageIndex: number; items: BridgeInvocation[] }[] {
  const map = new Map<number, BridgeInvocation[]>();
  for (const inv of invocations) {
    const group = map.get(inv.stageIndex);
    if (group) {
      group.push(inv);
    } else {
      map.set(inv.stageIndex, [inv]);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([stageIndex, items]) => ({ stageIndex, items }));
}

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

/**
 * 能力 Bridge 调用时间线。
 *
 * - 垂直时间线，左侧 1px 连接线
 * - 并行调用并排展示（flex-row gap-1）
 * - 已完成旧记录折叠为摘要行
 */
export const BridgeInvocationTimeline: FC<BridgeInvocationTimelineProps> = ({
  invocations,
  locale,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const itemVariants = useMemo(
    () => getItemVariants(!!shouldReduceMotion),
    [shouldReduceMotion]
  );

  // 分离活跃和已完成记录
  const { activeGroups, collapsedCount } = useMemo(() => {
    const completed = invocations.filter(
      (inv) => inv.status === "completed" || inv.status === "failed"
    );
    const active = invocations.filter(
      (inv) =>
        inv.status === "pending" ||
        inv.status === "running" ||
        inv.status === "retrying"
    );

    // 已完成记录超过阈值时折叠旧的
    let visibleCompleted = completed;
    let collapsed = 0;
    if (completed.length > COLLAPSE_THRESHOLD) {
      collapsed = completed.length - COLLAPSE_THRESHOLD;
      visibleCompleted = completed.slice(-COLLAPSE_THRESHOLD);
    }

    const allVisible = [...visibleCompleted, ...active].sort(
      (a, b) => a.stageIndex - b.stageIndex
    );

    return {
      activeGroups: groupByStage(allVisible),
      collapsedCount: collapsed,
    };
  }, [invocations]);

  if (invocations.length === 0) {
    return null;
  }

  return (
    <div className="relative pl-3">
      {/* 左侧连接线 */}
      <div className="absolute left-1 top-1 bottom-1 w-px bg-white/[0.12]" />

      {/* 折叠摘要行 */}
      {collapsedCount > 0 && (
        <div className="relative flex items-center gap-1 py-1 pl-2">
          {/* 连接点 */}
          <div className="absolute left-[-8px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/30" />
          <span className="text-[10px] text-white/40 font-mono">
            {locale === "zh-CN"
              ? `… 已折叠 ${collapsedCount} 条记录`
              : `… ${collapsedCount} collapsed`}
          </span>
        </div>
      )}

      {/* 时间线条目 */}
      <AnimatePresence initial={false}>
        {activeGroups.map((group) => (
          <motion.div
            key={`stage-${group.stageIndex}`}
            variants={itemVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative"
          >
            {/* 连接点 */}
            <div className="absolute left-[-8px] top-3 w-1.5 h-1.5 rounded-full bg-white/30" />

            {/* 并行调用并排展示 */}
            {group.items.length === 1 ? (
              <BridgeInvocationCard invocation={group.items[0]} compact />
            ) : (
              <div className="flex flex-row gap-1 flex-wrap">
                {group.items.map((inv) => (
                  <div key={inv.id} className="flex-1 min-w-0">
                    <BridgeInvocationCard invocation={inv} compact />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
