/**
 * 外壳会话栏折叠。对照 VS Code `toggleSidebarVisibility`（Ctrl+B）。
 *
 * 推演页嵌在 /agent-loop/sliderule 里，会话栏在 DashboardApp，
 * 页面显隐在舞台头条图标簇——跨树，靠这份 context + localStorage。
 */

export const SHELL_SIDEBAR_KEY = "sliderule:shell-sidebar-collapsed";

export function readShellSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SHELL_SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShellSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SHELL_SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    /* 隐私模式：记不住就本页有效 */
  }
}
