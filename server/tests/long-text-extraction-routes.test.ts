import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createLongTextExtractionRouter } from "../routes/long-text-extraction.js";

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/long-text-extraction", createLongTextExtractionRouter());
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
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

describe("POST /api/long-text-extraction/nodes/execute", () => {
  it("returns 400 for invalid nodeType", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/long-text-extraction/nodes/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeType: "summary",
          }),
        },
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType must be long_text_extraction");
    });
  });

  it("returns extracted payload with summary, keywords, and fragments", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/long-text-extraction/nodes/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeType: "long_text_extraction",
            input: {
              title: "长文本提取样例",
              text: "用户反馈提到支付回调偶发失败，需要先核对日志告警，再整理高频问题摘要，最后输出可归档片段。",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.status).toBe("completed");
      expect(body.output.summary.short.length).toBeGreaterThan(0);
      expect(body.output.keywords.length).toBeGreaterThan(0);
      expect(body.output.fragments.length).toBeGreaterThan(0);
    });
  });

  it("returns 400 when text is missing", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/long-text-extraction/nodes/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeType: "long_text_extraction",
            input: {
              title: "空输入",
            },
          }),
        },
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("requires text");
    });
  });
});
