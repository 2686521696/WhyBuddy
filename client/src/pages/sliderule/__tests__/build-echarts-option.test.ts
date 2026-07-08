/**
 * build-echarts-option 纯函数测试 — 不需要 canvas / echarts 运行时。
 * 锁三件事：分组求值正确、dataviz 规范落点（单色/直标/白缝/折叠）、
 * 空数据 fail-closed 返回 null。
 */
import { describe, it, expect } from "vitest";
import {
  buildEchartsOption,
  groupRowsForChart,
  CATEGORICAL_ORDER,
} from "../live-runtime/build-echarts-option";
import type { AppPageChartSchema } from "../live-runtime/app-runtime-schema";
import type { RuntimeRow } from "../live-runtime/live-runtime";

const row = (values: Record<string, unknown>, id = Math.random().toString(36).slice(2)): RuntimeRow => ({
  id,
  values,
  createdAt: "2026-07-08T00:00:00Z",
});

const countSpec: AppPageChartSchema = {
  id: "c1",
  label: "状态分布",
  type: "bar",
  entityId: "task",
  dimensionFieldId: "status",
  dimensionLabel: "状态",
  metric: "count",
  metricLabel: "数量",
};

describe("groupRowsForChart", () => {
  it("count：按维度值分组计数，bar 按指标降序", () => {
    const rows = [
      row({ status: "done" }),
      row({ status: "running" }),
      row({ status: "done" }),
      row({ status: "" }), // 空值 → （未填）
    ];
    const g = groupRowsForChart(countSpec, rows);
    expect(g.categories[0]).toBe("done"); // 2 条，降序在前
    expect(g.values[0]).toBe(2);
    expect(g.categories).toContain("（未填）");
  });

  it("sum：对指标字段求和，非数字按 0 计", () => {
    const spec: AppPageChartSchema = {
      ...countSpec,
      metric: "sum",
      metricFieldId: "amount",
      metricLabel: "金额",
    };
    const g = groupRowsForChart(spec, [
      row({ status: "a", amount: 10 }),
      row({ status: "a", amount: "5" }),
      row({ status: "b", amount: "not-a-number" }),
    ]);
    expect(g.values[g.categories.indexOf("a")]).toBe(15);
    expect(g.values[g.categories.indexOf("b")]).toBe(0);
  });

  it("line：按维度值排序（日期/阶段有序维度）", () => {
    const spec: AppPageChartSchema = { ...countSpec, type: "line" };
    const g = groupRowsForChart(spec, [
      row({ status: "2026-07-03" }),
      row({ status: "2026-07-01" }),
      row({ status: "2026-07-02" }),
    ]);
    expect(g.categories).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
});

describe("buildEchartsOption", () => {
  it("空行数据 → null（诚实空态，不画空坐标系）", () => {
    expect(buildEchartsOption(countSpec, [])).toBeNull();
  });

  it("bar：单色细柱 + 顶部墨色直标 + 4px 圆角柱端", () => {
    const opt = buildEchartsOption(countSpec, [row({ status: "done" })])!;
    const series = (opt.series as any[])[0];
    expect(series.type).toBe("bar");
    expect(series.itemStyle.color).toBe("#1677ff"); // 单指标单色，不按名次配色
    expect(series.itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    expect(series.barMaxWidth).toBe(22);
    expect(series.label).toMatchObject({ show: true, color: "#262626" }); // 文字墨色
  });

  it("line：2px 线宽 + ≥8px 白描边端点 + 端点直标", () => {
    const spec: AppPageChartSchema = { ...countSpec, type: "line" };
    const opt = buildEchartsOption(spec, [row({ status: "a" }), row({ status: "b" })])!;
    const series = (opt.series as any[])[0];
    expect(series.lineStyle.width).toBe(2);
    expect(series.symbolSize).toBeGreaterThanOrEqual(8);
    expect(series.itemStyle.borderWidth).toBe(2);
    expect(series.endLabel.show).toBe(true);
  });

  it("pie：固定次序分类色 + 2px 白缝 + 每片直标；>5 类折叠进灰色「其他」", () => {
    const spec: AppPageChartSchema = { ...countSpec, type: "pie" };
    const rows = ["a", "b", "c", "d", "e", "f", "g"].flatMap((s, i) =>
      Array.from({ length: 7 - i }, () => row({ status: s }))
    );
    const opt = buildEchartsOption(spec, rows)!;
    const data = (opt.series as any[])[0].data as any[];
    expect(data).toHaveLength(5); // 7 类 → 4 类 + 其他
    expect(data[data.length - 1].name).toBe("其他");
    expect(data[data.length - 1].itemStyle.color).toBe("#bfbfbf"); // 折叠项灰色
    expect(data[data.length - 1].value).toBe(3 + 2 + 1); // e+f+g
    for (const [i, d] of data.slice(0, 4).entries()) {
      expect(d.itemStyle.color).toBe(CATEGORICAL_ORDER[i]); // 固定序取色，不循环生成
      expect(d.itemStyle.borderWidth).toBe(2); // 白缝分片
    }
    const label = (opt.series as any[])[0].label;
    expect(label.formatter).toBe("{b} {c}"); // 名称+数值直标（对比度 WARN 的补偿）
    expect(label.color).toBe("#262626");
  });
});
