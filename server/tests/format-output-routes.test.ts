import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createFormatOutputRouter } from "../routes/format-output.js";

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/format-output", createFormatOutputRouter());

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

describe("POST /api/format-output/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/format-output/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "llm",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType");
    });
  });

  it("returns 400 when format value is unsupported", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/format-output/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "format_output",
          input: {
            format: "xml",
            raw: "<xml/>",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Unsupported format_output format");
    });
  });

  it("returns completed table output for downstream file generation", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/format-output/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "format_output",
          input: {
            format: "table",
            data: [
              { item: "日报", count: 2 },
              { item: "周报", count: 1 },
            ],
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.status).toBe("completed");
      expect(body.output.format).toBe("table");
      expect(body.output.content).toContain("| item | count |");
      expect(body.output.metadata.downstreamConsumers).toEqual([
        "end",
        "file_generation",
      ]);
    });
  });

  it("returns fallback text output when template rendering fails", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/format-output/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "format_output",
          input: {
            format: "template",
            raw: {
              summary: "保持原始输出",
            },
            template: "未命中变量：{{missing.key}}",
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.output.status).toBe("completed");
      expect(body.output.format).toBe("text");
      expect(body.output.fallbackUsed).toBe(true);
      expect(body.output.error).toContain('Template variable "missing.key" is missing');
      expect(body.output.content).toContain("保持原始输出");
    });
  });
});
