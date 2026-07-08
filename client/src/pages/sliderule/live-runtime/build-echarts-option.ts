/**
 * build-echarts-option — 库无关图表声明（AppPageChartSchema）+ 运行时行数据
 * → ECharts option。纯函数：无 echarts 依赖、无副作用，单测不需要 canvas。
 *
 * dataviz 规范落点（与工作台手绘 SVG 图同一套约定）：
 * - 文字一律墨色 token（INK），不用系列色写字；
 * - bar/line 是单指标 → 单色 #1677ff（颜色跟实体不跟名次），细标记、
 *   柱端 4px 圆角、线宽 2px、点 ≥8px 白描边；
 * - pie 用固定次序分类色（已过 validate_palette.js：CVD ΔE 47.3，
 *   cyan/orange 对白底对比不足 → 以每片"名称 数值"直标补偿）；
 *   >5 类折叠进「其他」，2px 白缝分片；
 * - 网格/轴线退后（#f0f0f0），tooltip 默认开。
 */

import type { AppPageChartSchema } from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";

const INK = { label: "#595959", value: "#262626", faint: "#bfbfbf" };
const SINGLE_HUE = "#1677ff";
/** 固定次序分类色（validate_palette.js 全查通过；只按序取用，不循环生成） */
export const CATEGORICAL_ORDER = ["#1677ff", "#13c2c2", "#fa8c16", "#722ed1", "#eb2f96"];
const OTHER_GRAY = "#bfbfbf";
const MAX_PIE_SLICES = 5;

export interface ChartGroupedData {
  categories: string[];
  values: number[];
}

/** 按维度字段分组求值：count = 每组行数；sum = 每组对指标字段求和。 */
export function groupRowsForChart(
  spec: AppPageChartSchema,
  rows: RuntimeRow[]
): ChartGroupedData {
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const raw = row.values?.[spec.dimensionFieldId];
    const category =
      raw === undefined || raw === null || String(raw).trim() === ""
        ? "（未填）"
        : String(raw);
    let delta = 1;
    if (spec.metric === "sum" && spec.metricFieldId) {
      const n = Number(row.values?.[spec.metricFieldId]);
      delta = Number.isFinite(n) ? n : 0;
    }
    byCategory.set(category, (byCategory.get(category) ?? 0) + delta);
  }
  const entries = [...byCategory.entries()];
  // line 的维度通常有序（日期/阶段）→ 按维度值排序；bar/pie 按指标降序更可读。
  if (spec.type === "line") {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => b[1] - a[1]);
  }
  return { categories: entries.map((e) => e[0]), values: entries.map((e) => e[1]) };
}

/** >MAX_PIE_SLICES 类折叠进「其他」（灰色，排最后）——分类色只按固定序取用。 */
function foldForPie(data: ChartGroupedData): ChartGroupedData {
  if (data.categories.length <= MAX_PIE_SLICES) return data;
  const kept = MAX_PIE_SLICES - 1;
  const otherSum = data.values.slice(kept).reduce((s, v) => s + v, 0);
  return {
    categories: [...data.categories.slice(0, kept), "其他"],
    values: [...data.values.slice(0, kept), otherSum],
  };
}

/**
 * 声明 + 行数据 → ECharts option（普通对象）。行数据为空返回 null，
 * 调用方渲染诚实空态而不是空坐标系。
 */
export function buildEchartsOption(
  spec: AppPageChartSchema,
  rows: RuntimeRow[]
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const grouped = groupRowsForChart(spec, rows);
  if (grouped.categories.length === 0) return null;

  const axisText = { color: INK.label, fontSize: 11 };
  const base = {
    animation: false,
    tooltip: { confine: true, textStyle: { color: INK.value, fontSize: 11 } },
  };

  if (spec.type === "pie") {
    const folded = foldForPie(grouped);
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          data: folded.categories.map((name, i) => ({
            name,
            value: folded.values[i],
            itemStyle: {
              color: name === "其他" ? OTHER_GRAY : CATEGORICAL_ORDER[i % CATEGORICAL_ORDER.length],
              borderColor: "#fff",
              borderWidth: 2, // 2px 白缝分片，不靠颜色分界
            },
          })),
          // 每片直标「名称 数值」（墨色文字）——同时是对比度 WARN 的补偿编码
          label: { color: INK.value, fontSize: 11, formatter: "{b} {c}" },
          labelLine: { lineStyle: { color: INK.faint } },
        },
      ],
    };
  }

  const categoryAxis = {
    type: "category",
    data: grouped.categories,
    axisLabel: axisText,
    axisLine: { lineStyle: { color: "#f0f0f0" } },
    axisTick: { show: false },
  };
  const valueAxis = {
    type: "value",
    axisLabel: axisText,
    splitLine: { lineStyle: { color: "#f0f0f0" } },
  };

  if (spec.type === "line") {
    return {
      ...base,
      tooltip: { ...base.tooltip, trigger: "axis" },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: categoryAxis,
      yAxis: valueAxis,
      series: [
        {
          type: "line",
          name: spec.metricLabel,
          data: grouped.values,
          lineStyle: { width: 2, color: SINGLE_HUE },
          itemStyle: { color: SINGLE_HUE, borderColor: "#fff", borderWidth: 2 },
          symbolSize: 8,
          // 端点直标（选择性直标，不逐点标数）
          endLabel: { show: true, color: INK.value, fontSize: 11 },
        },
      ],
    };
  }

  return {
    ...base,
    tooltip: { ...base.tooltip, trigger: "axis" },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: categoryAxis,
    yAxis: valueAxis,
    series: [
      {
        type: "bar",
        name: spec.metricLabel,
        data: grouped.values,
        barMaxWidth: 22, // 细柱
        itemStyle: { color: SINGLE_HUE, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: INK.value, fontSize: 11 },
      },
    ],
  };
}
