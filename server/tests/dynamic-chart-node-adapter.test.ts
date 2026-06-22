import { describe, expect, it } from "vitest";

import { executeDynamicChartNode } from "../routes/node-adapters/dynamic-chart-node-adapter.js";

describe("executeDynamicChartNode", () => {
  it("normalizes table headers and rows into a bar chart ui payload", async () => {
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        title: "Quarter Revenue",
        dataset: {
          sheetName: "Q1",
          headers: ["month", "revenue", "cost"],
          rows: [
            ["Jan", 120, 80],
            ["Feb", 150, 92],
            ["Mar", 180, 110],
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
        title: "Quarter Revenue",
        dataset: {
          kind: "table",
          sheetName: "Q1",
          labelKey: "month",
          valueKeys: ["revenue", "cost"],
          rowCount: 3,
          categories: ["Jan", "Feb", "Mar"],
        },
        ui: {
          renderer: "recharts",
          component: "BarChart",
          chartType: "bar",
          categoryKey: "month",
          valueKeys: ["revenue", "cost"],
          series: [
            {
              key: "revenue",
              label: "revenue",
              color: "var(--chart-1)",
            },
            {
              key: "cost",
              label: "cost",
              color: "var(--chart-2)",
            },
          ],
        },
        context: {
          sourceNode: "excel_read",
          dynamicChart: {
            chartType: "bar",
            title: "Quarter Revenue",
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
    expect(result.output.ui?.data).toEqual([
      { month: "Jan", revenue: 120, cost: 80 },
      { month: "Feb", revenue: 150, cost: 92 },
      { month: "Mar", revenue: 180, cost: 110 },
    ]);
  });

  it("maps summary statistics into a pie chart and returns inline artifact payload when enabled", async () => {
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        chartType: "auto",
        title: "Channel Share",
        dataset: {
          kind: "summary",
          values: {
            chat: 45,
            docs: 30,
            mail: 25,
          },
        },
        artifact: {
          enabled: true,
          fileName: "channel-share",
        },
      },
    });

    expect(result.output.chartType).toBe("pie");
    expect(result.output.ui?.component).toBe("PieChart");
    expect(result.output.dataset?.rows).toEqual([
      { label: "chat", value: 45, fill: "var(--chart-1)" },
      { label: "docs", value: 30, fill: "var(--chart-2)" },
      { label: "mail", value: 25, fill: "var(--chart-3)" },
    ]);
    expect(result.output.artifact).toMatchObject({
      kind: "inline_json",
      name: "channel_share.json",
      mimeType: "application/json",
      content: {
        chartType: "pie",
        title: "Channel Share",
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
          categories: ["Mon", "Tue", "Wed"],
          series: [
            {
              name: "visits",
              data: [100, 120, 135],
            },
            {
              name: "conversions",
              data: [20, 25, 28],
            },
          ],
        },
      },
    });

    expect(result.output.chartType).toBe("line");
    expect(result.output.ui?.component).toBe("LineChart");
    expect(result.output.dataset).toMatchObject({
      kind: "series",
      labelKey: "category",
      valueKeys: ["visits", "conversions"],
      categories: ["Mon", "Tue", "Wed"],
    });
    expect(result.output.ui?.data).toEqual([
      { category: "Mon", visits: 100, conversions: 20 },
      { category: "Tue", visits: 120, conversions: 25 },
      { category: "Wed", visits: 135, conversions: 28 },
    ]);
  });
});
