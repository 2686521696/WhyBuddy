/**
 * 工作台图标簇：隐藏/显示页面、最大化、交付物、重置。
 *
 * 2026-08-20：不再独占整页顶栏（真机占一条底边）。簇挂在舞台头条
 * 右侧空位（角色 / 桌面 那一行），和 GitHub / Cursor 把窗口控件放在
 * 面板标题行同一侧同一套。
 */
import React from "react";
import { Layers, Maximize2, Minimize2, RotateCw } from "lucide-react";
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
}: {
  isRunning: boolean;
  onResetSession?: () => void;
  onOpenDeliverables?: () => void;
  /** @deprecated 顶栏已撤，字标在侧栏；保留以免老调用点炸 */
  embedded?: boolean;
}) {
  const studio = useStudioLayout();
  const studioOn = !!studio?.available;
  const pageHidden = !!studio?.stagePageHidden;
  const collapsed = studio?.collapsed ?? { chat: false, stage: false };
  const maximized = !pageHidden && isStageMaximized(collapsed);
  const maxIntent = pageHidden ? "noop" : maximizeIntent(collapsed);

  return (
    <div
      className="flex shrink-0 items-center justify-end gap-0.5"
      data-testid="sliderule-status-bar"
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
