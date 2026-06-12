/**
 * evidence.search boundary property tests (tasks 5.2–5.5).
 * Feature: whybuddy-llm-autonomous-reasoning, Properties 14–17
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  executeEvidenceSearchMapped,
  EVIDENCE_SOURCE_LABELS,
  EVIDENCE_SOURCE_IN_SESSION,
  EVIDENCE_SOURCE_F1_GITHUB,
  EVIDENCE_SOURCE_WEB_SEARCH,
} from "../whybuddy/capability-exec-map.js";
import * as ghAdapter from "../whybuddy/github-mcp-adapter.js";
import { __setWebSearchExecutorForTests } from "../whybuddy/web-evidence-adapter.js";

const PBT_OPTS = { numRuns: 100 };

const baseState = (goalText: string): V5SessionState => ({
  sessionId: "ev-s1",
  goal: { text: goalText, status: "needs_refinement" },
  artifacts: [],
  staleArtifactIds: [],
  decisionLedger: [],
  capabilityRuns: [],
});

afterEach(() => {
  vi.restoreAllMocks();
  __setWebSearchExecutorForTests(undefined);
});

const mockWebSearchMiss = async () => ({
  query: "x",
  results: [],
  totalCandidates: 0,
  latencyMs: 1,
  mode: "mock" as const,
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 14: evidence.search 来源标注
 * Validates: Requirements 5.2
 */
describe("Property 14: evidence source labels", () => {
  it("evidenceSource is always one of the closed label set", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 4, maxLength: 80 }).filter((s) => !s.includes("github.com")),
        async (goal) => {
          __setWebSearchExecutorForTests(mockWebSearchMiss);
          const res = await executeEvidenceSearchMapped(baseState(goal), [], "研究员");
          expect(res.evidenceSource).toBeDefined();
          expect(EVIDENCE_SOURCE_LABELS).toContain(res.evidenceSource);
        }
      ),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 15: 无 GitHub 线索时不走 F1
 * Validates: Requirements 5.4 (F1 carve-out only when repo clue present)
 */
describe("Property 15: no F1 without GitHub clue", () => {
  it("zero github adapter calls when goal has no repo clue (F2 may run separately)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => !/github\.com\/[\w-]+\/[\w-]+/i.test(s)),
        async (goal) => {
          __setWebSearchExecutorForTests(mockWebSearchMiss);
          const spy = vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockRejectedValue(
            new Error("should not be called")
          );
          const res = await executeEvidenceSearchMapped(baseState(goal), [], "研究员");
          expect(spy).not.toHaveBeenCalled();
          expect(res.evidenceSource).toBe(EVIDENCE_SOURCE_IN_SESSION);
        }
      ),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 16: 存在 GitHub 线索则可走 F1 取数
 * Validates: Requirements 5.5
 */
describe("Property 16: F1 path when GitHub clue present", () => {
  it("invokes github adapter when goal contains github.com/owner/repo", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("acme", "widgets", "org-demo"),
        fc.constantFrom("api", "service", "lib-core"),
        async (owner, repo) => {
          __setWebSearchExecutorForTests(mockWebSearchMiss);
          const goal = `Review https://github.com/${owner}/${repo} for security`;
          const spy = vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockResolvedValue({
            title: "gh evidence",
            summary: "from github",
            content: "external evidence chunk",
            provenance: "mcp:github",
          });
          const res = await executeEvidenceSearchMapped(baseState(goal), [], "研究员");
          expect(spy).toHaveBeenCalled();
          expect(res.evidenceSource).toBe(EVIDENCE_SOURCE_F1_GITHUB);
        }
      ),
      { ...PBT_OPTS, numRuns: 40 }
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 17: evidence.search 优雅降级
 * Validates: Requirements 5.6
 */
describe("Property 18: F2 web search when provider returns real hits", () => {
  it("grounds evidence via web:search without GitHub clue", async () => {
    __setWebSearchExecutorForTests(async (req) => ({
      query: req.query,
      mode: "hybrid",
      latencyMs: 3,
      totalCandidates: 1,
      results: [
        {
          title: "Doc",
          url: "https://docs.example.org/page",
          snippet: "evidence snippet",
          source: "duckduckgo",
        },
      ],
    }));

    const res = await executeEvidenceSearchMapped(
      baseState("企业权限系统最佳实践"),
      [],
      "接地"
    );
    expect(res.evidenceSource).toBe(EVIDENCE_SOURCE_WEB_SEARCH);
    expect(res.provenance).toBe("web:search");
  });
});

describe("Property 17: graceful degradation", () => {
  it("never throws when F1 fetch fails; falls back to in-session synthesis", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("acme", "beta"), fc.constantFrom("app", "tool"), async (owner, repo) => {
        __setWebSearchExecutorForTests(mockWebSearchMiss);
        const goal = `Check https://github.com/${owner}/${repo}`;
        vi.spyOn(ghAdapter, "executeGithubMcpCapability").mockRejectedValue(new Error("network down"));
        await expect(
          executeEvidenceSearchMapped(baseState(goal), [], "研究员")
        ).resolves.toMatchObject({
          evidenceSource: EVIDENCE_SOURCE_IN_SESSION,
          provenance: "ai_generated",
        });
      }),
      { ...PBT_OPTS, numRuns: 40 }
    );
  });
});