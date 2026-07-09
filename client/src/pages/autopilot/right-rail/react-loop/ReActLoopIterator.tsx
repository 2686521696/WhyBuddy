/**
 * ReAct 循环迭代器组件。
 *
 * 对应 `.kiro/specs/autopilot-llm-react-loop-inline` Task 4.1。
 *
 * 渲染多个 ReActLoop，每个 loop 包含多个 ReActPhaseBlock。
 * 循环之间用虚线分隔（border-t border-dashed border-slate-200 my-2）。
 * 超过 3 次循环时折叠中间循环，显示"展开 N 个循环"按钮。
 *
 * Task 5.3 自动滚动：使用 scrollIntoView 在 loops.length 变化时
 * 自动滚动到最新条目，仅在用户未手动滚动时触发。
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";

import type { AppLocale } from "@/lib/locale";

import { ReActPhaseBlock } from "./ReActPhaseBlock";
import type { ReActLoop } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReActLoopIteratorProps {
  /** 所有已解析的 ReAct 循环 */
  loops: ReActLoop[];
  /** 应用语言（预留，当前默认中文） */
  locale?: AppLocale;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 超过此数量的循环将折叠中间部分 */
const COLLAPSE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * ReAct 循环迭代器。
 *
 * 将多个 ReActLoop 渲染为带虚线分隔的阶段块列表。
 * 当循环数 > 3 时，折叠中间循环并提供展开按钮。
 * 内置自动滚动逻辑：当 loops.length 变化且用户未手动滚动时，
 * 自动滚动到最新条目。
 */
export const ReActLoopIterator: FC<ReActLoopIteratorProps> = ({
  loops,
  locale,
}) => {
  const [expanded, setExpanded] = useState(false);

  // --- 自动滚动逻辑（Task 5.3） ---
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  /**
   * 检测用户是否手动滚动。
   * 如果滚动位置不在底部附近（容差 40px），标记为用户已手动滚动。
   */
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRef.current = !atBottom;
  }, []);

  /**
   * 当 loops.length 变化且用户未手动滚动时，自动滚动到底部。
   */
  useEffect(() => {
    if (!userScrolledRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [loops.length]);

  // --- 折叠逻辑 ---
  const shouldCollapse = !expanded && loops.length > COLLAPSE_THRESHOLD;
  const collapsedCount = shouldCollapse ? loops.length - 2 : 0;

  /** 获取要渲染的循环列表 */
  const visibleLoops = shouldCollapse
    ? [loops[0], ...loops.slice(-1)]
    : loops;

  if (loops.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-0"
      onScroll={handleScroll}
    >
      {shouldCollapse ? (
        <>
          {/* 第一个循环 */}
          <LoopSection loop={visibleLoops[0]} locale={locale} />

          {/* 折叠提示 */}
          <div className="border-t border-dashed border-slate-200 my-2" />
          <button
            type="button"
            className="text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer py-1 self-start"
            onClick={() => setExpanded(true)}
          >
            展开 {collapsedCount} 个循环
          </button>
          <div className="border-t border-dashed border-slate-200 my-2" />

          {/* 最后一个循环 */}
          <LoopSection loop={visibleLoops[1]} locale={locale} />
        </>
      ) : (
        loops.map((loop, idx) => (
          <div key={loop.index}>
            {idx > 0 && (
              <div className="border-t border-dashed border-slate-200 my-2" />
            )}
            <LoopSection loop={loop} locale={locale} />
          </div>
        ))
      )}

      {/* 自动滚动锚点 */}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// 子组件：单个循环区块
// ---------------------------------------------------------------------------

interface LoopSectionProps {
  loop: ReActLoop;
  locale?: AppLocale;
}

/**
 * 渲染单个 ReActLoop 中的所有 ReActPhaseBlock。
 */
const LoopSection: FC<LoopSectionProps> = ({ loop, locale }) => (
  <div className="flex flex-col gap-1">
    {loop.phases.map((phase) => (
      <ReActPhaseBlock key={phase.id} phase={phase} locale={locale} />
    ))}
  </div>
);

export default ReActLoopIterator;
