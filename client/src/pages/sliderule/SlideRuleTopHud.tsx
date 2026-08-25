/**
 * 工作台图标簇：隐藏/显示页面、最大化、交付物。
 *
 * 2026-08-20：不再独占整页顶栏（真机占一条底边）。簇挂在舞台头条
 * 右侧空位（角色 / 桌面 那一行），和 GitHub / Cursor 把窗口控件放在
 * 面板标题行同一侧同一套。
 *
 * ⚠ 2026-08-24 用户反馈，簇里少了两件，都是"按钮一多看不懂哪个是哪个"：
 *   · 「重置布局」整个撤掉。它不是没了——StudioSplit 那道缝上的双击仍走
 *     同一条 resetLayout（`onDoubleClick={phone ? undefined : resetLayout}`），
 *     所以这里删按钮不会把功能变孤儿。改回来之前先想清楚：一排 5 个灰
 *     图标里，用户分不出哪个是"重置布局"哪个是"重置会话"。
 *   · 「重置会话」搬走了，见下面 SlideRuleResetSessionButton——它现在是
 *     舞台头条**标题左侧**那颗蓝钮，不再混在右侧灰图标里。这里保留
 *     onResetSession 形参只为不炸老调用点，**不渲染**。
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
        <rect
          x="10.8"
          y="3.3"
          width="2.9"
          height="9.4"
          fill="currentColor"
          opacity="0.28"
        />
      ) : null}
    </svg>
  );
}

export function SlideRuleTopHud({
  onOpenDeliverables,
}: {
  /** @deprecated 只有重置会话用它，按钮已搬走 */
  isRunning?: boolean;
  /** @deprecated 已搬到标题左侧的 SlideRuleResetSessionButton；这里不再渲染 */
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
  const maxIntent = pageHidden
    ? "noop"
    : maximizeIntent(collapsed, !!studio?.maximizeLocked);

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
                maxIntent === "locked"
                  ? "画布档固定最大化（切到「页面」档可还原分栏）"
                  : maxIntent === "restore"
                    ? "还原分栏"
                    : maxIntent === "noop"
                      ? "舞台已折叠，无法最大化"
                      : "最大化舞台"
              }
              pressed={maximized}
              /* ⚠ 置灰而不是藏起来：按钮凭空消失比按不动更让人以为坏了，
                 而且档位来回切时顶栏会跳。置灰 + title 说清原因。 */
              disabled={maxIntent === "noop" || maxIntent === "locked"}
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
    </div>
  );
}

/**
 * 重置会话——舞台头条**标题左侧**那颗蓝钮。
 *
 * ⚠ 2026-08-24 用户反馈：它原先是右侧灰图标簇里的第 5 个 ⟳，和「重置布局」
 * 的 ◫ 挨着，两个都叫"重置"、都是灰的、都 7px 见方——真机上用户分不出点哪个，
 * 也看不见它。所以这里**不是**换个位置那么简单：
 *   · 位置搬到标题左（一行里最先被扫到的点，不跟一排工具图标抢注意力）；
 *   · 尺寸 h-7 w-7 → h-8 w-8，图标 3.5 → 4；
 *   · 配色从 #5c5c5c 灰改成品牌蓝 #1677ff + 浅蓝底，跟同栏的「透视」蓝一套。
 * 别再把它塞回右侧图标簇——那正是这次要修的问题。
 */
export function SlideRuleResetSessionButton({
  isRunning,
  onResetSession,
}: {
  isRunning?: boolean;
  onResetSession?: () => void;
}) {
  if (!onResetSession) return null;
  return (
    <button
      type="button"
      data-testid="sliderule-reset-session"
      aria-label="重置会话"
      title={
        isRunning
          ? "推演进行中，稍后再重置"
          : "清空本轮对话与持久化状态，重新开始"
      }
      disabled={isRunning}
      onClick={onResetSession}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#eef5ff] text-[#1677ff] transition hover:bg-[#dbeafe] hover:text-[#0958d9] disabled:opacity-30 disabled:hover:bg-[#eef5ff]"
    >
      <RotateCw className="h-4 w-4" strokeWidth={2} />
    </button>
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
