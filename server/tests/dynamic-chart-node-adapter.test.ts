import { describe, expect, it } from "vitest";

import { executeDynamicChartNode } from "../routes/node-adapters/dynamic-chart-node-adapter.js";

describe("executeDynamicChartNode", () => {
  it("normalizes Excel-compatible headers and rows into a bar chart ui payload", async () => {
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        title: "季度营收对比",
        dataset: {
          sheetName: "Q1",
          headers: ["月份", "营收", "成本"],
          rows: [
            ["一月", 120, 80],
            ["二月", 150, 92],
            ["三月", 180, 110],
          ],
        },
        context: {
          sourceNode: "excel_read",
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      nodeType: "dynamic_chart",
      output: {
        status: "completed",
        chartType: "bar",
        title: "季度营收对比",
        dataset: {
          kind: "table",
          sheetName: "Q1",
          labelKey: "月份",
          valueKeys: ["营收", "成本"],
          rowCount: 3,
          categories: ["一月", "二月", "三月"],
        },
        ui: {
          renderer: "recharts",
          component: "BarChart",
          chartType: "bar",
          categoryKey: "月份",
          valueKeys: ["营收", "成本"],
          series: [
            {
              key: "营收",
              label: "营收",
              color: "var(--chart-1)",
            },
            {
              key: "成本",
              label: "成本",
              color: "var(--chart-2)",
            },
          ],
        },
        context: {
          sourceNode: "excel_read",
          dynamicChart: {
            chartType: "bar",
            title: "季度营收对比",
          },
        },
        observability: {
          eventKey: "ui.dynamic_chart",
          nodeType: "dynamic_chart",
          chartType: "bar",
          datasetKind: "table",
          rowCount: 3,
          seriesCount: 2,
          artifactEnabled: false,
        },
      },
    });
    expect(result.output.ui.data).toEqual([
      { 月份: "一月", 营收: 120, 成本: 80 },
      { 月份: "二月", 营收: 150, 成本: 92 },
      { 月份: "三月", 营收: 180, 成本: 110 },
    ]);
  });

  it("maps summary statistics into a pie chart and returns inline artifact payload when enabled", async () => {
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        chartType: "auto",
        title: "渠道占比",
        dataset: {
          kind: "summary",
          values: {
            微信: 45,
            飞书: 30,
            邮件: 25,
          },
        },
        artifact: {
          enabled: true,
          fileName: "channel-share",
        },
      },
    });

    expect(result.output.chartType).toBe("pie");
    expect(result.output.ui.component).toBe("PieChart");
    expect(result.output.dataset.rows).toEqual([
      { label: "微信", value: 45, fill: "var(--chart-1)" },
      { label: "飞书", value: 30, fill: "var(--chart-2)" },
      { label: "邮件", value: 25, fill: "var(--chart-3)" },
    ]);
    expect(result.output.artifact).toMatchObject({
      kind: "inline_json",
      name: "channel_share.json",
      mimeType: "application/json",
      content: {
        chartType: "pie",
        title: "渠道占比",
        dataset: {
          kind: "summary",
        },
        ui: {
          component: "PieChart",
        },
      },
    });
  });

  it("supports explicit line chart mapping for series datasets", async () => {
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        chartType: "line",
        dataset: {
          kind: "series",
          categories: ["周一", "周二", "周三"],
          series: [
            {
              name: "访问量",
              data: [100, 120, 135],
            },
            {
              name: "转化量",
              data: [20, 25, 28],
            },
          ],
        },
      },
    });

    expect(result.output.chartType).toBe("line");
    expect(result.output.ui.component).toBe("LineChart");
    expect(result.output.dataset).toMatchObject({
      kind: "series",
      labelKey: "category",
      valueKeys: ["访问量", "转化量"],
      categories: ["周一", "周二", "周三"],
    });
    expect(result.output.ui.data).toEqual([
      { category: "周一", 访问量: 100, 转化量: 20 },
      { category: "周二", 访问量: 120, 转化量: 25 },
      { category: "周三", 访问量: 135, 转化量: 28 },
    ]);
  });
});
