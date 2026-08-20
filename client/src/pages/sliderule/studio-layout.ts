/**
 * 工作台分栏策略。对照 VS Code workbench layoutService，不拉 vscode 仓。
 *
 * microsoft/vscode `src/vs/workbench/services/layout/browser/layoutService.ts`：
 *   toggleSidebarVisibility / toggleAuxiliaryBar / toggleMaximizeEditorGroup
 * 两侧不能同时折没——本仓 2026-08-18 的 StudioSplit 已经踩过：
 * 两个都 collapse 只剩一条缝，整页废了。
 *
 * 映射到 /agent-loop/sliderule：
 *   会话栏 ≈ Side Bar
 *   对话   ≈ Editor
 *   舞台   ≈ Auxiliary Bar
 *   最大化 ≈ 折对话、舞台铺满（再按还原）
 */

import { SHELL_SIDEBAR_WIDTH_PX } from "./shell-sidebar-layout";

export type StudioPart = "chat" | "stage";

export type StudioCollapsed = {
  chat: boolean;
  stage: boolean;
};

export function canCollapsePart(
  part: StudioPart,
  collapsed: StudioCollapsed
): boolean {
  return part === "chat" ? !collapsed.stage : !collapsed.chat;
}

export function isStageMaximized(collapsed: StudioCollapsed): boolean {
  return collapsed.chat && !collapsed.stage;
}

export type MaximizeIntent = "maximize" | "restore" | "noop";

export function maximizeIntent(collapsed: StudioCollapsed): MaximizeIntent {
  if (collapsed.stage) return "noop";
  return collapsed.chat ? "restore" : "maximize";
}

/**
 * 舞台页是显隐，不是宽度。
 *
 * 2026-08-18 真机：顶栏右侧栏图标走了 `panel.collapse()`，那是改 flex
 * 尺寸（宽变成 0），用户原话「不是控制它的宽度的」。隐藏 = 整块不渲染，
 * 对话铺满；再按一次按默认分栏重新挂上。
 */
export function nextStagePageHidden(hidden: boolean): boolean {
  return !hidden;
}

/**
 * 对话栏默认宽 = 左侧菜单的二倍。
 *
 * ⚠ 2026-08-20 City Walk：38/62 百分比让对话栏比侧栏宽一截，用户指着
 * 说默认要菜单宽度的二倍。百分比跟窗口走，会漂；用侧栏像素 ×2 再折成
 * 分栏百分比。量不到容器时回落 30%（约 1920−252 工作区上的 504px）。
 */
export const STUDIO_CHAT_SIDEBAR_MULTIPLIER = 2;
export const STUDIO_CHAT_MIN_PERCENT = 20;
export const STUDIO_CHAT_MAX_PERCENT = 72;
export const STUDIO_CHAT_FALLBACK_PERCENT = 30;

export function studioChatDefaultPx(): number {
  return SHELL_SIDEBAR_WIDTH_PX * STUDIO_CHAT_SIDEBAR_MULTIPLIER;
}

export function studioChatDefaultPercent(splitWidthPx: number): number {
  if (!(splitWidthPx > 0)) return STUDIO_CHAT_FALLBACK_PERCENT;
  const pct = (studioChatDefaultPx() / splitWidthPx) * 100;
  return Math.min(
    STUDIO_CHAT_MAX_PERCENT,
    Math.max(STUDIO_CHAT_MIN_PERCENT, pct)
  );
}

export function studioStageDefaultPercent(splitWidthPx: number): number {
  return 100 - studioChatDefaultPercent(splitWidthPx);
}

/**
 * 手机预览列默认宽 = 左侧菜单 ×2，且不可拖。
 *
 * 桌面把「菜单×2」给对话栏、舞台吃剩余。手机机框只有 390 CSS 像素，
 * 舞台再吃 70% 会把 contain 拉到 110%，对话被挤成一条。对调：预览列
 * 锁在菜单×2（504px），对话吃剩余。
 *
 * ⚠ 2026-08-20：用户原话「手机端视图默认给个宽度，菜单那块的两倍，不可拖拽」。
 * 改回跟桌面同一套 38/62、或仍让手机舞台可拖，这条必须红。
 */
export function studioPhoneStageDefaultPx(): number {
  return studioChatDefaultPx();
}

export function studioPhoneStageDefaultPercent(splitWidthPx: number): number {
  return studioChatDefaultPercent(splitWidthPx);
}

export function studioPhoneChatDefaultPercent(splitWidthPx: number): number {
  return 100 - studioPhoneStageDefaultPercent(splitWidthPx);
}

export function isPhoneStudioDevice(device?: string | null): boolean {
  return device === "phone";
}

/** 猜分栏容器宽：视口减去展开侧栏。侧栏折没时整窗都是分栏。 */
export function guessStudioSplitWidthPx(
  viewportWidth: number,
  sidebarCollapsed = false
): number {
  const side = sidebarCollapsed ? 0 : SHELL_SIDEBAR_WIDTH_PX;
  return Math.max(0, viewportWidth - side);
}

/** 空会话或用户藏了预览页：右侧整块不渲染。不是把宽度收成 0。 */
export function isStagePageShown(
  stageVisible: boolean,
  stagePageHidden: boolean
): boolean {
  return stageVisible && !stagePageHidden;
}

/**
 * 还没开始推演时顶栏整条不挂。
 *
 * ⚠ 2026-08-20 空态：舞台折钮已经靠 `available=false` 藏了，但交付物 /
 * 重置仍占一条带底边的栏，用户指着右上角说不要。变异：只藏图标、留那条
 * 底边，看起来还在。
 */
export function isStudioChromeShown(isHomeEmpty: boolean): boolean {
  return !isHomeEmpty;
}
