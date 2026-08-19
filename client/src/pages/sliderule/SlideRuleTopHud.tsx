/**
 * 推演页唯一顶栏。右侧无字图标簇。
 *
 * 2026-08-18 真机：左边「会话栏」图标不要；右边只控制预览页显隐，
 * 不许走 panel.collapse() 改宽度。
 */
import React from "react";
import { Layers, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { autopilotTheme } from "./autopilot-theme";
import { useStudioLayout } from "./StudioLayoutContext";
import { isStageMaximized, maximizeIntent } from "./studio-layout";

function LayoutBtn({
  testId,
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-[4px] text-[#5c5c5c] transition hover:bg-[#ececec] disabled:opacity-30 ${
        pressed ? "bg-[#e4e4e4] text-[#1f1f1f]" : ""
      }`}
    >
      {children}
    </button>
  );
}

function SidebarRightGlyph({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="1.75"
        y="2.75"
        width="12.5"
        height="10.5"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M10.4 3.2v9.6" stroke="currentColor" strokeWidth="1.2" />
      {filled ? (
        <rect x="10.8" y="3.3" width="2.9" height="9.4" fill="currentColor" opacity="0.28" />
      ) : null}
    </svg>
  );
}

export function SlideRuleTopHud({
  isRunning,
  onResetSession,
  onOpenDeliverables,
  embedded = false,
}: {
  isRunning: boolean;
  onResetSession?: () => void;
  onOpenDeliverables?: () => void;
  embedded?: boolean;
}) {
  const studio = useStudioLayout();
  const studioOn = !!studio?.available;
  const pageHidden = !!studio?.stagePageHidden;
  const collapsed = studio?.collapsed ?? { chat: false, stage: false };
  const maximized = !pageHidden && isStageMaximized(collapsed);
  const maxIntent = pageHidden ? "noop" : maximizeIntent(collapsed);

  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="sliderule-status-bar"
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {embedded ? null : (
            <img
              src={`${import.meta.env.BASE_URL}assets/sliderule_logo_wordmark_transparent.png`}
              alt="SlideRule"
              className="h-[42px] w-auto max-w-[156px] shrink-0 object-contain opacity-95 sm:h-[46px]"
              title="SlideRule"
            />
          )}
        </div>

        <div
          className="flex shrink-0 items-center justify-end gap-0.5 py-1"
          data-testid="sliderule-header-actions"
        >
          <div
            className="flex items-center gap-0.5"
            data-testid="sliderule-layout-controls"
          >
            {studioOn ? (
              <>
                <LayoutBtn
                  testId="sliderule-layout-stage"
                  label={pageHidden ? "显示页面" : "隐藏页面"}
                  pressed={!pageHidden}
                  onClick={studio?.toggleStagePage}
                >
                  <SidebarRightGlyph filled={!pageHidden} />
                </LayoutBtn>
                <LayoutBtn
                  testId="sliderule-layout-maximize"
                  label={
                    maxIntent === "restore"
                      ? "还原分栏"
                      : maxIntent === "noop"
                        ? "舞台已折叠，无法最大化"
                        : "最大化舞台"
                  }
                  pressed={maximized}
                  disabled={maxIntent === "noop"}
                  onClick={studio?.toggleMaximize}
                >
                  {maximized ? (
                    <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </LayoutBtn>
              </>
            ) : null}
          </div>

          {studioOn ? (
            <span
              aria-hidden
              className="mx-1.5 h-4 w-px bg-[#e5e7eb]"
              data-testid="sliderule-header-action-rule"
            />
          ) : null}

          {onOpenDeliverables && (
            <LayoutBtn
              testId="sliderule-deliverables-open"
              label="交付物"
              onClick={onOpenDeliverables}
            >
              <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
            </LayoutBtn>
          )}
          {onResetSession && (
            <LayoutBtn
              testId="sliderule-reset-session"
              label={
                isRunning
                  ? "推演进行中，稍后再重置"
                  : "清空本轮对话与持久化状态，重新开始"
              }
              disabled={isRunning}
              onClick={onResetSession}
            >
              <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </LayoutBtn>
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
