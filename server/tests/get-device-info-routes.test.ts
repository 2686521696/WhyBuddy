import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createGetDeviceInfoRouter } from "../routes/get-device-info.js";

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/get-device-info",
    createGetDeviceInfoRouter({
      processPlatform: "win32",
      processArch: "x64",
      processVersion: "v22.0.0",
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
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

describe("POST /api/get-device-info/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/get-device-info/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeType: "llm" }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType");
    });
  });

  it("hydrates client hints from request headers when input omits them", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/get-device-info/nodes/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
          "X-Client-Platform": "desktop-web",
          "X-Client-Locale": "en-us",
          "X-Client-Timezone": "America/Los_Angeles",
        },
        body: JSON.stringify({
          nodeType: "get_device_info",
          input: {},
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.client).toMatchObject({
        platform: "desktop-web",
        browserFamily: "Chrome",
        osFamily: "macOS",
        locale: "en-US",
        timezone: "America/Los_Angeles",
      });
    });
  });
});
