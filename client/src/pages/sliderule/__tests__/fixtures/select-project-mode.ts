/**
 * 驱动工程工作台的视图切换。
 *
 * ⚠ 2026-09-14：这个控件从一排 `role="tab"` 按钮改成了一枚 `<select>`
 *   （对照 Manus 的收起式下拉）。三个判据文件原来各写各的
 *   `click("源码")` / `click("交付")` / `querySelector('[role="tab"]')`，
 *   换控件时三处一起红。收到这里一份，下次再换控件只改一处（§4）。
 */
export const PROJECT_MODES = {
  预览: "preview",
  源码: "source",
  版本: "history",
  数据: "data",
  交付: "delivery",
} as const;

/**
 * 把工作台切到某个视图。**必须包在调用方自己的 `act()` 里**——
 * 这里不 import react，免得判据文件之间共享 React 实例出岔子。
 */
export function selectProjectMode(
  container: ParentNode,
  label: keyof typeof PROJECT_MODES
): void {
  const select = container.querySelector<HTMLSelectElement>(
    '[data-testid="project-mode-select"]'
  );
  if (!select) throw new Error("工程工作台视图切换控件不在");
  select.value = PROJECT_MODES[label];
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
