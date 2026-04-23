import { describe, expect, it, vi } from "vitest";

import { executeImageSearchNode } from "../routes/node-adapters/image-search-node-adapter.js";

describe("executeImageSearchNode", () => {
  it("supports text, tags, and reference image inputs against mock candidates", async () => {
    const result = await executeImageSearchNode({
      nodeType: "image_search",
      input: {
        query: "dashboard office charts",
        tags: ["workspace", "illustration"],
        referenceImage: {
          description: "warm workspace dashboard with mascot",
          tags: ["dashboard", "office"],
        },
        options: {
          topK: 2,
          minScore: 0.2,
          mode: "hybrid",
        },
        context: {
          traceId: "img-search-1",
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      nodeType: "image_search",
      output: {
        status: "completed",
        degraded: false,
        mode: "hybrid",
        normalized: {
          textQuery: "dashboard office charts",
          tags: ["workspace", "illustration"],
          referenceDescription: "warm workspace dashboard with mascot",
          referenceTags: ["dashboard", "office"],
        },
        context: {
          traceId: "img-search-1",
        },
      },
    });
    expect(result.output.results.length).toBeGreaterThan(0);
    expect(result.output.results[0].previewUrl).toContain("https://");
    expect(result.output.results[0].matchedBy.length).toBeGreaterThan(0);
    expect(result.output.sourceDomains.length).toBeGreaterThan(0);
  });

  it("uses injected executor result when provided", async () => {
    const executeImageSearch = vi.fn(async () => ({
      query: "pets avatar",
      normalized: {
        textQuery: "pets avatar",
        tags: ["avatar"],
        referenceTags: [],
      },
      results: [
        {
          imageId: "img-external-1",
          title: "External Avatar Result",
          summary: "External provider result for pet avatars.",
          previewUrl: "https://example.test/ext/avatar-preview.jpg",
          sourceUrl: "https://example.test/ext/avatar",
          source: "external-mock",
          tags: ["avatar", "pets"],
          availability: "available" as const,
          score: 0.95,
          matchedBy: ["query", "tags"] as const,
        },
      ],
      totalCandidates: 1,
      degraded: false,
      warnings: [],
      mode: "hybrid" as const,
    }));

    const result = await executeImageSearchNode(
      {
        nodeType: "image_search",
        input: {
          query: "pets avatar",
          tags: ["avatar"],
        },
      },
      {
        executeImageSearch,
      },
    );

    expect(executeImageSearch).toHaveBeenCalledWith({
      query: "pets avatar",
      tags: ["avatar"],
      options: {
        topK: 4,
        minScore: 0.15,
        mode: "mock",
      },
    });
    expect(result.output.results).toHaveLength(1);
    expect(result.output.previews).toEqual([
      "https://example.test/ext/avatar-preview.jpg",
    ]);
  });

  it("degrades gracefully when executor fails", async () => {
    const result = await executeImageSearchNode(
      {
        nodeType: "image_search",
        input: {
          query: "night monitoring room",
        },
      },
      {
        executeImageSearch: vi.fn(async () => {
          throw new Error("vision backend timeout");
        }),
      },
    );

    expect(result.output.status).toBe("degraded");
    expect(result.output.degraded).toBe(true);
    expect(result.output.fallbackReason).toContain("vision backend timeout");
    expect(result.output.warnings).toEqual(
      expect.arrayContaining([
        "图片搜索执行器异常，已自动回退到本地候选图片集合。",
      ]),
    );
    expect(result.output.results.length).toBeGreaterThan(0);
  });

  it("rejects empty input", async () => {
    await expect(
      executeImageSearchNode({
        nodeType: "image_search",
        input: {},
      }),
    ).rejects.toThrow(/requires query, tags, or referenceimage description/i);
  });
});
