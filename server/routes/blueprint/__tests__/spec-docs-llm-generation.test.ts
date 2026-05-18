/**
 * `createSpecDocsLlmGeneration` 单元测试。
 *
 * 覆盖 tasks.md 9.1-9.4 中描述的 10 个用例：
 * 1. 单节点 happy path → generationSource:"llm"，三段 markdown 非空
 * 2. 多节点全成功 → overallSource:"llm"，顺序与输入一致
 * 3. 父子上下文传递 → 第二节点 prompt 中含第一节点 summary
 * 4. 第二节点抛错 → node1=template, node0=llm, overallSource:"mixed"
 * 5. 所有节点失败 → overallSource:"template"
 * 6. env 旗标关闭 → 全部 template
 * 7. 单节点 timeout 不阻塞后续节点
 * 8. 3 节点全成功 → recordBridgeInvocation("specDocsLlm") 被调 3 次
 * 9. 缺少 tasks 字段 → 该节点降级，fallbackReason 含 "schema"
 * 10. 串行保证：node 1 在 node 0 完成后才开始
 *
 * 使用 `vi.stubEnv` 控制环境变量，`vi.mock` 拦截 `getAIConfig`。
 * 中文注释，不依赖 `any` 类型。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type {
  SpecDocsLlmGenerationDeps,
  SpecDocsLlmGenerationRequest,
} from "../spec-docs-llm-generation.js";
import { createSpecDocsLlmGeneration } from "../spec-docs-llm-generation.js";
import type {
  BlueprintRouteCandidate,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

// ---------------------------------------------------------------------------
// mock getAIConfig —— 默认返回有效 apiKey
// ---------------------------------------------------------------------------

vi.mock("../../../core/ai-config.js", () => ({
  getAIConfig: vi.fn(() => ({
    apiKey: "sk-fake-key-for-testing-only",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-4o-mini",
    modelReasoningEffort: "medium",
    maxContext: 1_000_000,
    providerName: "example",
    wireApi: "chat_completions" as const,
    timeoutMs: 600_000,
    stream: false,
  })),
}));

// ---------------------------------------------------------------------------
// 共享 fake 数据与工具
// ---------------------------------------------------------------------------

/**
 * 构造合法的 spec_docs LLM 响应（requirements + design + tasks 三段 markdown）。
 *
 * Task 12.3 (Quality Uplift Wave)：所有 fixture 必须满足
 * `parseSpecDocsLlmResponse` 的结构最小集校验：
 * - requirements 含 `## 简介` 与 `## 需求`
 * - design 含 `## 概述` 与 `## 架构`
 * - tasks 含 `## Tasks`
 */
function makeValidDocsResponse(suffix = "") {
  return {
    requirements: `# 需求文档：Test${suffix}\n\n## 简介\n\nThis module should...\n\n## 术语表\n\n- Term: definition\n\n## 需求\n\n### 需求 1：example\n\n**用户故事：** As a developer, I want X, so that Y.\n\n#### 验收标准\n\n1.1 THE system SHALL X.`,
    design: `# 设计文档：Test${suffix}\n\n## 概述\n\nComponents include...\n\n## 架构\n\n\`\`\`mermaid\ngraph TB\n  A --> B\n\`\`\`\n\n## 组件与接口\n\n\`\`\`typescript\nexport interface Foo { id: string }\n\`\`\`\n\n## 数据模型\n\nN/A.\n\n## 正确性属性\n\n### Property 1: stable\n\n**Validates: Requirements 1.1**\n\n## 错误处理\n\nN/A.\n\n## 测试策略\n\nN/A.`,
    tasks: `# Implementation Plan: Test${suffix}\n\n## Overview\n\nplan.\n\n## Tasks\n\n- [ ] 1. Implement feature\n  - _Requirements: 1.1_`,
  };
}

/** 构造最小合法路线。 */
function makeRoute(): BlueprintRouteCandidate {
  return {
    id: "route-main",
    kind: "recommended",
    title: "Main Route",
    summary: "The primary recommended route for task autopilot.",
    rationale: "Best fit for the target.",
    steps: [
      {
        id: "step-1",
        title: "Step 1",
        description: "First step",
        role: "planner",
        capabilities: [],
      },
    ],
    capabilities: [],
    estimatedComplexity: "medium",
  };
}

/** 构造 SPEC 树节点。 */
function makeNode(id: string, parentId?: string): BlueprintSpecTreeNode {
  return {
    id,
    title: `Node ${id}`,
    summary: `Summary for node ${id}, providing context about module responsibilities.`,
    type: "module",
    priority: 80,
    parentId,
  };
}

/** 构造标准请求（默认单节点）。 */
function makeRequest(
  nodes?: ReadonlyArray<BlueprintSpecTreeNode>,
): SpecDocsLlmGenerationRequest {
  return {
    jobId: "test-job-001",
    nodes: nodes ?? [makeNode("node-0")],
    primaryRoute: makeRoute(),
  };
}

/** 创建 fake logger。 */
function makeFakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** 创建 fake diagnostics store。 */
function makeFakeDiagnostics() {
  return {
    recordBridgeInvocation: vi.fn(),
    recordBridgeConfiguration: vi.fn(),
    snapshot: vi.fn(() => []),
  };
}

/** 创建 fake llmCall（默认返回合法 JSON）。 */
function makeFakeLlmCall(responseFn?: () => unknown) {
  return vi.fn(async () => ({
    type: "finish" as const,
    output: responseFn ? responseFn() : makeValidDocsResponse(),
  }));
}

/** 创建 fake liteAgentRuntime。 */
function makeFakeLiteAgentRuntime(overrides?: {
  shouldReject?: boolean;
  rejectMessage?: string;
  neverResolve?: boolean;
  outputFn?: () => unknown;
  /** 可选延迟（毫秒），模拟耗时调用。 */
  delayMs?: number;
}) {
  return {
    run: vi.fn(async () => {
      if (overrides?.neverResolve) {
        return new Promise<never>(() => {
          /* 永不 resolve */
        });
      }
      if (overrides?.delayMs && overrides.delayMs > 0) {
        await new Promise((r) => setTimeout(r, overrides.delayMs));
      }
      if (overrides?.shouldReject) {
        throw new Error(overrides.rejectMessage ?? "agent internal error");
      }
      return {
        status: "completed" as const,
        output: overrides?.outputFn
          ? overrides.outputFn()
          : makeValidDocsResponse(),
      };
    }),
  };
}

/** 组装完整 deps。 */
function makeDeps(
  overrides?: Partial<SpecDocsLlmGenerationDeps>,
): SpecDocsLlmGenerationDeps {
  return {
    llmCall: makeFakeLlmCall(),
    diagnostics: makeFakeDiagnostics(),
    logger: makeFakeLogger(),
    now: () => new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("createSpecDocsLlmGeneration", () => {
  beforeEach(() => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_ENABLED", "true");
    vi.stubEnv("BUILD_TARGET", "");
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS", "5000");
    vi.stubEnv("LLM_API_KEY", "sk-fake-key-for-testing-only");
    vi.stubEnv("LLM_MODEL", "gpt-4o-mini");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ─── #1 单节点 happy path ───────────────────────────────────────────────
  it("#1 单节点 happy path：generationSource=llm，三段 markdown 非空", async () => {
    const deps = makeDeps({
      liteAgentRuntime: makeFakeLiteAgentRuntime(),
    });
    const generation = createSpecDocsLlmGeneration(deps);
    const result = await generation.generate(makeRequest());

    expect(result.perNode).toHaveLength(1);
    expect(result.perNode[0].generationSource).toBe("llm");
    expect(result.perNode[0].requirements).toBeDefined();
    expect(result.perNode[0].requirements!.length).toBeGreaterThan(0);
    expect(result.perNode[0].design).toBeDefined();
    expect(result.perNode[0].design!.length).toBeGreaterThan(0);
    expect(result.perNode[0].tasks).toBeDefined();
    expect(result.perNode[0].tasks!.length).toBeGreaterThan(0);
  });

  // ─── #2 多节点全成功 ───────────────────────────────────────────────────
  it("#2 多节点全成功：overallSource=llm，顺序与输入一致", async () => {
    const nodes = [makeNode("alpha"), makeNode("beta"), makeNode("gamma")];
    let callCount = 0;
    const deps = makeDeps({
      liteAgentRuntime: makeFakeLiteAgentRuntime({
        outputFn: () => makeValidDocsResponse(`-${++callCount}`),
      }),
    });
    const generation = createSpecDocsLlmGeneration(deps);
    const result = await generation.generate(makeRequest(nodes));

    expect(result.overallSource).toBe("llm");
    expect(result.perNode).toHaveLength(3);
    expect(result.perNode[0].nodeId).toBe("alpha");
    expect(result.perNode[1].nodeId).toBe("beta");
    expect(result.perNode[2].nodeId).toBe("gamma");
  });

  // ─── #3 父子上下文传递 ─────────────────────────────────────────────────
  it("#3 父子上下文：第二节点 prompt 中含第一节点 summary（捕获 mock 参数）", async () => {
    const parentNode = makeNode("parent-0");
    const childNode = makeNode("child-1", "parent-0");
    const liteAgent = makeFakeLiteAgentRuntime();
    const deps = makeDeps({ liteAgentRuntime: liteAgent });
    const generation = createSpecDocsLlmGeneration(deps);
    await generation.generate(makeRequest([parentNode, childNode]));

    // liteAgentRuntime.run 被调两次；第二次的 systemPrompt 或 context 应含父节点摘要
    expect(liteAgent.run).toHaveBeenCalledTimes(2);
    const secondCallArg = liteAgent.run.mock.calls[1][0] as {
      context?: { promptUserMessage?: string };
      systemPrompt?: string;
    };
    // 第二次调用的 userMessage（context.promptUserMessage）应包含 parent-0 的 summary 片段
    const userMsg = secondCallArg.context?.promptUserMessage ?? "";
    expect(userMsg).toContain(parentNode.summary.slice(0, 50));
  });

  // ─── #4 第二节点抛错 → mixed ──────────────────────────────────────────
  it("#4 第二节点抛错：node0=llm, node1=template, overallSource=mixed", async () => {
    let callIndex = 0;
    const liteAgent = {
      run: vi.fn(async () => {
        callIndex++;
        if (callIndex === 2) {
          throw new Error("second node exploded");
        }
        return {
          status: "completed" as const,
          output: makeValidDocsResponse(),
        };
      }),
    };
    const deps = makeDeps({ liteAgentRuntime: liteAgent });
    const generation = createSpecDocsLlmGeneration(deps);
    const nodes = [makeNode("n0"), makeNode("n1")];
    const result = await generation.generate(makeRequest(nodes));

    expect(result.perNode[0].generationSource).toBe("llm");
    expect(result.perNode[1].generationSource).toBe("template");
    expect(result.overallSource).toBe("mixed");
  });

  // ─── #5 所有节点失败 → template ───────────────────────────────────────
  it("#5 所有节点失败：overallSource=template", async () => {
    const deps = makeDeps({
      liteAgentRuntime: makeFakeLiteAgentRuntime({
        shouldReject: true,
        rejectMessage: "all nodes broken",
      }),
    });
    const generation = createSpecDocsLlmGeneration(deps);
    const nodes = [makeNode("a"), makeNode("b")];
    const result = await generation.generate(makeRequest(nodes));

    expect(result.overallSource).toBe("template");
    expect(result.perNode[0].generationSource).toBe("template");
    expect(result.perNode[1].generationSource).toBe("template");
  });

  // ─── #6 env 旗标关闭 → 全 template ────────────────────────────────────
  it("#6 env 旗标关闭：BLUEPRINT_SPEC_DOCS_LLM_ENABLED=false → 全 template", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_ENABLED", "false");
    const liteAgent = makeFakeLiteAgentRuntime();
    const deps = makeDeps({ liteAgentRuntime: liteAgent });
    const generation = createSpecDocsLlmGeneration(deps);
    const result = await generation.generate(makeRequest());

    expect(result.overallSource).toBe("template");
    expect(result.perNode[0].generationSource).toBe("template");
    expect(liteAgent.run).not.toHaveBeenCalled();
  });

  // ─── #7 超时不阻塞后续节点 ────────────────────────────────────────────
  it("#7 node 0 超时不阻塞 node 1（短 timeout 环境）", async () => {
    vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS", "30");
    let callIndex = 0;
    const liteAgent = {
      run: vi.fn(async () => {
        callIndex++;
        if (callIndex === 1) {
          // 第一个节点永不 resolve → 会被 timeout
          return new Promise<never>(() => {});
        }
        return {
          status: "completed" as const,
          output: makeValidDocsResponse(),
        };
      }),
    };
    const deps = makeDeps({ liteAgentRuntime: liteAgent });
    const generation = createSpecDocsLlmGeneration(deps);
    const nodes = [makeNode("slow"), makeNode("fast")];
    const result = await generation.generate(makeRequest(nodes));

    // node 0 超时降级为 template
    expect(result.perNode[0].generationSource).toBe("template");
    expect(result.perNode[0].fallbackReason).toContain("timeout");
    // node 1 仍然成功
    expect(result.perNode[1].generationSource).toBe("llm");
  });

  // ─── #8 诊断调用：3 节点全成功 → recordBridgeInvocation 调 3 次 ─────────
  it("#8 3 节点全成功：recordBridgeInvocation('specDocsLlm') 被调 3 次", async () => {
    const diagnostics = makeFakeDiagnostics();
    const deps = makeDeps({
      diagnostics,
      liteAgentRuntime: makeFakeLiteAgentRuntime(),
    });
    const generation = createSpecDocsLlmGeneration(deps);
    const nodes = [makeNode("x"), makeNode("y"), makeNode("z")];
    await generation.generate(makeRequest(nodes));

    expect(diagnostics.recordBridgeInvocation).toHaveBeenCalledTimes(3);
    for (const call of diagnostics.recordBridgeInvocation.mock.calls) {
      expect(call[0]).toBe("specDocsLlm");
    }
  });

  // ─── #9 缺少 tasks 字段 → 降级，fallbackReason 含 "schema" ─────────────
  it('#9 LLM 返回缺少 tasks 字段 → 该节点降级，fallbackReason 含 "schema"', async () => {
    const deps = makeDeps({
      liteAgentRuntime: makeFakeLiteAgentRuntime({
        outputFn: () => ({
          requirements: "# Requirements\n\nDone.",
          design: "# Design\n\nDone.",
          // 缺少 tasks 字段
        }),
      }),
    });
    const generation = createSpecDocsLlmGeneration(deps);
    const result = await generation.generate(makeRequest());

    expect(result.perNode[0].generationSource).toBe("template");
    expect(result.perNode[0].fallbackReason).toContain("schema");
  });

  // ─── #10 串行保证：node 1 在 node 0 完成后才开始 ───────────────────────
  it("#10 串行保证：node 1 在 node 0 完成后才开始（时序断言）", async () => {
    const timestamps: number[] = [];
    const liteAgent = {
      run: vi.fn(async () => {
        timestamps.push(Date.now());
        // 添加小延迟以确保时间差异可测量
        await new Promise((r) => setTimeout(r, 20));
        return {
          status: "completed" as const,
          output: makeValidDocsResponse(),
        };
      }),
    };
    const deps = makeDeps({ liteAgentRuntime: liteAgent });
    const generation = createSpecDocsLlmGeneration(deps);
    const nodes = [makeNode("first"), makeNode("second")];
    await generation.generate(makeRequest(nodes));

    // 确保第二次调用的时间戳晚于第一次
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]).toBeGreaterThanOrEqual(timestamps[0]);
    // 由于 node 0 有 20ms 延迟，node 1 应至少在 20ms 后才开始
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(15);
  });
});
