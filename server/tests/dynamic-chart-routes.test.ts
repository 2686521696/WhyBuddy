import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createDynamicChartRouter } from "../routes/dynamic-chart.js";

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/dynamic-chart", createDynamicChartRouter());

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("POST /api/dynamic-chart/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dialogue",
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "nodeType must be dynamic_chart",
      });
    });
  });

  it("returns chart ui payload for Excel-compatible requests", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dynamic_chart",
          input: {
            title: "工单趋势",
            dataset: {
              headers: ["日期", "新增工单", "关闭工单"],
              rows: [
                ["04-20", 12, 9],
                ["04-21", 15, 11],
              ],
            },
            artifact: {
              enabled: true,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.chartType).toBe("bar");
      expect(body.output.ui.component).toBe("BarChart");
      expect(body.output.artifact).toMatchObject({
        kind: "inline_json",
        mimeType: "application/json",
      });
      expect(body.output.dataset.rows).toEqual([
        { 日期: "04-20", 新增工单: 12, 关闭工单: 9 },
        { 日期: "04-21", 新增工单: 15, 关闭工单: 11 },
      ]);
    });
  });

  it("returns 400 when no numeric chart series can be derived", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dynamic_chart",
          input: {
            dataset: {
              headers: ["名称", "状态"],
              rows: [
                ["任务一", "完成"],
                ["任务二", "处理中"],
              ],
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("numeric value column");
    });
  });
});
