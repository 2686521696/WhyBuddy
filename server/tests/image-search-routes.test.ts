import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createImageSearchRouter } from "../routes/image-search.js";

async function withServer(
  deps: Parameters<typeof createImageSearchRouter>[0] = {},
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/image-search", createImageSearchRouter(deps));
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
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("POST /api/image-search/nodes/execute", () => {
  it("rejects unsupported node types", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/image-search/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dialogue",
          input: {
            query: "dashboard",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType must be image_search");
    });
  });

  it("returns image candidates with preview, source, tags, and availability", async () => {
    const executeImageSearch = vi.fn(async () => ({
      query: "cute pets",
      normalized: {
        textQuery: "cute pets",
        tags: ["avatar"],
        referenceTags: ["playful"],
      },
      results: [
        {
          imageId: "img-route-1",
          title: "Cute Pets",
          summary: "A cute pets reference result.",
          previewUrl: "https://example.test/image-route/cute-pets-preview.jpg",
          sourceUrl: "https://example.test/image-route/cute-pets",
          source: "route-mock",
          tags: ["avatar", "pets", "playful"],
          availability: "preview_only" as const,
          score: 0.77,
          matchedBy: ["query", "reference"] as const,
        },
      ],
      totalCandidates: 1,
      degraded: false,
      warnings: [
        "部分图片仅支持预览或当前源不可用，请根据 availability 字段做下游处理。",
      ],
      mode: "hybrid" as const,
    }));

    await withServer({ executeImageSearch }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/image-search/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "image_search",
          input: {
            query: "cute pets",
            tags: ["avatar"],
            referenceImage: {
              description: "playful pet icons",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.nodeType).toBe("image_search");
      expect(body.output.results).toEqual([
        {
          imageId: "img-route-1",
          title: "Cute Pets",
          summary: "A cute pets reference result.",
          previewUrl: "https://example.test/image-route/cute-pets-preview.jpg",
          sourceUrl: "https://example.test/image-route/cute-pets",
          source: "route-mock",
          tags: ["avatar", "pets", "playful"],
          availability: "preview_only",
          score: 0.77,
          matchedBy: ["query", "reference"],
        },
      ]);
      expect(body.output.previews).toEqual([
        "https://example.test/image-route/cute-pets-preview.jpg",
      ]);
      expect(body.output.availabilitySummary).toEqual({
        available: 0,
        previewOnly: 1,
        unavailable: 0,
      });
    });
  });

  it("returns 400 when query, tags, and reference image are all missing", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/image-search/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "image_search",
          input: {},
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("requires query, tags, or referenceImage description");
    });
  });
});
