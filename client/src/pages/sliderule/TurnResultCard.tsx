/**
 * TurnResultCard —— 一轮跑完之后，对话流里留下的那张卡。
 *
 * ## 为什么要它（2026-09-14，用户第二次对照 Manus 截图）
 *
 * Manus 跑完留下的是一张卡：应用名 + 未发布 + 用时 + 缩略图 + 发布按钮，
 * 底下一行 `✓ 任务已完成 · 复制 · 重试 · 评分`。往上滚看历史，每个任务都
 * 留着那张卡。我们跑完只有一段文字——成果散在右侧预览列，**对话流里没有
 * 任何一个「东西做好了，在这儿」的锚点**。
 *
 * ## 判断全在 turn-result-card.ts
 *
 * 这里只画。「该不该出卡 / 写什么」是纯函数（`resultCardModel`），判据直接
 * 跑它，不靠渲染测。本仓一贯做法。
 *
 * ## 诚实边界
 *
 *   · 缩略图拿不到就**整块不画**，不挂占位图、不拿别的图顶。
 *     （今天恒为空：截图服务只在生成过程里做自检，没落成会话级产物。）
 *   · 评分是纯本地反馈，点了就是点了，不假装发到了哪儿——真要收集得先有
 *     落库接口，没有之前不画一个「已提交」的假回执。
 */

import React from "react";
import { Check, Copy, ExternalLink, RotateCw, Upload } from "lucide-react";
import { resultCardModel } from "./turn-result-card";
import type { UiTurn } from "./types";

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[13px] leading-none ${on ? "text-amber-500" : "text-stone-300"} hover:text-amber-400`}
      aria-label="评分"
    >
      ★
    </button>
  );
}

export function TurnResultCard({
  turn,
  runtimeKind,
  goalText,
  projectRevision,
  hasPages,
  thumbnailUrl,
  onOpen,
  onRetry,
}: {
  turn: UiTurn;
  runtimeKind?: "html-prototype" | "project" | null;
  goalText?: string | null;
  projectRevision?: string | null;
  hasPages?: boolean;
  thumbnailUrl?: string | null;
  onOpen?: () => void;
  onRetry?: () => void;
}) {
  const model = resultCardModel(turn, {
    runtimeKind,
    goalText,
    projectRevision,
    hasPages,
    thumbnailUrl,
  });
  const [rating, setRating] = React.useState(0);
  const [copied, setCopied] = React.useState(false);

  if (!model) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.assistant || model.title);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 复制失败就什么都不说，不弹一个假的「已复制」。
    }
  };

  return (
    <section
      className="my-2 overflow-hidden rounded-xl border border-stone-200 bg-white"
      data-testid="turn-result-card"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <Check className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-stone-800">
          {model.title}
        </span>
        <span
          className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500"
          data-testid="turn-result-badge"
        >
          {model.badge}
        </span>
        {model.worked ? (
          <span
            className="shrink-0 tabular-nums text-[11px] text-stone-400"
            data-testid="turn-result-worked"
          >
            {model.worked}
          </span>
        ) : null}
      </header>

      {/* ⚠ 拿不到缩略图就整块不画，不挂占位图（见文件头注）。 */}
      {model.thumbnailUrl ? (
        <img
          src={model.thumbnailUrl}
          alt=""
          className="max-h-52 w-full border-y border-stone-100 object-cover object-top"
          data-testid="turn-result-thumb"
        />
      ) : null}

      <footer className="flex items-center gap-1 border-t border-stone-100 bg-stone-50/60 px-3 py-2">
        <span className="mr-1 inline-flex items-center gap-1 text-[12px] text-emerald-600">
          <Check className="h-3.5 w-3.5" /> 任务已完成
        </span>
        {model.canOpen && onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            data-testid="turn-result-open"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-stone-600 hover:bg-stone-100"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 打开
          </button>
        ) : null}
        {model.canPublish ? (
          <button
            type="button"
            disabled
            title="发布通道尚未接通"
            data-testid="turn-result-publish"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-stone-400"
          >
            <Upload className="h-3.5 w-3.5" /> 发布
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          data-testid="turn-result-copy"
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-stone-600 hover:bg-stone-100"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "已复制" : "复制"}
        </button>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            data-testid="turn-result-retry"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-stone-600 hover:bg-stone-100"
          >
            <RotateCw className="h-3.5 w-3.5" /> 重试
          </button>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="text-[11px] text-stone-400">这个结果怎么样？</span>
          <span className="inline-flex gap-0.5" data-testid="turn-result-rating">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} on={n <= rating} onClick={() => setRating(n)} />
            ))}
          </span>
        </span>
      </footer>
    </section>
  );
}
