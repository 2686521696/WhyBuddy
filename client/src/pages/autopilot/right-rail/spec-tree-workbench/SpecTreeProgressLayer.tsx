/**
 * spec-generation-perceived-performance / Task 3.1
 *
 * `SpecTreeProgressLayer` —— SPEC 树生成的进度反馈层（Progress_Feedback_Layer）。
 *
 * 在 Generation_State_Machine 处于 `pending` 时由 `SpecTreeWorkbench` 渲染，
 * 提供"超出按钮文案翻转"的进行中信号：
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ▣ 正在生成整棵树文档…            2 / 5        │  ← 文案 + 计数（有 progress）
 *   │ ▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  │  ← determinate 进度条
 *   │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← 骨架占位行（覆盖在节点行之上/之内）
 *   │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
 *   └─────────────────────────────────────────────┘
 *
 * 设计约束（见 design.md §"Components and Interfaces" 2）：
 * - 只读：仅消费父级传入的派生 `progress`（来自 `specDocsProgress`），
 *   不订阅 / 不写 store、不持业务数据、不回写真相源。
 * - 不卸载 / 不清空既有真实内容：骨架层覆盖在节点行区域之上/之内，
 *   满足 R2.11「不 blank-out」。
 * - 进度信号：有 `progress` 且 `total > 0` 时渲染 determinate 进度条；
 *   progress 提供但 total 为 0（已触发但尚无总数）时退化为纯骨架；
 *   完全缺失时退化为 indeterminate 动画。
 * - 沿用既有冷灰板（slate-*）+ Tailwind 工具类；不直接写颜色值、
 *   不引入 Framer Motion / Three.js。
 * - 暴露 `data-testid="spec-tree-progress-layer"` 与
 *   `data-progress-kind="skeleton|determinate|indeterminate"`；文案随 locale。
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";

import type { GenerationScope } from "./derive-generation-state";

export type SpecTreeProgressKind = "skeleton" | "determinate" | "indeterminate";

export interface SpecTreeProgressLayerProps {
  locale: AppLocale;
  scope: GenerationScope;
  /** 只读：来自 specDocsProgress 的派生进度，缺失时 indeterminate。 */
  progress?: { processed: number; total: number } | null;
}

// ─── i18n 文案 ────────────────────────────────────────────────────────────

const COPY = {
  generatingAll: {
    "zh-CN": "正在生成整棵树文档…",
    "en-US": "Generating all spec docs…",
  },
  generatingSingle: {
    "zh-CN": "正在生成当前节点文档…",
    "en-US": "Generating current node doc…",
  },
  preparing: {
    "zh-CN": "正在准备…",
    "en-US": "Preparing…",
  },
} as const;

function t(locale: AppLocale, key: keyof typeof COPY): string {
  const lang: AppLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  return COPY[key][lang];
}

// ─── 进度类型折算 ──────────────────────────────────────────────────────────

/**
 * 折算进度信号类型（纯逻辑）：
 * - 完全缺失（null / undefined）→ `indeterminate`
 * - 提供但 total <= 0（已触发、尚无总数）→ `skeleton`
 * - 提供且 total > 0 → `determinate`
 */
function deriveProgressKind(
  progress: { processed: number; total: number } | null | undefined
): SpecTreeProgressKind {
  if (progress === null || progress === undefined) return "indeterminate";
  if (progress.total <= 0) return "skeleton";
  return "determinate";
}

/** 把 processed/total 折算成 [0,100] 的百分比（防御性 clamp）。 */
function toPercent(processed: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = processed / total;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

/** 骨架占位行数量（覆盖在节点行区域之上/之内的视觉占位）。 */
const SKELETON_ROW_COUNT = 3;

export const SpecTreeProgressLayer: FC<SpecTreeProgressLayerProps> = ({
  locale,
  scope,
  progress,
}) => {
  const kind = deriveProgressKind(progress);

  const label = t(
    locale,
    scope === "all" ? "generatingAll" : "generatingSingle"
  );
  const determinate = kind === "determinate" && progress != null;
  const percent = determinate
    ? toPercent(progress.processed, progress.total)
    : 0;

  return (
    <div
      data-testid="spec-tree-progress-layer"
      data-progress-kind={kind}
      data-scope={scope}
      // aria-busy 让辅助技术感知进行中，不写业务状态。
      aria-busy="true"
      aria-live="polite"
      className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5"
    >
      {/* 文案 + （可选）计数 */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400"
          />
          {determinate
            ? label
            : kind === "skeleton"
              ? label
              : t(locale, "preparing")}
        </span>
        {determinate ? (
          <span
            data-testid="spec-tree-progress-count"
            className="shrink-0 font-mono text-[10px] font-bold text-slate-500"
          >
            {progress.processed} / {progress.total}
          </span>
        ) : null}
      </div>

      {/* 进度条：determinate → 真实宽度；否则 indeterminate 动画占位 */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? percent : undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        {determinate ? (
          <div
            data-testid="spec-tree-progress-bar-determinate"
            className="h-full rounded-full bg-slate-500 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div
            data-testid="spec-tree-progress-bar-indeterminate"
            className="h-full w-1/3 animate-pulse rounded-full bg-slate-400"
          />
        )}
      </div>

      {/* 骨架占位行：覆盖在节点行区域之上/之内，不卸载 / 不清空真实内容 */}
      <ul
        data-testid="spec-tree-progress-skeleton"
        aria-hidden="true"
        className="space-y-1.5 pt-0.5"
      >
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
          <li
            key={index}
            className="flex items-center gap-2 rounded-md px-2 py-1.5"
          >
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-sm bg-slate-200" />
            <span className="h-2.5 flex-1 animate-pulse rounded bg-slate-200" />
            <span className="h-2.5 w-10 shrink-0 animate-pulse rounded bg-slate-200" />
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SpecTreeProgressLayer;
