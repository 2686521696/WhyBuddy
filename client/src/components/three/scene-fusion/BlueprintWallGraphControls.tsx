/**
 * BlueprintWallGraphControls - 蓝图墙面流程图右上角的外部 fit/zoom 控制条（纯 React 组件）。
 *
 * 渲染参考图右上角的图控件：缩小 / 放大 / 适配视图（fit view）三个按钮。本组件**只**负责
 * 呈现按钮并在点击时回调，**不**直接持有 G6 图实例——具体的命令式调用
 * （`graph.zoomBy(...)` / `graph.fitView()`）由宿主 `BlueprintWallProcessGraphHud`
 * 通过 FlowGraph 转发的 ref 执行。这样本组件保持纯 React、无 `@ant-design/graphs` /
 * `@antv/g6` 运行时依赖，可被 `react-dom/server` `renderToStaticMarkup` 直接渲染
 * （Task 5.4 SSR/source 测试）。
 *
 * 为什么是「外部按钮」而不是画布内手势（Task 1.4 spike 决策，见
 * `BlueprintWallProcessGraphHud.tsx` JSDoc，Req 9.8 / 9.9）：墙面经 drei
 * `<Html transform>` 套了 CSS transform，G6 v5 的 canvas 平移/缩放手势依赖屏幕空间指针
 * 坐标做 hit-testing，在 transform 之后不可靠。因此首版**禁用** canvas pan/zoom
 * （`behaviors={[]}`），改由这一组外部按钮命令式驱动同一张图的 fit/zoom（Req 2.4 至少
 * 提供 zoom-out + fit view；这里额外提供 zoom-in）。
 *
 * 设计要点（Req 2.4 / 9.1 / 9.5 / 9.7）：
 *  - **纯函数组件**：无 hook、无副作用、确定性输出（按钮 disabled 态由 props 驱动）。
 *  - **可测 DOM**：根节点带 `data-wall-graph-controls`，每个按钮带 `data-control-action`
 *    （`zoom-out` | `zoom-in` | `fit-view`）。
 *  - **本地化**：`aria-label` / `title` 支持 zh-CN（默认）/ en-US。
 *  - **墙面安全**：由宿主以绝对定位贴右上角挂载；按钮自身可点击（`pointerEvents` 由宿主
 *    控制为 auto）。
 *
 * 作用域护栏（Req 3.7 / 4.4）：本组件**不得** import `useSandboxStore` /
 * `SandboxMonitor` / `MissionWallTaskPanel`，也不引用 `@ant-design/graphs` /
 * `@antv/g6` 运行时。
 */

import type { AppLocale } from "@/lib/locale";

// ─── Component props ─────────────────────────────────────────────────────────

export interface BlueprintWallGraphControlsProps {
  /** 缩小回调（宿主用转发 ref 调 `graph.zoomBy(<1)`）。 */
  onZoomOut: () => void;
  /** 放大回调（宿主用转发 ref 调 `graph.zoomBy(>1)`）。 */
  onZoomIn: () => void;
  /** 适配视图回调（宿主用转发 ref 调 `graph.fitView()`）。 */
  onFitView: () => void;
  /**
   * 是否禁用全部控件（如图实例尚未就绪 / 空图时）。禁用态下按钮渲染 `disabled` 且不回调。
   */
  disabled?: boolean;
  /** 本地化语言；缺省回退 `DEFAULT_CONTROLS_LOCALE`（zh-CN）。 */
  locale?: AppLocale;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** 控件缺省 locale（与墙面其余 overlay 的 `locale ?? "zh-CN"` 口径一致）。 */
const DEFAULT_CONTROLS_LOCALE: AppLocale = "zh-CN";

/** 三个控件动作的稳定标识（同时作为 `data-control-action` 值，供测试断言）。 */
export type WallGraphControlAction = "zoom-out" | "zoom-in" | "fit-view";

/** 每个控件的本地化 aria-label / title。 */
const CONTROL_LABEL: Record<
  WallGraphControlAction,
  Record<AppLocale, string>
> = {
  "zoom-out": { "zh-CN": "缩小", "en-US": "Zoom out" },
  "zoom-in": { "zh-CN": "放大", "en-US": "Zoom in" },
  "fit-view": { "zh-CN": "适配视图", "en-US": "Fit view" },
};

/** 每个控件的图标字符（克制的几何字形，浅色画布友好）。 */
const CONTROL_GLYPH: Record<WallGraphControlAction, string> = {
  "zoom-out": "\u2212", // − minus sign
  "zoom-in": "+",
  "fit-view": "\u26F6", // ⛶ square four corners (fit)
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 解析控件实际使用的 locale（缺省回退 zh-CN）。 */
function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale ?? DEFAULT_CONTROLS_LOCALE;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const groupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 6,
  borderRadius: 12,
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.82), rgba(248,250,252,0.7))",
  border: "1px solid rgba(203,213,225,0.6)",
  boxShadow:
    "0 6px 16px rgba(86,105,126,0.14), inset 0 1px 0 rgba(255,255,255,0.6)",
};

const buttonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 8,
  border: "1px solid rgba(203,213,225,0.7)",
  background: "rgba(255,255,255,0.9)",
  color: "#334155",
  fontSize: 16,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  cursor: "not-allowed",
  opacity: 0.45,
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图右上角外部控件条。
 *
 * 渲染稳定可测的 DOM：根节点带 `data-wall-graph-controls` 与 `data-controls-state`
 * （`enabled` | `disabled`）。三个按钮顺序：缩小 → 放大 → 适配视图，各带
 * `data-control-action`。纯函数、无副作用、确定性输出。
 */
export function BlueprintWallGraphControls({
  onZoomOut,
  onZoomIn,
  onFitView,
  disabled,
  locale,
}: BlueprintWallGraphControlsProps): React.ReactElement {
  const activeLocale = resolveLocale(locale);
  const isDisabled = disabled === true;

  const actions: { action: WallGraphControlAction; onClick: () => void }[] = [
    { action: "zoom-out", onClick: onZoomOut },
    { action: "zoom-in", onClick: onZoomIn },
    { action: "fit-view", onClick: onFitView },
  ];

  return (
    <div
      data-wall-graph-controls
      data-controls-state={isDisabled ? "disabled" : "enabled"}
      style={groupStyle}
    >
      {actions.map(({ action, onClick }) => {
        const label = CONTROL_LABEL[action][activeLocale];
        return (
          <button
            key={action}
            type="button"
            data-control-action={action}
            aria-label={label}
            title={label}
            disabled={isDisabled}
            onClick={isDisabled ? undefined : onClick}
            style={isDisabled ? disabledButtonStyle : buttonStyle}
          >
            <span aria-hidden>{CONTROL_GLYPH[action]}</span>
          </button>
        );
      })}
    </div>
  );
}
