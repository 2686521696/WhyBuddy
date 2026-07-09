/**
 * BlueprintWallMetricsRail - 蓝图墙面流程图左侧遥测栏（纯 React 组件）。
 *
 * 把 `deriveBlueprintWallProcessData(...).metrics` 的四个遥测字段
 * （`tokenBurn` / `sourceCount` / `remainingPoints` / `elapsedMs`）渲染为参考图里的
 * 左侧竖向计数栏：BURN / SOURCES / REMAINING / TIME。
 *
 * 设计要点（对应 design「### `BlueprintWallMetricsRail`」+ Req 7.1 / 7.2 / 7.3）：
 *  - **唯一数据源**：所有遥测数值来自传入的 `BlueprintWallMetrics`，本组件不读取任何
 *    store / 网络 / mission-first 沙箱状态，也不臆造数值（Req 7.1）。
 *  - **缺失即占位**：当某字段为 `null` / `undefined` 时，渲染 muted 占位符 `--`，绝不
 *    伪造数值（Req 7.2）。
 *  - **首版占位口径**：当前数据 deriver 对 `tokenBurn` / `sourceCount` /
 *    `remainingPoints` / `elapsedMs` 恒返回 `null`，因此首版这四项**都**会渲染为 `--`
 *    占位（Req 7.3）。本组件仍按「值存在则展示、缺失则占位」实现，待后续遥测 spec
 *    扩展 deriver 输入后即可零改动地显示真实数值。
 *  - **纯函数组件**：无 hook、无副作用、确定性输出，可被 `react-dom/server`
 *    `renderToStaticMarkup` 直接渲染（Task 5.4 / 本组件测试）。
 *  - **本地化**：支持 `zh-CN`（默认）与 `en-US` 两套标签 / 单位文案。
 *
 * 作用域护栏（Req 3.7 / 4.4）：本组件**不得** import `useSandboxStore` /
 * `SandboxMonitor` / `MissionWallTaskPanel`。
 */

import type { AppLocale } from "@/lib/locale";

import type { BlueprintWallMetrics } from "./blueprint-wall-process-data";

// ─── Component props ─────────────────────────────────────────────────────────

export interface BlueprintWallMetricsRailProps {
  /** `Wall_Process_Data.metrics`（唯一遥测数据源）。 */
  metrics: BlueprintWallMetrics;
  /** 本地化语言；缺省回退 `DEFAULT_RAIL_LOCALE`（zh-CN）。 */
  locale?: AppLocale;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** 遥测栏缺省 locale（与 deriver 的 `locale ?? "zh-CN"` 口径一致）。 */
const DEFAULT_RAIL_LOCALE: AppLocale = "zh-CN";

/** 缺失数值的 muted 占位符（Req 7.2）。 */
export const METRIC_PLACEHOLDER = "--";

/** 遥测栏支持的四个遥测字段 key（对应 design 参考图：BURN/SOURCES/REMAINING/TIME）。 */
type TelemetryMetricKey = "burn" | "sources" | "remaining" | "time";

interface TelemetryRowDescriptor {
  key: TelemetryMetricKey;
  /** 类目标签（本地化）。 */
  label: Record<AppLocale, string>;
  /** 数值单位（本地化）；占位时不展示单位。 */
  unit: Record<AppLocale, string>;
}

/** 四行遥测行的描述（顺序与 design 参考图一致）。 */
const TELEMETRY_ROWS: readonly TelemetryRowDescriptor[] = [
  {
    key: "burn",
    label: { "zh-CN": "消耗", "en-US": "BURN" },
    unit: { "zh-CN": "tokens", "en-US": "tokens" },
  },
  {
    key: "sources",
    label: { "zh-CN": "来源", "en-US": "SOURCES" },
    unit: { "zh-CN": "条", "en-US": "sources" },
  },
  {
    key: "remaining",
    label: { "zh-CN": "剩余", "en-US": "REMAINING" },
    unit: { "zh-CN": "点", "en-US": "points" },
  },
  {
    key: "time",
    label: { "zh-CN": "用时", "en-US": "TIME" },
    unit: { "zh-CN": "min", "en-US": "min" },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 解析遥测栏实际使用的 locale（缺省回退 zh-CN）。 */
function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale ?? DEFAULT_RAIL_LOCALE;
}

/**
 * 解析某个遥测字段当前的数值文本与占位状态。
 *
 * 规则（Req 7.2）：字段为 `null` / `undefined` → 占位 `--`、`isPlaceholder = true`、
 * 不展示单位；否则展示确定性格式化后的数值文本（不引入区域分隔符，保证可测）。
 */
function resolveMetricValue(
  key: TelemetryMetricKey,
  metrics: BlueprintWallMetrics
): { text: string; isPlaceholder: boolean } {
  const placeholder = {
    text: METRIC_PLACEHOLDER,
    isPlaceholder: true,
  } as const;

  switch (key) {
    case "burn": {
      const value = metrics.tokenBurn;
      if (value == null) return placeholder;
      return { text: String(value), isPlaceholder: false };
    }
    case "sources": {
      const value = metrics.sourceCount;
      if (value == null) return placeholder;
      return { text: String(value), isPlaceholder: false };
    }
    case "remaining": {
      const value = metrics.remainingPoints;
      if (value == null) return placeholder;
      return { text: String(value), isPlaceholder: false };
    }
    case "time": {
      const value = metrics.elapsedMs;
      if (value == null) return placeholder;
      // ms → 分钟（一位小数），对齐参考图 "5.7 min" 口径。
      return { text: (value / 60000).toFixed(1), isPlaceholder: false };
    }
    default:
      return placeholder;
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const railStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 18,
  padding: "16px 14px",
  minWidth: 132,
  borderRadius: 12,
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(248,250,252,0.55))",
  border: "1px solid rgba(203,213,225,0.55)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "#94a3b8",
};

const valueRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 5,
};

const valueStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1.1,
  color: "#1e293b",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

/** 占位数值（`--`）的弱化样式（muted，Req 7.2）。 */
const placeholderValueStyle: React.CSSProperties = {
  ...valueStyle,
  color: "#cbd5e1",
  fontWeight: 600,
};

const unitStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "#94a3b8",
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图左侧遥测栏。
 *
 * 渲染稳定可测的 DOM：根节点带 `data-wall-metrics-rail`，每行带 `data-metric-key`
 * 与 `data-metric-state`（`value` | `placeholder`）。纯函数、无副作用、确定性输出。
 */
export function BlueprintWallMetricsRail({
  metrics,
  locale,
}: BlueprintWallMetricsRailProps): React.ReactElement {
  const activeLocale = resolveLocale(locale);

  return (
    <div data-wall-metrics-rail style={railStyle}>
      {TELEMETRY_ROWS.map(row => {
        const resolved = resolveMetricValue(row.key, metrics);
        return (
          <div
            key={row.key}
            data-metric-key={row.key}
            data-metric-state={resolved.isPlaceholder ? "placeholder" : "value"}
            style={rowStyle}
          >
            <span style={labelStyle}>{row.label[activeLocale]}</span>
            <span style={valueRowStyle}>
              <span
                style={
                  resolved.isPlaceholder ? placeholderValueStyle : valueStyle
                }
              >
                {resolved.text}
              </span>
              {resolved.isPlaceholder ? null : (
                <span style={unitStyle}>{row.unit[activeLocale]}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
