import { describe, it, expect, afterEach } from "vitest";
import {
  buildEvidenceSearchQuery,
  isRealWebSearchResponse,
  executeWebEvidenceSearch,
  __setWebSearchExecutorForTests,
} from "../web-evidence-adapter.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

describe("web-evidence-adapter (F2)", () => {
  afterEach(() => {
    __setWebSearchExecutorForTests(undefined);
  });

  it("buildEvidenceSearchQuery merges goal and user turns", () => {
    const state = {
      goal: { text: "分析 RBAC" },
      conversation: [{ id: "u1", role: "user", text: "面向企业内部权限系统" }],
    } as V5SessionState;
    const q = buildEvidenceSearchQuery(state);
    expect(q).toContain("RBAC");
    expect(q).toContain("企业内部");
  });

  it("isRealWebSearchResponse rejects mock fallback", () => {
    expect(
      isRealWebSearchResponse({
        query: "x",
        mode: "mock",
        latencyMs: 1,
        totalCandidates: 3,
        results: [
          {
            title: "Mock",
            url: "https://example.test/x",
            snippet: "s",
            source: "mock-search-index",
          },
        ],
      })
    ).toBe(false);
  });

  it("executeWebEvidenceSearch returns web:search when hybrid results are real", async () => {
    __setWebSearchExecutorForTests(async () => ({
      query: "RBAC",
      mode: "hybrid",
      latencyMs: 5,
      totalCandidates: 1,
      results: [
        {
          title: "RBAC",
          url: "https://owasp.org/rbac",
          snippet: "access control",
          source: "serpapi",
        },
      ],
    }));

    const out = await executeWebEvidenceSearch(
      { goal: { text: "RBAC 权限" }, conversation: [] } as V5SessionState
    );
    expect(out?.provenance).toBe("web:search");
    expect(out?.content).toContain("owasp.org");
  });
});