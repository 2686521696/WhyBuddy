import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";

import whybuddyRouter from "../whybuddy.js";
import * as llmClient from "../../core/llm-client.js";

describe("POST /api/whybuddy/respond", () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/whybuddy", whybuddyRouter);

  let server: any;
  let base: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("returns 400 when turnId is missing", async () => {
    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { sessionId: "s1", goal: { text: "x" } } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns fallback narration with HTTP 200 when LLM is unavailable", async () => {
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-fb",
        userText: "分析风险",
        state: { sessionId: "s1", goal: { text: "权限", status: "needs_refinement" } },
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        mainArtifact: {
          kind: "report",
          title: "报告",
          content: "结论：建议推进。\n下一步工程化分支：\n- secret branch",
        },
      }),
    });

    if (orig) process.env.LLM_API_KEY = orig;
    if (origOpen) process.env.OPENAI_API_KEY = origOpen;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.reason).toBe("no_api_key");
    expect(body.text).toContain("本轮完成了");
    expect(body.text).not.toMatch(/artifact|provenance|capability/i);
    expect(body.text).not.toContain("下一步工程化分支");
  });

  it("returns llm narration when callLLM succeeds", async () => {
    vi.spyOn(llmClient, "callLLM").mockResolvedValue({
      content: "这是面向用户的推演说明，结尾你想先澄清哪条边界？",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    } as any);

    const res = await fetch(`${base}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: "t-llm",
        userText: "出报告",
        state: { sessionId: "s1", goal: { text: "权限", status: "clear" } },
        artifacts: [{ kind: "report", title: "报告", summary: "摘要" }],
        mainArtifact: { kind: "report", title: "报告", content: "结论：可推进。" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("llm");
    expect(body.text).toContain("推演说明");
  });
});