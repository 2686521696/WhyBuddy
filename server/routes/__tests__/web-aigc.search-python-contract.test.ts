import { describe, expect, it, vi } from "vitest";

import type { QueryResult } from "../../../shared/knowledge/types.js";
import type { WebSearchResponse } from "../../../shared/web-search.js";
import { executeGraphSearchNode } from "../node-adapters/graph-search-node-adapter.js";
import { executeImageSearchNode } from "../node-adapters/image-search-node-adapter.js";
import { executeStaticWebpageReadNode } from "../node-adapters/static-webpage-read-node-adapter.js";
import { executeWebSearchNode } from "../node-adapters/web-search-node-adapter.js";

type SearchContractOutput = {
  status?: string;
  query?: string;
  provenance?: {
    provider: string;
    source: string;
    query: string;
    auditId?: string;
    permission?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
  };
};

const graphResult: QueryResult = {
  entities: [
    {
      entityId: "entity-1",
      entityType: "concept",
      name: "Search Contract",
      description: "Python search adapter contract.",
      confidence: 0.92,
      projectId: "project-1",
    },
    {
      entityId: "entity-2",
      entityType: "capability",
      name: "Fake Provider",
      description: "No external search.",
      confidence: 0.87,
      projectId: "project-1",
    },
  ],
  relations: [
    {
      relationId: "relation-1",
      relationType: "supports",
      sourceEntityId: "entity-1",
      targetEntityId: "entity-2",
      confidence: 0.86,
      evidence: "fake graph edge",
      projectId: "project-1",
    },
  ],
  contextSummary: "Fake graph summary",
  isPartial: false,
};

describe("web AIGC search Python contract adapters", () => {
  it("web search success preserves query and provenance without external fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response: WebSearchResponse = {
      query: "contract search",
      results: [
        {
          title: "Contract Search Result",
          url: "https://example.test/contract",
          snippet: "Fake provider result.",
          source: "fake-web-search",
          provenance: {
            provider: "fake",
            source: "fake-web-search",
            query: "contract search",
            auditId: "audit-web-1",
          },
        },
      ],
      totalCandidates: 1,
      latencyMs: 5,
      mode: "mock",
      provenance: {
        provider: "fake",
        source: "fake-web-search",
        query: "contract search",
        auditId: "audit-web-1",
      },
    };

    const result = await executeWebSearchNode(
      { nodeType: "web_search", input: { query: "contract search" } },
      { executeWebSearch: vi.fn().mockResolvedValue(response), now: () => 1000 },
    );

    expect(result.ok).toBe(true);
    expect(result.output.query).toBe("contract search");
    const output = result.output as typeof result.output & SearchContractOutput;
    expect(output.status).toBe("completed");
    expect(output.provenance).toMatchObject({
      provider: "fake",
      source: "fake-web-search",
      query: "contract search",
      auditId: "audit-web-1",
    });
    expect(output.results[0].provenance).toMatchObject({
      query: "contract search",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("web search empty is explicit and not success", async () => {
    const result = await executeWebSearchNode(
      { nodeType: "web_search", input: { query: "empty search" } },
      {
        executeWebSearch: vi.fn().mockResolvedValue({
          query: "empty search",
          results: [],
          totalCandidates: 0,
          latencyMs: 1,
          mode: "mock",
          status: "empty",
          provenance: {
            provider: "fake",
            source: "fake-web-search",
            query: "empty search",
          },
        }),
      },
    );

    const output = result.output as typeof result.output & SearchContractOutput;
    expect(output.status).toBe("empty");
    expect(output.status).not.toBe("completed");
    expect(output.results).toEqual([]);
    expect(output.provenance?.query).toBe("empty search");
  });

  it("web search error is explicit and not converted to success", async () => {
    const result = await executeWebSearchNode(
      { nodeType: "web_search", input: { query: "error search" } },
      {
        executeWebSearch: vi.fn().mockResolvedValue({
          ok: false,
          query: "error search",
          status: "error",
          error: {
            code: "fake_provider_error",
            message: "Fake provider failed.",
          },
          results: [],
          totalCandidates: 0,
          latencyMs: 1,
          mode: "mock",
          provenance: {
            provider: "fake",
            source: "fake-web-search",
            query: "error search",
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    const output = result.output as typeof result.output & SearchContractOutput;
    expect(output.status).toBe("error");
    expect(output.status).not.toBe("completed");
    expect(output.error?.code).toBe("fake_provider_error");
    expect(output.provenance?.query).toBe("error search");
  });

  it("web search permission denied preserves permission and audit fields", async () => {
    const result = await executeWebSearchNode(
      { nodeType: "web_search", input: { query: "blocked search" } },
      {
        executeWebSearch: vi.fn().mockResolvedValue({
          ok: false,
          query: "blocked search",
          status: "permission_denied",
          error: {
            code: "permission_denied",
            message: "Search adapter execution denied by permission policy.",
          },
          results: [],
          totalCandidates: 0,
          latencyMs: 1,
          mode: "mock",
          provenance: {
            provider: "fake",
            source: "fake-web-search",
            query: "blocked search",
            auditId: "audit-denied-1",
            permission: {
              allowed: false,
              reason: "policy_denied",
              auditId: "audit-denied-1",
            },
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    const output = result.output as typeof result.output & SearchContractOutput;
    expect(output.status).toBe("permission_denied");
    expect(output.provenance?.auditId).toBe("audit-denied-1");
    expect(output.provenance?.permission).toMatchObject({
      allowed: false,
      reason: "policy_denied",
      auditId: "audit-denied-1",
    });
  });

  it("graph search success carries query and provenance on the adapter output", async () => {
    const result = await executeGraphSearchNode(
      {
        nodeType: "graph_search",
        input: {
          projectId: "project-1",
          query: "graph contract",
          mode: "natural_language",
          context: {
            provenance: {
              provider: "fake",
              source: "fake-graph-search",
              query: "graph contract",
            },
          },
        },
      },
      {
        queryService: {
          naturalLanguageQuery: vi.fn().mockResolvedValue(graphResult),
          getNeighbors: vi.fn(),
          findPath: vi.fn(),
          subgraph: vi.fn(),
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.query).toBe("graph contract");
    expect(result.output.provenance).toMatchObject({
      provider: "fake",
      source: "fake-graph-search",
      query: "graph contract",
    });
    expect(result.output.metrics).toEqual({
      nodeCount: 2,
      edgeCount: 1,
      pathLength: 0,
    });
  });

  it("image search empty remains degraded instead of completed", async () => {
    const result = await executeImageSearchNode(
      { nodeType: "image_search", input: { query: "empty image" } },
      {
        executeImageSearch: vi.fn().mockResolvedValue({
          query: "empty image",
          normalized: { textQuery: "empty image", tags: [], referenceTags: [] },
          results: [],
          totalCandidates: 0,
          degraded: true,
          fallbackReason: "No fake candidates.",
          warnings: [],
          mode: "mock",
          status: "empty",
          provenance: {
            provider: "fake",
            source: "fake-image-search",
            query: "empty image",
          },
        }),
      },
    );

    expect(result.output.status).toBe("empty");
    expect(result.output.status).not.toBe("completed");
    expect(result.output.provenance?.query).toBe("empty image");
    expect(result.output.results).toEqual([]);
  });

  it("image search permission denied is not converted to completed", async () => {
    const result = await executeImageSearchNode(
      { nodeType: "image_search", input: { query: "blocked image" } },
      {
        executeImageSearch: vi.fn().mockResolvedValue({
          ok: false,
          query: "blocked image",
          normalized: { textQuery: "blocked image", tags: [], referenceTags: [] },
          results: [],
          totalCandidates: 0,
          degraded: true,
          warnings: [],
          mode: "mock",
          status: "permission_denied",
          error: {
            code: "permission_denied",
            message: "Search adapter execution denied by permission policy.",
          },
          provenance: {
            provider: "fake",
            source: "fake-image-search",
            query: "blocked image",
            auditId: "audit-image-denied",
            permission: { allowed: false, auditId: "audit-image-denied" },
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.output.status).toBe("permission_denied");
    expect(result.output.error?.code).toBe("permission_denied");
    expect(result.output.provenance?.permission).toMatchObject({
      allowed: false,
      auditId: "audit-image-denied",
    });
  });

  it("static webpage read returns fake inline content and never fetches without dependency", async () => {
    const fetchHtml = vi.fn();
    const result = await executeStaticWebpageReadNode(
      {
        nodeType: "static_webpage_read",
        input: {
          url: "https://example.test/fake-page",
          html: "<html><head><title>Fake Page</title></head><body><main>Fake static page content.</main></body></html>",
          context: {
            provenance: {
              provider: "fake",
              source: "fake-static-webpage-read",
              query: "https://example.test/fake-page",
            },
          },
        },
      },
      { fetchHtml },
    );

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.query).toBe("https://example.test/fake-page");
    expect(result.output.provenance).toMatchObject({
      provider: "fake",
      source: "fake-static-webpage-read",
      query: "https://example.test/fake-page",
    });
    expect(result.output.page.contentSource).toBe("inline_html");
    expect(fetchHtml).not.toHaveBeenCalled();
  });
});
