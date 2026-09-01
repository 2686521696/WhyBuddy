/**
 * 工作台图标簇：布局档分段控件 + 交付物。
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
 *
 * ⚠ 2026-09-01 用户指着「打开画布 / 隐藏页面 / 最大化」三颗独立开关说
 *   「推演过程中不是很好用，容易造成用户识别困难」。对照 Primer
 *   SegmentedControl（GitHub Code|Preview|Blame）和 VS Code layoutService
 *   （布局互斥、不跟内容视图混排）：收成一档互斥分段 分栏 | 全屏 | 画布。
 *   推演中锁定分栏（v0/bolt 同款）。「隐藏页面」不再占顶栏一片，缝上折钮还在。
 */
import React from "react";
import { Layers, RotateCw } from "lucide-react";
import { useStudioLayout } from "./StudioLayoutContext";
import {
  resolveWorkbenchMode,
  STUDIO_WORKBENCH_MODE_OPTIONS,
  workbenchModeForDisplay,
} from "./studio-layout";

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

function StudioWorkbenchModePicker() {
  const studio = useStudioLayout();
  if (!studio?.available) return null;
  const raw = resolveWorkbenchMode({
    maximizeLocked: !!studio.maximizeLocked,
    collapsed: studio.collapsed,
    stagePageHidden: !!studio.stagePageHidden,
  });
  const { mode, locked } = workbenchModeForDisplay(raw, !!studio.layoutLocked);
  const lockTitle = "推演进行中，布局锁定为分栏（对话+页面）";

  return (
    <div
      role="group"
      aria-label="工作台布局"
      data-testid="sliderule-workbench-mode"
      data-header-pattern="primer-segmented-control"
      title={locked ? lockTitle : undefined}
      className={`flex h-7 items-center rounded-md bg-[#f4f4f5] p-0.5 ${
        locked ? "opacity-40" : ""
      }`}
    >
      {STUDIO_WORKBENCH_MODE_OPTIONS.map(opt => {
        const selected = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={selected}
            aria-label={opt.label}
            title={locked ? lockTitle : opt.title}
            disabled={locked}
            data-testid={
              opt.id === "canvas"
                ? "sliderule-stage-view-canvas"
                : `sliderule-workbench-mode-${opt.id}`
            }
            data-workbench-mode={opt.id}
            onClick={() => studio.applyWorkbenchMode(opt.id)}
            className={`rounded-[5px] px-2 py-0.5 text-[11px] transition disabled:hover:text-stone-500 ${
              selected
                ? "bg-white font-medium text-stone-800 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SlideRuleTopHud({
  onOpenDeliverables,
}: {
  /** @deprecated 布局锁走 StudioLayoutProvider.layoutLocked，不读这个 prop */
  isRunning?: boolean;
  /** @deprecated 已搬到标题左侧的 SlideRuleResetSessionButton；这里不再渲染 */
  onResetSession?: () => void;
  onOpenDeliverables?: () => void;
  /** @deprecated 顶栏已撤，字标在侧栏；保留以免老调用点炸 */
  embedded?: boolean;
}) {
  const studio = useStudioLayout();
  const studioOn = !!studio?.available;

  return (
    <div
      className="flex shrink-0 items-center justify-end gap-0.5"
      data-testid="sliderule-status-bar"
    >
      <div
        className="flex items-center gap-0.5"
        data-testid="sliderule-layout-controls"
      >
        {studioOn ? <StudioWorkbenchModePicker /> : null}
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
