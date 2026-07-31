/**
 * dataref-trend — KPI 卡第二、三层（环比 + 迷你走势线）的锁。
 *
 * 这里钉的都是"编数字"的几条路：前一期是 0 时不能凭空给 +100%、只有一个桶
 * 时不能画一条看起来有趋势的线、走势线的口径必须跟主数字同源。这几条一旦
 * 松了，卡片会体面地撒谎——比不显示更糟。
 */

import { describe, it, expect } from "vitest";
import {
  buildSparklineOption,
  computeDataRefTrend,
  formatTrendLabel,
} from "../live-runtime/dataref-trend";
import type { RuntimeRow } from "../live-runtime/live-runtime";

const row = (id: string, date: string, amount?: number): RuntimeRow => ({
  id,
  values: amount === undefined ? { paidAt: date } : { paidAt: date, amount },
  createdAt: date,
});

describe("computeDataRefTrend · 不声明就不算", () => {
  it("没有 trendFieldRef → null（大多数数字本来就没有时间维度）", () => {
    expect(computeDataRefTrend([row("a", "2026-07-01")], { aggregate: "count" })).toBeNull();
  });

  it("没有行 / 空数组 → null", () => {
    expect(computeDataRefTrend(undefined, { trendFieldRef: "paidAt" })).toBeNull();
    expect(computeDataRefTrend([], { trendFieldRef: "paidAt" })).toBeNull();
  });

  it("一条能解析出日期的都没有 → null，不崩", () => {
    const rows = [
      { id: "a", values: { paidAt: "不是日期" }, createdAt: "" },
      { id: "b", values: {}, createdAt: "" },
    ] as unknown as RuntimeRow[];
    expect(computeDataRefTrend(rows, { trendFieldRef: "paidAt" })).toBeNull();
  });

  it("只有一个桶 → null：没有「前一期」可比，一个点也画不出趋势", () => {
    const rows = [row("a", "2026-07-01"), row("b", "2026-07-01")];
    expect(computeDataRefTrend(rows, { trendFieldRef: "paidAt" })).toBeNull();
  });
});

describe("computeDataRefTrend · 环比", () => {
  it("按天分桶算最后两桶的变化率", () => {
    // 7-01 两条、7-02 三条 → (3-2)/2 = +50%
    const rows = [
      row("a", "2026-07-01"),
      row("b", "2026-07-01"),
      row("c", "2026-07-02"),
      row("d", "2026-07-02"),
      row("e", "2026-07-02"),
    ];
    const t = computeDataRefTrend(rows, { aggregate: "count", trendFieldRef: "paidAt" });
    expect(t).not.toBeNull();
    expect(t!.deltaRatio).toBeCloseTo(0.5, 6);
    expect(t!.direction).toBe("up");
    expect(t!.grain).toBe("day");
  });

  it("下跌方向为 down", () => {
    const rows = [
      row("a", "2026-07-01"),
      row("b", "2026-07-01"),
      row("c", "2026-07-01"),
      row("d", "2026-07-02"),
    ];
    const t = computeDataRefTrend(rows, { aggregate: "count", trendFieldRef: "paidAt" });
    expect(t!.deltaRatio).toBeCloseTo(-2 / 3, 6);
    expect(t!.direction).toBe("down");
  });

  it("前一期是 0 时 deltaRatio 为 null —— 不编 +100% 也不编 +∞", () => {
    // 7-01 有值、7-02 空桶补零、7-03 有值 → 最后两桶是 0 → 5
    const rows = [
      row("a", "2026-07-01", 3),
      row("b", "2026-07-03", 5),
    ];
    const t = computeDataRefTrend(rows, { aggregate: "sum:amount", trendFieldRef: "paidAt" });
    expect(t).not.toBeNull();
    expect(t!.spark.slice(-2)).toEqual([0, 5]);
    expect(t!.deltaRatio).toBeNull();
    expect(t!.direction).toBe("flat");
  });

  it("变化小于 0.5% 视作持平 —— 噪声不该标成上升", () => {
    const rows = [row("a", "2026-07-01", 10000), row("b", "2026-07-02", 10020)];
    const t = computeDataRefTrend(rows, { aggregate: "sum:amount", trendFieldRef: "paidAt" });
    expect(t!.deltaRatio).toBeCloseTo(0.002, 6);
    expect(t!.direction).toBe("flat");
  });
});

describe("computeDataRefTrend · 口径与粒度", () => {
  it("走势线跟主数字同源：aggregate=sum 时画的是每期金额之和，不是条数", () => {
    const rows = [
      row("a", "2026-07-01", 100),
      row("b", "2026-07-01", 200),
      row("c", "2026-07-02", 50),
    ];
    const t = computeDataRefTrend(rows, { aggregate: "sum:amount", trendFieldRef: "paidAt" });
    expect(t!.spark).toEqual([300, 50]);
  });

  it("aggregate 缺省时按条数（与 parseAggregate 的默认一致）", () => {
    const rows = [row("a", "2026-07-01", 100), row("b", "2026-07-01", 200), row("c", "2026-07-02", 50)];
    const t = computeDataRefTrend(rows, { trendFieldRef: "paidAt" });
    expect(t!.spark).toEqual([2, 1]);
  });

  it("trendGrain=month 按月分桶", () => {
    const rows = [row("a", "2026-05-10"), row("b", "2026-06-11"), row("c", "2026-06-20")];
    const t = computeDataRefTrend(rows, { trendFieldRef: "paidAt", trendGrain: "month" });
    expect(t!.grain).toBe("month");
    expect(t!.spark).toEqual([1, 2]);
  });

  it("非法 grain 退回 day，不抛", () => {
    const rows = [row("a", "2026-07-01"), row("b", "2026-07-02")];
    expect(computeDataRefTrend(rows, { trendFieldRef: "paidAt", trendGrain: "quarter" })!.grain).toBe(
      "day"
    );
  });

  it("桶太多时自动变粗，回传的是**实际**粒度而不是入参粒度", () => {
    // 跨 19 个月按天 = 547 桶，超过 MAX_TREND_BUCKETS(60)，退 week(79) 仍超，
    // 退到 month(19) 才放得下。此时文案必须是"较上月"——第一版这里直接回传
    // 入参 grain，按月分的桶配一句"较前一日"，真跑出来就是错的。
    const rows = Array.from({ length: 24 }, (_, i) =>
      row(`r${i}`, `2025-${String((i % 12) + 1).padStart(2, "0")}-15`)
    );
    rows.push(row("last", "2026-07-15"));
    const t = computeDataRefTrend(rows, { trendFieldRef: "paidAt", trendGrain: "day" });
    expect(t!.grain).toBe("month");
    expect(formatTrendLabel(t!)).toContain("较上月");
  });

  it("走势线最多 24 个点 —— 迷你图上再多就是一团糊", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`r${i}`, `2026-06-${String((i % 30) + 1).padStart(2, "0")}`)
    );
    const t = computeDataRefTrend(rows, { trendFieldRef: "paidAt" });
    expect(t!.spark.length).toBeLessThanOrEqual(24);
    expect(t!.spark.length).toBeGreaterThan(1);
  });
});

describe("formatTrendLabel", () => {
  const mk = (
    deltaRatio: number | null,
    grain: "day" | "week" | "month" = "day",
    direction: "up" | "down" | "flat" = "up"
  ) => ({ spark: [1, 2], deltaRatio, direction, grain });

  it("按粒度换前缀", () => {
    expect(formatTrendLabel(mk(0.12))).toBe("较前一日 12%");
    expect(formatTrendLabel(mk(0.12, "week"))).toBe("较上周 12%");
    expect(formatTrendLabel(mk(0.12, "month"))).toBe("较上月 12%");
  });

  it("算不出时显示破折号，不编数字", () => {
    expect(formatTrendLabel(mk(null))).toBe("较前一日 —");
  });

  it("小于 10% 保留一位小数，大于等于 10% 取整", () => {
    expect(formatTrendLabel(mk(0.034))).toBe("较前一日 3.4%");
    expect(formatTrendLabel(mk(0.345))).toBe("较前一日 35%");
  });

  it("取绝对值 —— 方向靠箭头和颜色表达，文字里不重复一个负号", () => {
    expect(formatTrendLabel(mk(-0.2))).toBe("较前一日 20%");
  });

  it("判成持平就直说持平，不写「0.0%」（真跑截图里出过这张卡）", () => {
    expect(formatTrendLabel(mk(0, "day", "flat"))).toBe("较前一日持平");
    // 0.4% 会被四舍五入成 "0.4%" 却配一个持平箭头——文字必须跟方向走
    expect(formatTrendLabel(mk(0.004, "week", "flat"))).toBe("较上周持平");
  });

  it("涨幅极大时改说倍数（1200% 读起来没意义）", () => {
    expect(formatTrendLabel(mk(49))).toBe("较前一日 50.0 倍");
  });
});

describe("buildSparklineOption", () => {
  it("点数不足 2 时不出图", () => {
    expect(buildSparklineOption([], "#e05d38")).toBeNull();
    expect(buildSparklineOption([5], "#e05d38")).toBeNull();
  });

  it("没有任何坐标系装饰 —— sparkline 加了轴就成了一张正经图表", () => {
    const opt = buildSparklineOption([1, 2, 3], "#e05d38") as Record<string, any>;
    expect(opt.xAxis.show).toBe(false);
    expect(opt.yAxis.show).toBe(false);
    expect(opt.tooltip.show).toBe(false);
    expect(opt.grid).toEqual({ left: 0, right: 0, top: 2, bottom: 0 });
  });

  it("线色用传进来的主题色，面积渐变到全透明", () => {
    const opt = buildSparklineOption([1, 2, 3], "#e05d38") as Record<string, any>;
    const series = opt.series[0];
    expect(series.type).toBe("line");
    expect(series.symbol).toBe("none");
    expect(series.lineStyle.color).toBe("#e05d38");
    expect(series.areaStyle.color.colorStops).toEqual([
      { offset: 0, color: "#e05d3844" },
      { offset: 1, color: "#e05d3800" },
    ]);
  });

  it("y 轴按数据范围而不是从 0 起 —— 迷你图要的是形状不是绝对量级", () => {
    const opt = buildSparklineOption([100, 101, 102], "#e05d38") as Record<string, any>;
    expect(opt.yAxis.min).toBe("dataMin");
    expect(opt.yAxis.max).toBe("dataMax");
  });
});
