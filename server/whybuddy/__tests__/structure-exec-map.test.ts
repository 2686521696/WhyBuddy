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

  it("【K5.1 探索测试】 server-llm 路径 prompt 应包含 route 摘要与 repo 片段（修复前短 prompt 仅 6 行 upstream_digest 120 字符 → 必败）", async () => {
    // 构造带 route_options 和 repo.inspect 的 state（模拟 V5 会话已有 selected route + repo 产物）
    const stateWithContext: any = {
      ...baseState("权限系统 V5.1 厚度回归"),
      artifacts: [
        {
          id: "r1",
          kind: "route_options",
          title: "推荐路线",
          content: "selectedRouteId: primary-route-42\n主路线：RBAC + 审计优先，备选 ABAC 扩展。\n理由：MVP 成本与风险平衡。",
          producedBy: { capabilityId: "route.select" },
        },
        {
          id: "repo1",
          kind: "repo",
          title: "repo.inspect",
          content: "https://github.com/example/whybuddy-demo\n关键文件：src/auth/rbac.ts (120 行), docs/permissions.md\n权限模型变更历史：3 次最近提交涉及 scope 边界。",
          producedBy: { capabilityId: "repo.inspect" },
        },
      ],
    };

    const result = await executeStructureDecomposeMapped(stateWithContext, ["r1", "repo1"], "架构", "k5-rich");

    const prompt = String(result.payload?.promptExcerpt || result.payload?.userPrompt || "");
    // 断言适配后的 prompt（或上游 digest）包含路线与仓库信息
    expect(prompt).toMatch(/route|primary-route-42|RBAC \+ 审计/i);
    expect(prompt).toMatch(/repo|github.com|rbac.ts|permissions/i);
    // 同时仍应包含 C_PROMPT 等标记（保全既有流程）
    expect(prompt).toContain("C_PROMPT");
    // 确认复用了旧管线 prompt builder (K5) - rich context appended
    expect(prompt).toContain("blueprint.spec-tree-llm.v1");
  });

  it("K5 continued: structure prompt includes K2 contract requirements (nodes, depth, EARS, evidenceRef)", async () => {
    const result = await executeStructureDecomposeMapped(baseState("test contract"), [], "架构", "k5-contract");
    const prompt = String(result.payload?.promptExcerpt || "");
    expect(prompt).toMatch(/nodes >=|depth >=|EARS|evidenceRef/i);
  });
});