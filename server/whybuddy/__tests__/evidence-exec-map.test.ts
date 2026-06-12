import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";
import * as ghAdapter from "../github-mcp-adapter.js";
import * as repoStaticAnalyzer from "../repo-static-analyzer.js";
import {
  executeRepoInspectMapped,
  executeEvidenceSearchMapped,
  EVIDENCE_SOURCE_IN_SESSION,
  EVIDENCE_SOURCE_F1_GITHUB,
  EVIDENCE_SOURCE_WEB_SEARCH,
} from "../capability-exec-map.js";
import {
  __setWebSearchExecutorForTests,
  EVIDENCE_SOURCE_WEB_SEARCH as WEB_SOURCE,
} from "../web-evidence-adapter.js";

function stateWithRepo(url: string): V5SessionState {
  return {
    sessionId: "s15",
    goal: { text: `分析 ${url} 的工程与证据`, status: "needs_refinement" },
    artifacts: [],
    conversation: [],
  } as V5SessionState;
}

const mockWebSearchMiss = async () => ({
  query: "x",
  results: [],
  totalCandidates: 0,
  latencyMs: 1,
  mode: "mock" as const,
});

describe("evidence-exec-map (S15)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __setWebSearchExecutorForTests(mockWebSearchMiss);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __setWebSearchExecutorForTests(undefined);
  });

  it("C_REPO→C_REPO_FALL: repo.inspect degrades when adapters fail", async () => {
    vi.spyOn(repoStaticAnalyzer, "executeRepoStaticInspect").mockRejectedValueOnce(new Error("403"));
    vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockRejectedValueOnce(new Error("private repo"));

    const url = "https://github.com/private-org/secret-repo";
    const result = await executeRepoInspectMapped(stateWithRepo(url), [], [url]);

    expect(result.payload?.degraded).toBe(true);
    expect(result.payload?.degradedReason).toBe("repo_fetch_failed");
    expect(result.content).toMatch(/降级|不可用|失败/i);
    expect(result.provenance).toBe("ai_generated");
  });

  it("repo.inspect without GitHub URL marks no_github_clue degraded", async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, "executeRepoStaticInspect");
    const ghSpy = vi.spyOn(ghAdapter, "executeGithubMcpCapability");

    const result = await executeRepoInspectMapped(
      { sessionId: "s15b", goal: { text: "做一个权限系统" }, artifacts: [] } as V5SessionState,
      []
    );

    expect(result.payload?.degraded).toBe(true);
    expect(result.payload?.degradedReason).toBe("no_github_clue");
    expect(staticSpy).not.toHaveBeenCalled();
    expect(ghSpy).not.toHaveBeenCalled();
  });

  it("C_EVID: evidence.search uses F1 GitHub when fetch succeeds", async () => {
    vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockResolvedValueOnce({
      title: "GitHub Evidence",
      summary: "collected",
      content: "readme excerpt",
      provenance: "mcp:github",
    });

    const url = "https://github.com/facebook/react";
    const result = await executeEvidenceSearchMapped(stateWithRepo(url), [], "接地", [url]);

    expect(result.evidenceSource).toBe(EVIDENCE_SOURCE_F1_GITHUB);
    expect(result.summary).toContain(EVIDENCE_SOURCE_F1_GITHUB);
    expect(result.payload?.degraded).toBeUndefined();
  });

  it("F2: evidence.search uses web search when provider returns real results", async () => {
    __setWebSearchExecutorForTests(async () => ({
      query: "RBAC 权限",
      results: [
        {
          title: "RBAC Guide",
          url: "https://example.com/rbac",
          snippet: "Role based access control overview",
          source: "duckduckgo",
        },
      ],
      totalCandidates: 1,
      latencyMs: 12,
      mode: "hybrid",
    }));

    const result = await executeEvidenceSearchMapped(
      { sessionId: "s15-web", goal: { text: "分析 RBAC 权限模型" }, artifacts: [], conversation: [] } as V5SessionState,
      [],
      "接地"
    );

    expect(result.evidenceSource).toBe(EVIDENCE_SOURCE_WEB_SEARCH);
    expect(result.provenance).toBe("web:search");
    expect(result.summary).toContain(WEB_SOURCE);
    expect(result.content).toContain("example.com");
  });

  it("C_EVID: evidence.search degrades to in-session when F1 fetch fails", async () => {
    vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockRejectedValueOnce(new Error("network"));

    const url = "https://github.com/org/private";
    const result = await executeEvidenceSearchMapped(stateWithRepo(url), [], "接地", [url]);

    expect(result.evidenceSource).toBe(EVIDENCE_SOURCE_IN_SESSION);
    expect(result.payload?.degraded).toBe(true);
    expect(result.payload?.degradedReason).toBe("evidence_fetch_failed");
    expect(result.summary).toContain(EVIDENCE_SOURCE_IN_SESSION);
  });
});