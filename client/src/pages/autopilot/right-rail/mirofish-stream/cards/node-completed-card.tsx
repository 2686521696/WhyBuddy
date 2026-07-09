/**
 * autopilot-mirofish-card-diversity / Task 2.5 — NodeCompletedCard
 *
 * 独立的节点完成卡片组件，使用最小化单行布局标记完成状态。
 *
 * 视觉特征：
 * - 最小化单行：✓ + 节点名称 + 耗时标签
 * - text-white/50 降低对比度
 * - 无独立卡片边框，仅水平分隔线
 */

import type { FC } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishNodeCompletedEntry } from "../mirofish-stream-types";

export interface NodeCompletedCardProps {
  entry: MiroFishNodeCompletedEntry;
  locale?: AppLocale;
  /** 节点执行耗时标签（如 "1.2s"），由外部计算传入 */
  durationLabel?: string;
}

/**
 * NodeCompletedCard — 节点完成卡片
 *
 * 使用最小化单行布局，降低视觉权重，避免在信息流中过度抢占注意力。
 * 不使用独立卡片边框，仅通过底部水平分隔线与相邻内容区分。
 */
export const NodeCompletedCard: FC<NodeCompletedCardProps> = ({
  entry,
  locale = "zh-CN",
  durationLabel,
}) => {
  const nodeTitle = blueprintCopy(entry.nodeTitle, locale);
  const docs = entry.documentTypes.join(" / ");
  const sourceTag = entry.generationSource
    ? `· ${entry.generationSource}`
    : "";

  return (
    <div
      data-testid="mirofish-card-node-completed"
      data-tone={entry.tone}
      data-node-id={entry.nodeId}
      data-source={entry.generationSource ?? "unknown"}
      className="flex items-center gap-2 px-2 py-1 border-b border-slate-100"
    >
      {/* 节点名称（包含 ✓ 完成图标） */}
      <span className="text-[10px] text-emerald-500 truncate flex-1">
        {`✓ ${nodeTitle}`}
      </span>

      {/* 文档类型 + 来源标签 */}
      <span className="text-[9px] font-mono text-slate-400 flex-shrink-0">
        {`${docs} ${sourceTag}`.trim()}
      </span>

      {/* 耗时标签 */}
      {durationLabel && (
        <span className="text-[9px] font-mono text-slate-400 flex-shrink-0">
          {durationLabel}
        </span>
      )}
    </div>
  );
};

export default NodeCompletedCard;
