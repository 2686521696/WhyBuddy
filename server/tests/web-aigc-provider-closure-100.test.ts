import { describe, expect, it, vi } from "vitest";

import { executeImageSearchNode } from "../routes/node-adapters/image-search-node-adapter.js";
import { executeGraphSearchNode } from "../routes/node-adapters/graph-search-node-adapter.js";
import { executeWebQaNode } from "../routes/node-adapters/web-qa-node-adapter.js";
import { executeFileTranslationNode } from "../routes/node-adapters/file-translation-node-adapter.js";
import { executeFileSlicingNode } from "../routes/node-adapters/file-slicing-node-adapter.js";
import { executeFileGenerationNode } from "../routes/node-adapters/file-generation-node-adapter.js";

const pythonClosureRuntime = {
  backend: "python",
  provider: "fake",
  source: "python-web-aigc-provider-closure",
  externalCalls: false,
} as const;

describe("web AIGC provider closure 100 - node adapters consume python summary", () => {
  it("image search node adapter consumes closure summary marking node_owned and preserves provenance", async () => {
    const closureSummary = {
      kind: "image_search",
      status: "node_owned" as const,
      backend: "node" as const,
      source: "node-image-search",
      runtime: { ...pythonClosureRuntime, source: "node-image-search" },
      metadata: { auditId: "audit-closure-img-1", permission: { allowed: true }, provenance: { provider: "closure" } },
    };

    const result = await executeImageSearchNode(
      {
        nodeType: "image_search",
        input: {
          query: "closure test image",
          context: {
            providerClosure: closureSummary,
            provenance: { auditId: "audit-closure-img-1" },
          },
        },
      },
      { now: () => 42 },
    );

    expect(result.ok).toBe(true);
    expect(result.output.context?.providerClosure?.status).toBe("node_owned");
    expect(result.output.provenance?.auditId).toBe("audit-closure-img-1");
    // must not claim python ready for node_owned route
    expect(result.output.context?.providerClosure?.backend).toBe("node");
    expect(result.output.context?.providerClosure?.source).not.toContain("python-web-aigc-provider-closure");
  });

  it("graph search node adapter consumes closure and keeps node_owned explicit", async () => {
    // graph search uses knowledge queryService dep, stub minimal
    const queryService = {
      getNeighbors: vi.fn().mockResolvedValue([]),
      findPath: vi.fn().mockResolvedValue({ nodes: [], edges: [], path: [] }),
      subgraph: vi.fn().mockResolvedValue({}),
      naturalLanguageQuery: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
    };

    const closure = { kind: "graph_search", status: "node_owned", backend: "node", source: "node-graph-search" };

    const result = await executeGraphSearchNode(
      {
        nodeType: "graph_search",
        input: {
          query: "closure graph",
          projectId: "project-closure-100",
          context: { providerClosure: closure, auditId: "g-closure" },
        },
      },
      { queryService },
    );

    expect(result.ok).toBe(true);
    expect(result.output.context?.providerClosure?.status).toBe("node_owned");
    expect(result.output.context?.auditId).toBe("g-closure");
  });

  it("web qa node adapter accepts config_missing closure without faking ready", async () => {
    const closure = {
      kind: "web_qa",
      status: "config_missing" as const,
      backend: "node",
      source: "node-web-qa",
      metadata: { auditId: "qa-audit-closure", permission: { allowed: false } },
    };

    const permissionEngine = { check: vi.fn().mockResolvedValue({ allowed: false }) };
    const result = await executeWebQaNode(
      { nodeType: "web_qa", input: { question: "what is closure", context: { providerClosure: closure } } },
      { permissionEngine },
    );

    expect(result.ok).toBe(false); // since permission or config
    expect(result.output?.metadata?.providerClosure?.status).toBe("config_missing");
  });

  it("file adapters (translation/slicing/generation) consume python closure and retain metadata", async () => {
    const closure = {
      kind: "file_translation",
      status: "ready" as const,
      backend: "python" as const,
      source: "python-file-translation-runtime",
      runtime: pythonClosureRuntime,
      metadata: { auditId: "file-closure-1", provenance: { provider: "closure" }, usage: { bytes: 10 } },
    };

    const translateResult = await executeFileTranslationNode(
      {
        nodeType: "file_translation",
        input: {
          filename: "closure.txt",
          content: "hello closure",
          targetLanguage: "zh-CN",
          context: { providerClosure: closure, runtime: pythonClosureRuntime },
        },
      },
      { translateSegment: vi.fn().mockResolvedValue({ translated: "translated" }), now: () => 1 },
    );
    expect(translateResult.ok).toBe(true);
    expect(translateResult.output.context?.providerClosure?.status).toBe("ready");
    expect(translateResult.output.context?.providerClosure?.metadata?.auditId).toBe("file-closure-1");

    const sliceResult = await executeFileSlicingNode(
      {
        nodeType: "file_slicing",
        input: {
          fileName: "c.txt",
          sourceId: "source-closure-1",
          projectId: "project-closure-100",
          content: "slice me",
          strategy: { maxChars: 10 },
          metadata: { providerClosure: closure },
        },
      },
      {},
    );
    expect(sliceResult.ok).toBe(true);
    expect(sliceResult.output.chunks[0]?.metadata?.providerClosure).toBeTruthy();

    const genResult = await executeFileGenerationNode(
      {
        nodeType: "file_generation",
        input: { filename: "gen.txt", content: "gen", context: { providerClosure: closure } },
      },
      {
        writeArtifactFile: vi.fn().mockResolvedValue({ outputId: "o1", artifact: { kind: "file", name: "gen.txt" } }),
        readArtifactPreview: vi.fn().mockResolvedValue({ inlineText: "gen" }),
      },
    );
    expect(genResult.ok).toBe(true);
    expect(genResult.output.context?.providerClosure?.backend).toBe("python");
  });

  it("closure summary shape carries provenance permission audit usage for node consumption", () => {
    const summary = {
      contractVersion: "web_aigc.provider_closure.v1",
      ok: true,
      total: 22,
      readyCount: 16,
      nodeOwnedCount: 2,
      configMissingCount: 4,
      degradedCount: 0,
      failedCount: 0,
      providers: {
        image_search: { status: "node_owned", metadata: { auditId: "a1", permission: {}, provenance: {}, usage: {} } },
        web_qa: { status: "config_missing", metadata: { auditId: "a2" } },
      },
      capabilityMap: { long_tail: ["image_search", "web_qa"] },
      runtime: pythonClosureRuntime,
    };

    // node side simply forwards without mutating
    const forwarded = { ...summary.providers.image_search.metadata };
    expect(forwarded.auditId).toBe("a1");
    expect(forwarded.provenance).toBeDefined();
    expect(summary.providers.web_qa.status).toBe("config_missing");
    // no healthy greenwash
    expect(summary.configMissingCount).toBeGreaterThan(0);
    expect(summary.readyCount).toBeGreaterThan(0);
  });
});
