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
 */

import type { FC } from "react";

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
}

/**
 * ReasoningCard — 推理过程卡片
 *
 * 通过左侧渐变竖条区分 thinking / observing / acting 三种推理阶段，
 * 使用等宽字体保持信息密度，流式状态下展示闪烁光标。
 */
export const ReasoningCard: FC<ReasoningCardProps> = ({
  entry,
  locale = "zh-CN",
  streaming = false,
}) => {
  const gradient = REASONING_GRADIENT[entry.phase] ?? REASONING_GRADIENT.thinking;

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
      {text && (
        <div className="font-mono text-[11px] text-slate-700 leading-relaxed">
          {text}
          {/* 流式光标 */}
          {streaming && (
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
