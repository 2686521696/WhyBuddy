/**
 * autopilot-mirofish-card-diversity / Task 2.6 — SystemNoteCard
 *
 * 独立的系统消息卡片组件，展示系统级提示和阶段切换信息。
 *
 * 视觉特征：
 * - 居中对齐 text-[10px] text-white/40 italic
 * - 无边框无背景
 * - 阶段切换时两侧水平虚线装饰
 * - 最小垂直间距 my-1
 */

import type { FC } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishSystemNoteEntry } from "../mirofish-stream-types";

export interface SystemNoteCardProps {
  entry: MiroFishSystemNoteEntry;
  locale?: AppLocale;
}

/**
 * SystemNoteCard — 系统消息卡片
 *
 * 居中展示系统级消息，不使用卡片边框和背景色，
 * 仅作为信息流中的分隔提示。阶段切换时在文字两侧展示水平虚线装饰。
 */
export const SystemNoteCard: FC<SystemNoteCardProps> = ({
  entry,
  locale = "zh-CN",
}) => {
  const messageText = blueprintCopy(entry.message, locale);
  const hintText = entry.hint ? blueprintCopy(entry.hint, locale) : undefined;
  const icon = entry.tone === "warning" || entry.tone === "danger" ? "⚠" : "ℹ";

  return (
    <div
      data-testid="mirofish-card-system-note"
      data-tone={entry.tone}
      className="flex items-center justify-center gap-2 py-1 my-1"
    >
      {/* 左侧虚线装饰 */}
      <div className="flex-1 h-px border-t border-dashed border-slate-200" aria-hidden="true" />

      {/* 图标 + 系统消息文本 */}
      <span className="text-[10px] text-slate-400 italic whitespace-nowrap">
        {icon} {messageText}
      </span>

      {/* 右侧虚线装饰 */}
      <div className="flex-1 h-px border-t border-dashed border-slate-200" aria-hidden="true" />

      {/* hint 文本（隐藏在 DOM 中供测试断言） */}
      {hintText && (
        <span className="sr-only">{hintText}</span>
      )}
    </div>
  );
};

export default SystemNoteCard;
