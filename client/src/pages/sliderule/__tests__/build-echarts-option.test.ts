/**
 * build-echarts-option 纯函数测试 — 不需要 canvas / echarts 运行时。
 * 锁三件事：分组求值正确、dataviz 规范落点（单色/直标/白缝/折叠）、
 * 空数据 fail-closed 返回 null。
 */
import { describe, it, expect } from "vitest";
import {
  buildEchartsOption,
  buildEntityRowcountOption,
  buildInstanceStatusOption,
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

  // 2026-07-28：真跑截图逮到的——环图图例上写着 `refunded 2` / `unpaid 3`，
  // 那是模型内部的取值 id，不是给用户看的词。表单 Select 存的就是 id，
  // 一路原样送进图例。
  it("enum 维度：图例出声明的 label，不是取值 id", () => {
    const spec: AppPageChartSchema = {
      ...countSpec,
      dimensionOptions: [
        { id: "paid", label: "已缴费", tone: "success" },
        { id: "unpaid", label: "待缴费", tone: "warning" },
      ],
    };
    const g = groupRowsForChart(spec, [
      row({ status: "paid" }),
      row({ status: "paid" }),
      row({ status: "unpaid" }),
    ]);
    expect(g.categories).toEqual(["已缴费", "待缴费"]);
    expect(g.values).toEqual([2, 1]);
  });

  it("声明里查不到的取值原样显示（不猜不藏，与 FieldValue 同约定）", () => {
    const spec: AppPageChartSchema = {
      ...countSpec,
      dimensionOptions: [{ id: "paid", label: "已缴费", tone: "success" }],
    };
    const g = groupRowsForChart(spec, [row({ status: "paid" }), row({ status: "legacy_x" })]);
    expect(g.categories).toContain("已缴费");
    expect(g.categories).toContain("legacy_x");
  });

  it("先分组后换名：两个取值共用一个 label 时不合并、数字不虚高", () => {
    // 退化声明（label 撞车）本身是模型的问题，但渲染层不能因此把两类静默
    // 并成一类——那会让计数凭空变大。分组键始终是原值。
    const spec: AppPageChartSchema = {
      ...countSpec,
      dimensionOptions: [
        { id: "a", label: "待办", tone: "default" },
        { id: "b", label: "待办", tone: "default" },
      ],
    };
    const g = groupRowsForChart(spec, [row({ status: "a" }), row({ status: "b" })]);
    expect(g.categories).toEqual(["待办", "待办"]);
    expect(g.values).toEqual([1, 1]);
  });

  it("排序按原值不按 label —— enum id 常自带业务次序", () => {
    const spec: AppPageChartSchema = {
      ...countSpec,
      type: "line",
      dimensionOptions: [
        { id: "s1_draft", label: "草稿", tone: "default" },
        { id: "s2_review", label: "审核中", tone: "processing" },
        { id: "s3_done", label: "已完成", tone: "success" },
      ],
    };
    const g = groupRowsForChart(spec, [
      row({ status: "s3_done" }),
      row({ status: "s1_draft" }),
      row({ status: "s2_review" }),
    ]);
    expect(g.categories).toEqual(["草稿", "审核中", "已完成"]);
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

describe("工作台内置图 builders（切 ECharts）", () => {
  it("buildEntityRowcountOption：横向单色细条，大值在上，全零/空 → null", () => {
    expect(buildEntityRowcountOption([])).toBeNull();
    expect(buildEntityRowcountOption([{ label: "a", value: 0 }])).toBeNull();
    const opt = buildEntityRowcountOption([
      { label: "会员卡", value: 3 },
      { label: "私教", value: 1 },
    ])!;
    expect((opt.yAxis as any).type).toBe("category"); // 横向：类目在 y 轴
    expect((opt.yAxis as any).data).toEqual(["私教", "会员卡"]); // 倒序 → 大值在上
    const series = (opt.series as any[])[0];
    expect(series.data).toEqual([1, 3]);
    expect(series.itemStyle.color).toBe("#1677ff");
    expect(series.itemStyle.borderRadius).toEqual([0, 4, 4, 0]); // 数据端圆角
    expect(series.label).toMatchObject({ show: true, position: "right", color: "#262626" });
  });

  it("buildInstanceStatusOption：保留状态色 + 中心合计 + 2px 白缝，无实例 → null", () => {
    expect(buildInstanceStatusOption({})).toBeNull();
    expect(buildInstanceStatusOption({ running: 0 })).toBeNull();
    const opt = buildInstanceStatusOption({ running: 2, completed: 1, rejected: 1 })!;
    expect((opt.title as any).text).toBe("4"); // 中心合计
    const data = (opt.series as any[])[0].data as any[];
    expect(data.map((d) => [d.name, d.itemStyle.color])).toEqual([
      ["进行中", "#1677ff"],
      ["已完成", "#52c41a"],
      ["已驳回", "#ff4d4f"],
    ]); // 状态色是保留色，不混分类色序
    for (const d of data) expect(d.itemStyle.borderWidth).toBe(2);
    // 值为 0 的状态不出片（不画空段）
    const opt2 = buildInstanceStatusOption({ running: 5 })!;
    expect(((opt2.series as any[])[0].data as any[]).map((d) => d.name)).toEqual(["进行中"]);
  });
});
