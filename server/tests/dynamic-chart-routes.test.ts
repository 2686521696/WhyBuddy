import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import {
  createDynamicChartRouter,
  type DynamicChartRouterDeps,
} from "../routes/dynamic-chart.js";

async function withServer(
  deps: DynamicChartRouterDeps,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/dynamic-chart", createDynamicChartRouter(deps));

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
    await withServer({}, async (baseUrl) => {
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

  it("returns chart ui payload for table requests", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dynamic_chart",
          input: {
            title: "Ticket Trend",
            dataset: {
              headers: ["day", "opened", "closed"],
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
        { day: "04-20", opened: 12, closed: 9 },
        { day: "04-21", opened: 15, closed: 11 },
      ]);
    });
  });

  it("returns 400 when no numeric chart series can be derived", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dynamic_chart",
          input: {
            dataset: {
              headers: ["name", "state"],
              rows: [
                ["task-a", "done"],
                ["task-b", "open"],
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

  it("returns Python invalid envelope without masquerading as chart_ready", async () => {
    await withServer(
      {
        executePythonRuntime: async () => ({
          ok: false,
          status: "invalid",
          chartSpec: null,
          error: {
            code: "invalid_data",
            message: "dynamic_chart dataset requires at least one numeric value column.",
          },
          warnings: [],
          runtime: {
            backend: "python",
            provider: "fake",
            source: "python-dynamic-chart-runtime",
            externalCalls: false,
            rendered: false,
            persisted: false,
          },
        }),
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/dynamic-chart/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "dynamic_chart",
            input: {
              dataset: {
                headers: ["name", "state"],
                rows: [["task-a", "done"]],
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(false);
        expect(body.output.status).toBe("failed");
        expect(body.output.pythonStatus).toBe("invalid");
        expect(body.output.pythonStatus).not.toBe("chart_ready");
        expect(body.output.error.code).toBe("invalid_data");
      },
    );
  });
});
