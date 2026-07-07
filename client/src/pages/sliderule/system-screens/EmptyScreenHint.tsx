/**
 * EmptyScreenHint — 系统屏空状态（无本话题数据时的诚实提示）。
 *
 * 取代早期的"假域示例占位"（采购 ER 图、采购 AIGC 卡等）：淡化+小字标注
 * 仍会被误读成真实数据（用户实际踩过），所以空状态一律不渲染任何具体
 * 领域内容，只说清楚"这里将来会出现什么"。
 */

import React from "react";

export function EmptyScreenHint({
  title,
  desc,
}: {
  /** 将来会出现什么，如「实体关系图（ER）」 */
  title: string;
  /** 补充说明（可选） */
  desc?: string;
}) {
  return (
    <div
      className="flex h-full min-h-32 flex-1 items-center justify-center p-6"
      data-testid="screen-empty-hint"
    >
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#E7E2D9] px-8 py-10 text-center">
        <div className="text-2xl text-stone-300">⌁</div>
        <div className="text-xs font-medium text-stone-500">
          发送意图并推演闭环后，这里将显示本话题的{title}
        </div>
        {desc && <div className="text-[11px] text-stone-400">{desc}</div>}
      </div>
    </div>
  );
}
