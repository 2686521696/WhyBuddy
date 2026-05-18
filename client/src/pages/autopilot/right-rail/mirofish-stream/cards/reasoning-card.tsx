/**
 * autopilot-mirofish-card-diversity / Task 2.1 — ReasoningCard
 *
 * 独立的推理卡片组件，展示 Agent 思考/观察/行动过程。
 *
 * 视觉特征：
 * - 左侧 2px 渐变竖条（thinking=蓝紫, observing=青绿, acting=橙黄）
 * - font-mono text-[11px] 紧凑文本
 * - 流式光标闪烁（CSS @keyframes mirofish-blink）
 * - 进入动画：animate-mirofish-fade-in
 *
 * 流式增强（autopilot-streaming-lifecycle-weave / Task 4.1）：
 * - 可选 `streamingTokens` prop 接收来自 useStreamingWeave 的实时 token
 * - 使用 useRef 避免每次 token 到达触发整个卡片列表 re-render
 * - 实际接线在 Wave 3 task 5.1 的 AutopilotRightRail 中完成
 *
 * ReAct 循环内联展示（autopilot-llm-react-loop-inline / Task 5.1）：
 * - 当需要更细粒度的阶段差异化展示时，可使用
 *   `ReActLoopIterator`（来自 `../react-loop/ReActLoopIterator`）
 *   作为替代详情视图，它将 reasoning entries 按 ReAct 循环分组，
 *   并为每个阶段（thinking / tool-selecting / executing / observing / next-step）
 *   提供独立的彩色竖条和流式文本展示。
 * - 本组件（ReasoningCard）仍作为卡片流中的紧凑摘要视图使用，
 *   ReActLoopIterator 适用于展开详情或独立面板场景。
 */

import { type FC, useEffect, useRef } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishReasoningEntry } from "../mirofish-stream-types";

/** 左侧渐变竖条色映射：phase → Tailwind gradient class */
const REASONING_GRADIENT: Record<string, string> = {
  thinking: "from-blue-500 to-purple-500",
  observing: "from-cyan-400 to-emerald-400",
  acting: "from-orange-400 to-yellow-400",
};

export interface ReasoningCardProps {
  entry: MiroFishReasoningEntry;
  locale?: AppLocale;
  /** 是否处于流式输出状态，展示闪烁光标 */
  streaming?: boolean;
  /**
   * 来自 useStreamingWeave 的实时流式 token（可选）。
   *
   * 当提供时，token 内容会追加到卡片文本末尾，使用 useRef 避免
   * 每次 token 到达触发整个卡片列表 re-render。
   *
   * 实际接线在 Wave 3 task 5.1 的 AutopilotRightRail 中完成。
   *
   * @see useStreamingWeave
   */
  streamingTokens?: string;
}

/**
 * ReasoningCard — 推理过程卡片
 *
 * 通过左侧渐变竖条区分 thinking / observing / acting 三种推理阶段，
 * 使用等宽字体保持信息密度，流式状态下展示闪烁光标。
 *
 * 流式增强：当 `streamingTokens` 提供时，使用 useRef 将 token 追加到
 * DOM 节点，避免每次 token 到达触发整个卡片列表 re-render。
 */
export const ReasoningCard: FC<ReasoningCardProps> = ({
  entry,
  locale = "zh-CN",
  streaming = false,
  streamingTokens,
}) => {
  const gradient = REASONING_GRADIENT[entry.phase] ?? REASONING_GRADIENT.thinking;

  // 流式 token 追加 ref — 避免每次 token 触发整个列表 re-render
  const streamingRef = useRef<HTMLSpanElement>(null);

  // 当 streamingTokens 变化时，直接操作 DOM 追加文本
  useEffect(() => {
    if (streamingTokens && streamingRef.current) {
      streamingRef.current.textContent = streamingTokens;
    }
  }, [streamingTokens]);

  // 组装显示文本
  let text: string | undefined;
  if (entry.thought) text = blueprintCopy(entry.thought, locale);
  else if (entry.actionToolId) text = `→ ${entry.actionToolId}`;
  else if (entry.observationSummary) {
    const mark = entry.observationSuccess === false ? "✗" : "✓";
    text = `${mark} ${blueprintCopy(entry.observationSummary, locale)}`;
  } else if (entry.reason) text = blueprintCopy(entry.reason, locale);
  else if (entry.error) text = blueprintCopy(entry.error, locale);

  return (
    <div
      data-testid="mirofish-card-reasoning"
      data-tone={entry.tone}
      data-phase={entry.phase}
      data-iteration={entry.iterationLabel}
      className="animate-mirofish-fade-in relative pl-3 py-2 bg-slate-50 rounded-md border border-slate-200"
    >
      {/* 左侧 2px 渐变竖条 */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[2px] rounded-full bg-gradient-to-b ${gradient}`}
        aria-hidden="true"
      />

      {/* 迭代标签 */}
      <div className="text-[9px] font-mono text-slate-400 mb-0.5">
        {entry.phase} · {entry.iterationLabel}
      </div>

      {/* 推理文本 */}
      {(text || streamingTokens) && (
        <div className="font-mono text-[11px] text-slate-700 leading-relaxed break-all">
          {text}
          {/* 流式 token 追加区域 — 通过 ref 直接操作 DOM 避免 re-render */}
          {streamingTokens !== undefined && (
            <span ref={streamingRef} aria-live="polite" />
          )}
          {/* 流式光标 */}
          {(streaming || streamingTokens) && (
            <span
              className="animate-mirofish-blink inline-block w-[2px] h-3 bg-slate-500 ml-0.5 align-middle"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningCard;
