import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeStructureDecomposeMapped, __setStructureLlmForTests } from "../structure-exec-map.js";
import {
  validateSpecTreeInvariants,
  structurePromptChainComplete,
  type SpecTreeNode,
} from "../../../shared/blueprint/whybuddy-structure-chain.js";
import { resetWhyBuddyCapabilityPoolCache } from "../pool-json-llm.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

const VALID_TREE = {
  nodes: [
    { id: "root", type: "root", title: "权限", summary: "根", evidenceRef: "goal:text" },
    {
      id: "req-1",
      parentId: "root",
      type: "requirement",
      title: "需求",
      summary: "核心",
      evidenceRef: "upstream:clarification",
    },
    {
      id: "des-1",
      parentId: "req-1",
      type: "design",
      title: "设计",
      summary: "RBAC",
      evidenceRef: "upstream:risk",
    },
    {
      id: "task-1",
      parentId: "des-1",
      type: "task",
      title: "任务",
      summary: "MVP",
      evidenceRef: "upstream:synthesis",
    },
    {
      id: "ev-1",
      parentId: "task-1",
      type: "evidence",
      title: "证据",
      summary: "EARS",
      evidenceRef: "upstream:report",
    },
  ],
} as const;

const DOUBLE_ROOT = {
  nodes: [
    { id: "root-a", type: "root", title: "A", summary: "a", evidenceRef: "g" },
    { id: "root-b", type: "root", title: "B", summary: "b", evidenceRef: "g" },
  ],
};

function baseState(goal = "拆解成 SPEC Tree"): V5SessionState {
  return {
    sessionId: "st1",
    goal: { text: goal, status: "needs_refinement" },
    artifacts: [],
  } as V5SessionState;
}

describe("structure-exec-map (S13/S14)", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS;
    process.env.WHYBUDDY_CAPABILITY_POOL_ENABLED = "0";
    resetWhyBuddyCapabilityPoolCache();
    __setStructureLlmForTests(undefined);
  });

  afterEach(() => {
    __setStructureLlmForTests(undefined);
  });

  it("S13: C_PROMPT→C_REDACT before LLM (edges 61–62)", async () => {
    const result = await executeStructureDecomposeMapped(baseState(), [], "架构", "t-prompt");
    expect(result.payload?.gateLedger).toContain("C_PROMPT:built");
    expect(result.payload?.gateLedger?.some((e) => e.startsWith("C_REDACT:applied"))).toBe(true);
    const prompt = String(result.payload?.promptExcerpt || "");
    const redacted = String(result.payload?.redactedExcerpt || "");
    expect(structurePromptChainComplete(prompt, redacted || prompt)).toBe(true);
  });

  it("S13: falls back to template when LLM unavailable (C_SFALL→C_TREE)", async () => {
    const result = await executeStructureDecomposeMapped(baseState(), [], "架构", "t1");
    expect(result.provenance).toBe("template");
    expect(result.content).toContain("SPEC Tree");
    expect(result.payload?.gateLedger).toContain("C_SFALL:template");
    expect(result.payload?.schemaPassed).toBe(false);
    expect(validateSpecTreeInvariants(VALID_TREE.nodes as SpecTreeNode[]).passed).toBe(true);
  });

  it("S13: retries exactly once on non-JSON then uses template (retryAttempts=1)", async () => {
    let calls = 0;
    __setStructureLlmForTests(async () => {
      calls += 1;
      return null;
    });

    const result = await executeStructureDecomposeMapped(baseState(), [], "架构", "t-retry");
    expect(calls).toBe(2);
    expect(result.provenance).toBe("template");
    expect(result.payload?.gateLedger).toEqual(
      expect.arrayContaining([
        "G_SCHEMA:attempt1:non_json",
        "G_SCHEMA:attempt2:non_json",
        "C_SFALL:template",
      ])
    );
  });

  it("S13: recovers on second attempt after schema failure", async () => {
    let calls = 0;
    __setStructureLlmForTests(async () => {
      calls += 1;
      if (calls === 1) return { nodes: [{ id: "bad" }] } as Record<string, unknown>;
      return VALID_TREE as unknown as Record<string, unknown>;
    });

    const result = await executeStructureDecomposeMapped(baseState(), [], "架构", "t-recover");
    expect(calls).toBe(2);
    expect(result.provenance).toBe("llm_fallback");
    expect(result.payload?.schemaPassed).toBe(true);
    expect(result.payload?.invariantPassed).toBe(true);
    expect(result.payload?.gateLedger).toContain("G_SCHEMA:attempt1:failed");
    expect(result.payload?.gateLedger).toContain("G_INV:attempt2:passed");
  });

  it("S14: schema-valid double-root fails G_INV then falls back to template", async () => {
    __setStructureLlmForTests(async () => DOUBLE_ROOT as unknown as Record<string, unknown>);

    const result = await executeStructureDecomposeMapped(baseState(), [], "架构", "t-inv");
    expect(result.provenance).toBe("template");
    expect(result.payload?.gateLedger).toEqual(
      expect.arrayContaining([
        "G_SCHEMA:attempt1:passed",
        "G_INV:attempt1:failed:exactly one root required",
        "G_SCHEMA:attempt2:passed",
        "G_INV:attempt2:failed:exactly one root required",
        "C_SFALL:template",
      ])
    );
    expect(validateSpecTreeInvariants(DOUBLE_ROOT.nodes as SpecTreeNode[]).passed).toBe(false);
  });

  it("S14: template tree satisfies all invariants", async () => {
    const result = await executeStructureDecomposeMapped(baseState("权限系统"), [], "架构", "t-tpl");
    expect(result.content).toMatch(/\[root\]/);
    expect(result.content).toMatch(/evidence:/);
    const inv = validateSpecTreeInvariants(
      [
        { id: "root", type: "root", title: "x", summary: "y", evidenceRef: "goal:text" },
        { id: "req-1", parentId: "root", type: "requirement", title: "r", summary: "s", evidenceRef: "u" },
        { id: "des-1", parentId: "req-1", type: "design", title: "d", summary: "s", evidenceRef: "u" },
        { id: "task-1", parentId: "des-1", type: "task", title: "t", summary: "s", evidenceRef: "u" },
        { id: "ev-1", parentId: "task-1", type: "evidence", title: "e", summary: "s", evidenceRef: "u" },
      ] satisfies SpecTreeNode[]
    );
    expect(inv.passed).toBe(true);
  });
});