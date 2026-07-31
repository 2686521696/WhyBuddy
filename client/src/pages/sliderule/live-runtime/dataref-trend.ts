/**
 * dataref-trend — KPI 数字的另外两层：环比 + 迷你走势线。
 *
 * 起因是拿 LLM 生成的参考图跟真实渲染对照：参考图上每张 KPI 卡都是
 * 「大数字 + 较昨日 ↑12% + 卡底一条迷你走势线」三层，我们只出得了第一层。
 * 形状对标 ant-design/pro-components 的 StatisticCard——Statistic 的
 * `trend: 'up' | 'down'` + `description` 文案，加 StatisticCard 的 `chart`
 * 槽位（`chartPlacement: 'right' | 'bottom' | 'left'`）。那是这类卡片的成熟
 * 长相，不自己发明一套。
 *
 * 两层共用同一份时间分桶（复用 block-data.ts 的 buildTrendSeries，那边已经
 * 处理了本地时区、周一起周、桶数超限自动变粗、缺失桶补零这些真正容易错的
 * 事），所以 schema 上也只需要一个 trendFieldRef——分成两个声明只会让模型
 * 多记一套规则。
 *
 * 纯函数，不碰 React，便于单测。
 */

import { buildTrendSeries, parseAggregate, type TimeGrain } from "./block-data";
import type { RuntimeRow } from "./live-runtime";

export interface DataRefTrend {
  /** 走势线的取值序列（按时间正序，已补零） */
  spark: number[];
  /** 环比：最后一个桶相对前一个桶的变化率；算不出为 null */
  deltaRatio: number | null;
  /** 方向。deltaRatio 为 null，或变化小到可以忽略时为 "flat" */
  direction: "up" | "down" | "flat";
  /** 实际使用的粒度（桶太多时 buildTrendSeries 会自动变粗） */
  grain: TimeGrain;
}

/** 小于这个变化率视作持平——0.5% 的波动标成"上升"是噪声不是信号。 */
const FLAT_THRESHOLD = 0.005;

/** 走势线最多取最近多少个桶。超过就只画尾部——迷你图上 60 个点已经是糊的。 */
const MAX_SPARK_POINTS = 24;

/**
 * 算出一个 dataRef 的环比与走势序列。
 *
 * 返回 null 的情形（都不是错误，是"这个数没有时间维度可讲"）：
 * - 没声明 trendFieldRef
 * - 行数据里一条能解析出日期的都没有
 * - 只有一个桶（没有"前一期"可比，走势线也画不出趋势）
 */
export function computeDataRefTrend(
  rows: RuntimeRow[] | undefined,
  spec: {
    aggregate?: string | null;
    trendFieldRef?: string | null;
    trendGrain?: string | null;
  }
): DataRefTrend | null {
  const timeField = String(spec.trendFieldRef ?? "").trim();
  if (!timeField || !rows || rows.length === 0) return null;

  const grain: TimeGrain =
    spec.trendGrain === "week" || spec.trendGrain === "month"
      ? spec.trendGrain
      : "day";
  // aggregate 与主数字同源：主数字是「金额总和」，走势线也该是每期的金额总和，
  // 不能一个看总额一个看条数——那是两张不同的图挂在同一张卡上。
  const series = buildTrendSeries(rows, timeField, grain, parseAggregate(spec.aggregate));
  if (!series || series.values.length < 2) return null;

  const spark = series.values.slice(-MAX_SPARK_POINTS);
  const last = series.values[series.values.length - 1];
  const prev = series.values[series.values.length - 2];

  // 前一期是 0 时算不出百分比（除零）。此时如实给 null——显示成"较上期 —"，
  // 而不是编一个 +100% 或 +∞ 出来。
  let deltaRatio: number | null = null;
  if (Number.isFinite(last) && Number.isFinite(prev) && prev !== 0) {
    deltaRatio = (last - prev) / Math.abs(prev);
  }

  let direction: DataRefTrend["direction"] = "flat";
  if (deltaRatio !== null && Math.abs(deltaRatio) >= FLAT_THRESHOLD) {
    direction = deltaRatio > 0 ? "up" : "down";
  }

  // 回传 series.grain 而不是入参 grain：桶太多时 buildTrendSeries 会自己退到更
  // 粗的粒度，此时按月分的桶配一句"较前一日"就是错的文案。
  return { spark, deltaRatio, direction, grain: series.grain };
}

const GRAIN_LABEL: Record<TimeGrain, string> = {
  day: "较前一日",
  week: "较上周",
  month: "较上月",
};

/** 环比的展示文案。算不出时给"较上期 —"，不编数字。 */
export function formatTrendLabel(trend: DataRefTrend): string {
  const prefix = GRAIN_LABEL[trend.grain] ?? "较上期";
  if (trend.deltaRatio === null) return `${prefix} —`;
  // 判成持平就直说"持平"。真跑截图里出过一张"较前一日 0.0%"——技术上没错，
  // 但没人这么读数；而且 0.4% 会被四舍五入显示成 0.4% 却标着"持平"箭头，
  // 文字和箭头对不上。方向判定是唯一真相，文案跟着它走。
  if (trend.direction === "flat") return `${prefix}持平`;
  const pct = Math.abs(trend.deltaRatio * 100);
  // 变化极大时（比如从 1 涨到 500）百分比读起来没意义，改说倍数
  const body =
    pct >= 1000
      ? `${(Math.abs(trend.deltaRatio) + 1).toFixed(1)} 倍`
      : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  return `${prefix} ${body}`;
}

/**
 * 迷你走势线的 ECharts option。
 *
 * 刻意做成"只有线、没有任何坐标系装饰"——sparkline 的定义就是嵌在文字/卡片
 * 里的微型图，加了轴和网格就成了一张正经图表，会把 KPI 卡撑散。
 */
export function buildSparklineOption(
  values: number[],
  color: string
): Record<string, unknown> | null {
  if (values.length < 2) return null;
  return {
    animation: false,
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: "dataMin", max: "dataMax" },
    tooltip: { show: false },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1.5, color },
        // 面积渐变到透明——参考图上那条线就是这个做法，纯线条在浅底卡片上太飘
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${color}44` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
      },
    ],
  };
}
