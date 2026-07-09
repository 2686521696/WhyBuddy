/**
 * autopilot-mirofish-stream / Wave 0 — 共享卡片外壳
 *
 * 所有 6 类 MiroFish 卡片共享同一外壳：
 *   ┌───────────────────────────────────────────┐
 *   │ {icon} {label}    {timestampHHMMSS}        │  ← 顶部行 (h≈20px)
 *   │ {body row 1：核心内容,single-line truncate}  │
 *   │ {body row 2：补充摘要,line-clamp-2}          │
 *   └───────────────────────────────────────────┘
 *
 * 设计目标：
 * - 单纵向布局,max-width: 100%,在 360px 宽度下完整渲染
 * - tone 决定边框 / 背景色,与 derive-spec-tree-chip ChipTone 一致
 * - 不引入 framer-motion；fade-in 动画用 CSS transition,prefers-reduced-motion
 *   下自动降级（由全局 CSS 已经处理）
 * - SSR 友好,所有动画通过 className 接入,不读 window
 */

import type { FC, ReactNode } from "react";

import type { MiroFishStreamTone } from "../mirofish-stream-types";

/**
 * 卡片外壳变体类型。
 *
 * - `default`：标准圆角边框内边距（现有样式）
 * - `compact`：更小垂直内边距（py-1）
 * - `minimal`：无边框无背景，仅渲染内容
 * - `glow`：标准样式 + 微弱发光 box-shadow
 */
export type CardShellVariant = "default" | "compact" | "minimal" | "glow";

const TONE_CARD_CLASS: Record<MiroFishStreamTone, string> = {
  neutral: "bg-white border-slate-200",
  info: "bg-sky-50 border-sky-200",
  success: "bg-emerald-50 border-emerald-200",
  warning: "bg-amber-50 border-amber-200",
  danger: "bg-red-50 border-red-300",
};

const TONE_LABEL_CLASS: Record<MiroFishStreamTone, string> = {
  neutral: "text-slate-500",
  info: "text-sky-700",
  success: "text-emerald-700",
  warning: "text-amber-800",
  danger: "text-red-700",
};

/**
 * 各变体对应的容器样式类。
 *
 * - `default`：标准圆角边框 + 内边距
 * - `compact`：与 default 相同但垂直内边距更小（py-1）
 * - `minimal`：无边框、无背景、无内边距
 * - `glow`：与 default 相同 + 微弱发光阴影
 */
const VARIANT_CLASS: Record<CardShellVariant, string> = {
  default: "rounded-md border px-2.5 py-1.5",
  compact: "rounded-md border px-2.5 py-1",
  minimal: "",
  glow: "rounded-md border px-2.5 py-1.5 shadow-[0_0_8px_rgba(99,102,241,0.15)]",
};

/**
 * 把 ISO timestamp 折算为 HH:MM:SS。非法 timestamp 返回 "--:--:--"。
 */
export function formatTimestampHHMMSS(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--:--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export interface MiroFishCardShellProps {
  icon: string;
  label: string;
  tone: MiroFishStreamTone;
  timestamp: string;
  /**
   * 外壳变体，控制容器的边框、内边距与阴影样式。
   * @default 'default'
   */
  variant?: CardShellVariant;
  /** 主体行 1：核心内容，single-line truncate。 */
  primaryRow?: ReactNode;
  /** 主体行 2：补充摘要，line-clamp-2。 */
  secondaryRow?: ReactNode;
  /** 测试 / 调试 testid（可选，每类卡片自己传特定 id）。 */
  testid?: string;
  /** 额外 data 属性供测试断言。 */
  dataAttrs?: Record<string, string>;
}

export const MiroFishCardShell: FC<MiroFishCardShellProps> = ({
  icon,
  label,
  tone,
  timestamp,
  variant = "default",
  primaryRow,
  secondaryRow,
  testid,
  dataAttrs,
}) => {
  // minimal 变体不应用 tone 背景/边框色
  const toneClass = variant === "minimal" ? "" : TONE_CARD_CLASS[tone];
  const variantClass = VARIANT_CLASS[variant];

  return (
    <div
      data-testid={testid ?? "mirofish-card"}
      data-tone={tone}
      data-variant={variant}
      {...(dataAttrs ?? {})}
      className={
        `${variantClass} transition-opacity duration-200 ${toneClass}`.trim()
      }
    >
      <div className="flex items-center gap-1.5 text-[10px]">
        <span aria-hidden="true">{icon}</span>
        <span
          className={"font-bold uppercase " + TONE_LABEL_CLASS[tone]}
        >
          {label}
        </span>
        <span className="ml-auto font-mono text-[9px] text-slate-400">
          {formatTimestampHHMMSS(timestamp)}
        </span>
      </div>
      {primaryRow !== undefined ? (
        <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-700">
          {primaryRow}
        </div>
      ) : null}
      {secondaryRow !== undefined ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-600">
          {secondaryRow}
        </div>
      ) : null}
    </div>
  );
};

export default MiroFishCardShell;
