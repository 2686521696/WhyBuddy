import { describe, expect, it } from "vitest";

import {
  executeDynamicChartNode,
  mapPythonDynamicChartRuntimeResponse,
} from "../routes/node-adapters/dynamic-chart-node-adapter.js";

const pythonRuntime = {
  backend: "python",
  provider: "fake",
  source: "python-dynamic-chart-runtime",
  externalCalls: false,
  rendered: false,
  persisted: false,
} as const;

describe("dynamic chart Python runtime bridge", () => {
  it("maps Python chart_ready to completed without calling a renderer", async () => {
    const result = await executeDynamicChartNode(
      {
        nodeType: "dynamic_chart",
        input: {
          chartType: "auto",
          title: "Runtime Chart",
          dataset: {
            headers: ["day", "opened", "closed"],
            rows: [
              ["2026-06-20", 12, 9],
              ["2026-06-21", 15, 11],
            ],
          },
        },
      },
      {
        executePythonRuntime: async () => ({
          ok: true,
          status: "chart_ready",
          chartSpec: {
            chartType: "bar",
            title: "Runtime Chart",
            dataset: {
              kind: "table",
              labelKey: "day",
              valueKeys: ["opened", "closed"],
              rowCount: 2,
              categories: ["2026-06-20", "2026-06-21"],
              rows: [
                { day: "2026-06-20", opened: 12, closed: 9 },
                { day: "2026-06-21", opened: 15, closed: 11 },
              ],
            },
            ui: {
              renderer: "recharts",
              component: "BarChart",
              chartType: "bar",
              title: "Runtime Chart",
              data: [
                { day: "2026-06-20", opened: 12, closed: 9 },
                { day: "2026-06-21", opened: 15, closed: 11 },
              ],
              categoryKey: "day",
              valueKeys: ["opened", "closed"],
              series: [
                { key: "opened", label: "opened", color: "var(--chart-1)" },
                { key: "closed", label: "closed", color: "var(--chart-2)" },
              ],
              options: {
                legend: true,
                grid: true,
                stacked: false,
              },
            },
          },
          warnings: [],
          runtime: pythonRuntime,
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.pythonStatus).toBe("chart_ready");
    expect(result.output.runtime).toMatchObject({
      backend: "python",
      externalCalls: false,
      rendered: false,
    });
    expect(result.output.ui.component).toBe("BarChart");
  });

  it.each([
    ["invalid", "invalid_data", "failed"],
    ["degraded", "provider_degraded", "degraded"],
    ["error", "runtime_error", "failed"],
  ] as const)(
    "keeps Python %s separate from chart_ready",
    async (pythonStatus, errorCode, nodeStatus) => {
      const result = mapPythonDynamicChartRuntimeResponse({
        ok: false,
        status: pythonStatus,
        chartSpec: null,
        error: {
          code: errorCode,
          message: `${errorCode} message`,
        },
        warnings: pythonStatus === "degraded" ? ["Dynamic chart provider is degraded."] : [],
        runtime: pythonRuntime,
      });

      expect(result.ok).toBe(false);
      expect(result.output.status).toBe(nodeStatus);
      expect(result.output.pythonStatus).toBe(pythonStatus);
      expect(result.output.pythonStatus).not.toBe("chart_ready");
      expect(result.output.error?.code).toBe(errorCode);
      expect(result.output.runtime).toMatchObject({
        backend: "python",
        rendered: false,
      });
      expect("ui" in result.output).toBe(false);
    },
  );
});
