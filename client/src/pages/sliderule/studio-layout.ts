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
 * 对话铺满；再按一次按 38/62 默认分栏重新挂上。
 */
export function nextStagePageHidden(hidden: boolean): boolean {
  return !hidden;
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
