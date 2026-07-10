import React from "react";
import { autopilotTheme } from "./autopilot-theme";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { Layers, RotateCw } from "lucide-react";

export type SlideRuleSurfaceMode = "work" | "code";

const SURFACE_MODES: Array<{ id: SlideRuleSurfaceMode; label: string }> = [
  { id: "work", label: "Work" },
  { id: "code", label: "Code" },
];

export function SlideRuleTopHud({
  isRunning,
  surfaceMode = "code",
  onSurfaceModeChange,
  onResetSession,
  onOpenDeliverables,
  embedded = false,
}: {
  isRunning: boolean;
  /** 顶层产品模式（用户裁决：STATUS 状态盒退役，原位换 TRAE 式切换）——
   *  Code = 推演主界面（默认）；Work = 角色巡演（建设中占位） */
  surfaceMode?: SlideRuleSurfaceMode;
  onSurfaceModeChange?: (mode: SlideRuleSurfaceMode) => void;
  onResetSession?: () => void;
  onOpenDeliverables?: () => void;
  embedded?: boolean;
}) {
  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="sliderule-status-bar"
    >
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {embedded ? null : (
            <img
              src={`${import.meta.env.BASE_URL}assets/sliderule_logo_wordmark_transparent.png`}
              alt="SlideRule"
              className="h-[42px] w-auto max-w-[156px] shrink-0 object-contain opacity-95 sm:h-[46px]"
              title="SlideRule"
            />
          )}
          {/* Work / Code 模式胶囊（话题与阶段信息已由左栏对话与右舞台承载） */}
          <div
            className="flex items-center gap-0.5 rounded-lg border border-[#e5e7eb] bg-white/80 p-1 shadow-[0_1px_6px_rgb(15_23_42/0.05)]"
            data-testid="sliderule-surface-mode"
          >
            {SURFACE_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                data-testid={`sliderule-mode-${m.id}`}
                aria-pressed={surfaceMode === m.id}
                onClick={() => onSurfaceModeChange?.(m.id)}
                className={`rounded-md px-3.5 py-1 text-[13px] font-medium transition-colors ${
                  surfaceMode === m.id
                    ? "bg-[#e6f4ff] text-[#1677ff]"
                    : "text-stone-500 hover:bg-[#eef0f4] hover:text-stone-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-2 py-1"
          data-testid="sliderule-header-actions"
        >
          {onOpenDeliverables && (
            <button
              type="button"
              onClick={onOpenDeliverables}
              data-testid="sliderule-deliverables-open"
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium text-stone-700 shadow-[0_1px_6px_rgb(15_23_42/0.06)] transition hover:border-[#d3d8e0] hover:bg-[#eef0f4]"
              title="交付物"
            >
              <Layers className="h-4 w-4" />
              交付物
            </button>
          )}
          {/* 设置入口收敛到侧栏「设置」整页（用户反馈：与侧栏重复） */}
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="sliderule-reset-session"
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium text-stone-700 shadow-[0_1px_6px_rgb(15_23_42/0.06)] transition hover:border-[#d3d8e0] hover:bg-[#eef0f4] disabled:opacity-45"
              title={
                isRunning
                  ? "推演进行中，稍后再重置"
                  : "清空本轮对话与持久化状态，重新开始"
              }
            >
              <RotateCw className="h-4 w-4" />
              重置会话
            </button>
          )}
          {!IS_GITHUB_PAGES && (
            <a href="/sliderule/dev" className={autopilotTheme.devLink}>
              Dev
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function InlineMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="tabular-nums text-stone-600">
      <span className="text-stone-400">{label} </span>
      <span className="font-mono font-semibold text-stone-800">{value}</span>
    </span>
  );
}
