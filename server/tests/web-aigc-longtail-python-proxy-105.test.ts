import { describe, expect, it } from "vitest";

import { executeWebQaNode } from "../routes/node-adapters/web-qa-node-adapter.js";
import { executeOpenPageNode } from "../routes/node-adapters/open-page-node-adapter.js";
import { executeOrchestrationRecognitionJumpNode } from "../routes/node-adapters/orchestration-recognition-jump-node-adapter.js";

describe("web-aigc longtail 105 thin proxy to python", () => {
  it("web-qa uses python path when provided and does not run full node logic", async () => {
    const res = await executeWebQaNode(
      { nodeType: "web_qa", input: { question: "q" } },
      {
        executePythonRuntime: async () => ({ ok: true, status: "success", answer: "py-qa-answer", strategy: "document_search", metadata: { py: 1 } }),
      },
    );
    expect(res.ok).toBe(true);
    expect(res.output.answer).toContain("py-qa");
    expect(res.output.metadata?.py).toBe(1);
  });

  it("open-page proxies to python facade", async () => {
    const res = await executeOpenPageNode(
      { nodeType: "open_page", input: { pageId: "p1" } },
      { executePythonRuntime: async () => ({ ok: true, status: "completed", title: "py-open" }) },
    );
    expect(res.output.title).toBe("py-open");
  });

  it("orchestration uses python proxy when wired (retained node only when absent)", async () => {
    const res = await executeOrchestrationRecognitionJumpNode(
      { nodeType: "orchestration_recognition_jump", input: { query: "go" } },
      { executePythonRuntime: async () => ({ ok: true, status: "completed", target: { entryNodeId: "py-jump" } }) },
    );
    expect(res.output.status).toBe("completed");
    expect(res.output.jumpTargetNodeId).toContain("py");
  });
});
