/**
 * `autopilot-llm-spec-generation` spec Task 3：spec_docs 阶段 LLM 真实生成工厂。
 *
 * 本模块对外暴露 {@link createSpecDocsLlmGeneration} 工厂，把 `spec_docs` 阶段
 * 从“按 SPEC 树节点机械填模板”升级为按节点逐个调用 LLM 推理生成
 * `requirements.md` / `design.md` / `tasks.md` 三段 markdown，并保留三级降级
 * 链：Real LLM + 完整仓库上下文 → Real LLM + 路由上下文 → 模板 / 模拟回退。
 *
 * 已落地范围（Task 3.2 - 3.6）：
 * - Task 3.2：env 旗标 / `BUILD_TARGET=test` / apiKey 缺失早退；启用判定通过
 *   `BLUEPRINT_SPEC_DOCS_LLM_ENABLED === "true"`，`BUILD_TARGET=test` 时仅
 *   显式 opt-in 才允许（与 spec-tree 工厂保持口径一致）。
 * - Task 3.3：root-first DFS 串行；维护 `parentSummaryMap` 把 ≤ 200 字摘要
 *   传递给子节点 prompt，使用 `for...of await` 严格保证串行。
 * - Task 3.4：单节点 `Promise.race` + `BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS`
 *   独立超时；优先走 `liteAgentRuntime`，未注入时退回到 `llmCall` 直调；
 *   `parseSpecDocsLlmResponse` 做 schema 校验。
 * - Task 3.5：单节点失败仅影响该节点，兄弟节点继续按 LLM 路径处理；
 *   `overallSource` 由 `llm` / `template` 节点数聚合得出。
 * - Task 3.6：`fallbackReason` 经 `applyAgentCrewRedaction` 脱敏并截断到
 *   ≤ 400 字符；日志走 `debug` / `warn`，永不抛错；`generate()` 即使依赖
 *   全部抛错也只会返回全 `template` 结果。
 *
 * 关键约束（与 design 一致）：
 * - 所有依赖通过 `import type` 引用 shared 契约与 blueprint 内部类型，避免引入
 *   `agent-reasoning-bridge.ts` / `lite-agent-runtime.ts` / `callback-receiver.ts` /
 *   `llm-call.ts` 的运行时副作用。
 * - 不引入 `any` 类型；新增类型字段全部显式标注，遵守 TypeScript 113 错误
 *   基线不扩张原则。
 * - `BUILD_TARGET=test` 默认视为旗标 `false`，仅在测试 `vi.stubEnv` 显式
 *   打开 `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true` 时才允许 opt-in，避免破坏
 *   既有 5140+ 测试基线。
 * - 与 `spec-tree-llm-derivation.ts` 共享相同的依赖形状；该文件由 Task 2.1
 *   并行创建，落地后本文件应改为
 *   `import type { SpecTreeLlmDerivationDeps } from "./spec-tree-llm-derivation.js"`
 *   并 `extends SpecTreeLlmDerivationDeps`，本地兜底定义随之删除。
 *
 * 实施细节参见 `.kiro/specs/autopilot-llm-spec-generation/design.md`
 * 「Components and Interfaces > 3. server/routes/blueprint/spec-docs-llm-generation.ts」。
 */

import { createHash } from "node:crypto";

import type {
  BlueprintRouteCandidate,
  BlueprintSpecTreeNode,
} from "../../../shared/blueprint/index.js";

import {
  applyAgentCrewRedaction,
  createDefaultAgentCrewStageActivationPolicy,
  type AgentCrewStageActivationPolicy,
} from "./agent-crew-stage-activation/policy.js";
import type { BlueprintLogger, McpToolAdapterDependency } from "./context.js";
import {
  buildSpecDocsPrompt,
  parseSpecDocsLlmResponse,
  SPEC_DOCS_PROMPT_ID,
} from "./llm-spec-prompts.js";
import {
  parseKeyPoolFromEnv,
  createLlmKeyPool,
  callLlmForSpecDoc,
  type LlmKeyPool,
  type LlmKeyPoolConfig,
} from "./llm-key-pool.js";
import { createStageProgressEmitter, type StageProgressEmitter } from "./stage-progress-emitter.js";
import type { LiteAgentRuntime } from "./role-agent-runtime/lite-agent-runtime.js";
import type { LlmCallFn } from "./role-agent-runtime/llm-call.js";
import type { BlueprintRuntimeDiagnosticsStore } from "./runtime-enablement/diagnostics-store.js";

// ---------------------------------------------------------------------------
// Task 3.1：DI 依赖与对外接口
// ---------------------------------------------------------------------------

/**
 * `spec_docs` LLM 生成工厂的依赖容器，符合 {@link
 * BlueprintServiceContext} 风格的 DI 容器约定。
 *
 * TODO(Task 2.1)：`spec-tree-llm-derivation.ts` 落地后，本接口应改为
 * `extends SpecTreeLlmDerivationDeps {}`，使两条工厂共享同一份 deps 形状。
 * 在 Task 2.1 文件出现之前，本地以等价字段做兜底定义，避免本任务受
 * 并行任务阻塞。形状必须保持与 design 文档中 `SpecTreeLlmDerivationDeps`
 * 字段、可选性、注释完全一致。
 */
export interface SpecDocsLlmGenerationDeps {
  /** 直接 LLM 调用函数；当 liteAgentRuntime 不可用时退路使用。 */
  llmCall: LlmCallFn;
  /** MCP GitHub 适配器；用于按需抓取节点相关仓库片段。可选。 */
  mcpToolAdapter?: McpToolAdapterDependency;
  /** Lite Agent 运行时；用于驱动 Think→Act→Observe 循环。可选。 */
  liteAgentRuntime?: LiteAgentRuntime;
  /**
   * 运行时诊断 store；记录 `specDocsLlm` entry 的所有计数与最近错误。
   * 由 Task 4.1 扩展 `BridgeId` union 后即可承载新桥的写入。
   */
  diagnostics: BlueprintRuntimeDiagnosticsStore;
  /** 最小 logger；仅用于可观测性，不影响行为。 */
  logger: BlueprintLogger;
  /** 时钟函数，便于测试期注入固定时间戳。 */
  now: () => Date;
  /** 可选：事件总线，用于实时推送进度事件到前端时间线。 */
  eventBus?: import("./event-bus.js").BlueprintEventBus;
}

/**
 * `spec_docs` LLM 生成的请求载荷。
 *
 * 调用方按 root-first DFS 顺序传入 `nodes`，工厂内部维持串行执行节奏，
 * 让父节点产出的摘要可以参与子节点 prompt 构造（参见 Task 3.3）。
 */
export interface SpecDocsLlmGenerationRequest {
  /** 蓝图作业 ID，用于 provenance 与诊断关联。 */
  jobId: string;
  /** 已确定的 SPEC 树节点；调用方按 root-first DFS 顺序传入。 */
  nodes: ReadonlyArray<BlueprintSpecTreeNode>;
  /** 当前选中的主路线，作为所有节点 spec_docs 的共同背景上下文。 */
  primaryRoute: BlueprintRouteCandidate;
  /**
   * 可选；按 nodeId 索引的节点相关仓库片段。Task 3.4 在单节点 prompt 构造
   * 时按需读取该 map；当前实现支持空 / 缺失场景，等价于无仓库片段。
   */
  repoExcerptsByNodeId?: ReadonlyMap<
    string,
    ReadonlyArray<{ path: string; excerpt: string }>
  >;
  /**
   * 可选；真实执行进度回调。LLM / 沙盒每节点开始与结束时分别触发
   * `started` 与 `completed`/`failed`，让前端进度面板反映**真实**的
   * per-node 执行时序（LLM 数秒级 / 沙盒数十秒级），而不是事后拼装时间。
   *
   * 调用方（generateSpecDocuments）会把同一个 emitter 传入，由本模块在
   * 真实 LLM 调用前后触发对应事件；外层不再独立发 per-node 事件。
   */
  onNodeProgress?: {
    started(nodeId: string, title: string, position: number): void;
    completed(nodeId: string, completedCount: number): void;
    failed(nodeId: string, errorSummary: string, processedCount: number): void;
  };
}

/**
 * 单节点生成结果。
 *
 * - 真实 LLM 路径填充 `requirements` / `design` / `tasks` 与 provenance 字段；
 *   `generationSource` 为 `"llm"`，`contextTier` 为 `"full"` 或 `"route-only"`。
 * - 模板 fallback 路径不填充 markdown，由调用方走既有模板路径生成；
 *   `generationSource` 为 `"template"`，`contextTier` 为 `"fallback"`，
 *   `fallbackReason` 写入脱敏后的失败原因（≤ 400 字符）。
 */
export interface SpecDocsLlmNodeOutput {
  /** 与 `request.nodes[i].id` 一一对应。 */
  nodeId: string;
  /** 该节点最终落地的来源；`"llm"` 表示真实推理，`"template"` 表示降级。 */
  generationSource: "llm" | "template";
  /** Tier 标记：`"full"` / `"route-only"` / `"fallback"`。 */
  contextTier: "full" | "route-only" | "fallback";
  /** 真实路径返回的 requirements.md 段落 markdown。 */
  requirements?: string;
  /** 真实路径返回的 design.md 段落 markdown。 */
  design?: string;
  /** 真实路径返回的 tasks.md 段落 markdown。 */
  tasks?: string;
  /** 真实路径 provenance：promptId / model / promptFingerprint / responseDigest。 */
  promptId?: string;
  model?: string;
  promptFingerprint?: string;
  responseDigest?: string;
  /** Fallback 路径填充；脱敏后的失败原因（≤ 400 字符）。 */
  fallbackReason?: string;
}

/**
 * `generate()` 的总结果。
 *
 * `perNode` 与 `request.nodes` 顺序一致；`overallSource` 由所有节点的
 * `generationSource` 聚合得出：
 * - 全部节点都成功 → `"llm"`。
 * - 任一节点降级 → `"mixed"`。
 * - 全部节点降级 → `"template"`。
 */
export interface SpecDocsLlmGenerationResult {
  perNode: ReadonlyArray<SpecDocsLlmNodeOutput>;
  overallSource: "llm" | "mixed" | "template";
}

/**
 * `spec_docs` LLM 生成器对外接口。`generate()` 永不抛错；任何异常都被工厂内部
 * 捕获并转成对应节点的 `template` 降级结果（Task 3.6）。
 */
export interface SpecDocsLlmGeneration {
  generate(
    request: SpecDocsLlmGenerationRequest,
  ): Promise<SpecDocsLlmGenerationResult>;
}

// ---------------------------------------------------------------------------
// 内部常量与工具
// ---------------------------------------------------------------------------

/** env 旗标：是否启用 spec_docs LLM 路径。默认 `false`，需显式 opt-in。 */
const SPEC_DOCS_LLM_ENABLED_ENV = "BLUEPRINT_SPEC_DOCS_LLM_ENABLED";

/** env 旗标：单节点 LLM 调用独立超时（毫秒），默认 180_000。 */
const SPEC_DOCS_LLM_TIMEOUT_ENV = "BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS";

/** 单节点超时默认值；与 design 文档保持一致。 */
const DEFAULT_NODE_TIMEOUT_MS = 180_000;

/** 父节点摘要传给子节点 prompt 时使用的最大字符数（与 design 文档一致）。 */
const PARENT_SUMMARY_MAX_CHARS = 200;

/** `fallbackReason` 写入诊断 / 输出前的最大字符数，与 spec-tree 工厂保持一致。 */
const MAX_FALLBACK_REASON_CHARS = 400;

/** 单例 redaction 策略；纯数据，可在多次调用之间共享。 */
const REDACTION_POLICY: AgentCrewStageActivationPolicy =
  createDefaultAgentCrewStageActivationPolicy();

/**
 * 判断当前进程是否启用 spec_docs LLM 路径。
 *
 * 规则（与 spec-tree 工厂保持口径一致）：
 * - 默认关闭：未显式 `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true` 时一律返回 false；
 * - `BUILD_TARGET=test` 默认仍视为关闭；只有当测试代码显式
 *   `vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_ENABLED", "true")` 时才打开
 *   （满足 design "test 默认关闭，opt-in 打开" 约束）。
 */
function isSpecDocsLlmEnabled(): boolean {
  return process.env[SPEC_DOCS_LLM_ENABLED_ENV] === "true";
}

/** 解析单节点超时；非法值或缺失时退回到默认值。 */
function resolveNodeTimeoutMs(): number {
  const raw = process.env[SPEC_DOCS_LLM_TIMEOUT_ENV];
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_NODE_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_NODE_TIMEOUT_MS;
}

/**
 * 对失败原因做脱敏 + 长度截断；保证 `fallbackReason` 既不泄漏凭证，也不撑爆
 * artifact / 诊断 store 字段（Task 3.6）。
 */
function redactAndTruncateReason(reason: string): string {
  const safe =
    typeof reason === "string" && reason.length > 0 ? reason : "unknown error";
  const redacted = applyAgentCrewRedaction(safe, REDACTION_POLICY);
  if (redacted.length <= MAX_FALLBACK_REASON_CHARS) {
    return redacted;
  }
  return redacted.slice(0, MAX_FALLBACK_REASON_CHARS);
}

/** 按 sha256 计算 LLM 原始响应摘要，用于 provenance 字段（与 spec-tree 一致）。 */
function computeResponseDigest(raw: unknown): string {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * 在指定毫秒后 reject 的辅助 Promise；与 `Promise.race` 配合实现独立超时。
 *
 * 与 spec-tree 工厂的同名 helper 保持等价行为；不会泄漏 timer：调用方读到
 * race 结果后会立即丢弃此 Promise，但 Node.js timers 默认不会 keep alive
 * event loop 太久（默认 ref），因此即使 race 提前结束也不会阻止进程退出
 * 太多。如需更严格的 timer 释放语义，后续可改为 `unref()`。
 */
function rejectAfter(ms: number, reason: string): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(reason)), ms);
  });
}

/** 把同层兄弟节点的摘要挑出，供下游 prompt 构造使用。 */
function collectSiblingSummaries(
  node: BlueprintSpecTreeNode,
  allNodes: ReadonlyArray<BlueprintSpecTreeNode>,
  parentSummaryMap: ReadonlyMap<string, string>,
): ReadonlyArray<{ id: string; title: string; summary: string }> {
  return allNodes
    .filter(
      (candidate) =>
        candidate.id !== node.id && candidate.parentId === node.parentId,
    )
    .map((sibling) => ({
      id: sibling.id,
      title: sibling.title,
      summary:
        parentSummaryMap.get(sibling.id) ??
        sibling.summary.slice(0, PARENT_SUMMARY_MAX_CHARS),
    }));
}

/**
 * 从 lite agent runtime 输出中提取 LLM 最终回答字符串 / 对象。
 *
 * `LiteAgentRuntime.run()` 返回 {@link AgentJobOutput}，最终产物落在
 * `output` 字段；若上层在 `finish` 时直接返回字符串，原样透传给
 * {@link parseSpecDocsLlmResponse} 即可。
 */
function extractLlmAnswerFromAgentOutput(agentOutput: unknown): unknown {
  if (agentOutput && typeof agentOutput === "object") {
    const obj = agentOutput as Record<string, unknown>;
    if ("output" in obj && obj.output !== undefined) {
      return obj.output;
    }
  }
  return agentOutput;
}

/** 安全调用诊断 store；任何异常都吞掉并 debug log，避免影响主流程。 */
function safeRecordDiagnostics(
  deps: SpecDocsLlmGenerationDeps,
  payload: { mode: "real" | "simulated_fallback"; error?: string },
): void {
  try {
    deps.diagnostics.recordBridgeInvocation("specDocsLlm", payload);
  } catch (err) {
    deps.logger.debug("[spec-docs-llm] diagnostics record failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 构造单节点 fallback 输出，并写入诊断（Task 3.5 / 3.6）。 */
function buildNodeFallback(
  deps: SpecDocsLlmGenerationDeps,
  nodeId: string,
  rawReason: string,
): SpecDocsLlmNodeOutput {
  const fallbackReason = redactAndTruncateReason(rawReason);
  safeRecordDiagnostics(deps, {
    mode: "simulated_fallback",
    error: fallbackReason,
  });
  return {
    nodeId,
    generationSource: "template",
    contextTier: "fallback",
    fallbackReason,
  };
}

/**
 * 把 spec_docs prompt 转成 lite agent runtime 可消费的 `AgentJobInput`。
 *
 * 当前实现只声明 `builtin.finish` / `builtin.think`（runtime 默认 builtin），
 * 不引入任何外部工具：spec_docs 的核心需求是“就当前节点产出三段 markdown”，
 * 没有调用工具的必要；如未来要让 LLM 主动按需读取仓库片段，可在此扩展工具
 * 列表（届时同步在 prompt 中说明可用工具）。
 */
function buildAgentJobInputForNode(
  jobId: string,
  nodeId: string,
  systemMessage: string,
  userMessage: string,
  timeoutMs: number,
): import("../../../shared/blueprint/agent-job.js").AgentJobInput {
  return {
    jobId: `${jobId}::spec-docs::${nodeId}`,
    roleId: "blueprint-spec-docs-llm",
    stageId: "spec_docs",
    goal: "Generate requirements / design / tasks markdown for a single SPEC tree node.",
    systemPrompt: systemMessage,
    tools: [],
    budget: {
      maxIterations: 4,
      maxTokens: 16_000,
      timeoutMs,
      toolTimeoutMs: Math.min(30_000, timeoutMs),
      allowParallelTools: false,
    },
    context: {
      promptUserMessage: userMessage,
      promptId: SPEC_DOCS_PROMPT_ID,
    },
    callbackUrl: "",
    callbackSecret: "",
  };
}

// ---------------------------------------------------------------------------
// 单节点处理（Task 3.4 + 3.5 + 3.6）
// ---------------------------------------------------------------------------

/**
 * 单节点 LLM 推理；任何异常都被吞掉并转成 fallback 节点输出。
 *
 * 流程：
 * 1. 构造 prompt（含父子上下文摘要、主路线摘要、可选仓库片段）。
 * 2. 通过 `liteAgentRuntime`（首选）或 `llmCall`（退路）拿到 LLM 原始回答。
 * 3. 用 `parseSpecDocsLlmResponse` 做 schema 校验。
 * 4. 校验通过 → 填充 markdown + provenance；写诊断 `mode: "real"`。
 * 5. 任一阶段失败 → 走 {@link buildNodeFallback}，节点结果 `template`，
 *    `fallbackReason` 经脱敏并截断。
 */
async function generateForNode(
  deps: SpecDocsLlmGenerationDeps,
  request: SpecDocsLlmGenerationRequest,
  node: BlueprintSpecTreeNode,
  parentSummaryMap: ReadonlyMap<string, string>,
  timeoutMs: number,
  primaryRouteSummary: string,
  model: string,
): Promise<SpecDocsLlmNodeOutput> {
  // 步骤 1：构造 prompt。
  let systemMessage: string;
  let userMessage: string;
  let promptFingerprint: string;
  try {
    const parentSummary =
      typeof node.parentId === "string"
        ? parentSummaryMap.get(node.parentId)
        : undefined;
    const siblingSummaries = collectSiblingSummaries(
      node,
      request.nodes,
      parentSummaryMap,
    );
    const relevantRepoExcerpts = request.repoExcerptsByNodeId?.get(node.id);
    const promptPayload = buildSpecDocsPrompt({
      node: {
        id: node.id,
        title: node.title,
        summary: node.summary,
        type: node.type,
        parentId: node.parentId,
      },
      parentSummary,
      siblingSummaries,
      primaryRouteSummary,
      relevantRepoExcerpts,
    });
    systemMessage = promptPayload.systemMessage;
    userMessage = promptPayload.userMessage;
    promptFingerprint = promptPayload.promptFingerprint;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.logger.warn("[spec-docs-llm] prompt build failed", {
      nodeId: node.id,
      error: redactAndTruncateReason(reason),
    });
    return buildNodeFallback(deps, node.id, `prompt build failed: ${reason}`);
  }

  const contextTier: "full" | "route-only" =
    request.repoExcerptsByNodeId && request.repoExcerptsByNodeId.size > 0
      ? "full"
      : "route-only";

  // 步骤 2：调用 LLM 并做独立超时。
  let rawAnswer: unknown;
  try {
    if (deps.liteAgentRuntime) {
      const agentInput = buildAgentJobInputForNode(
        request.jobId,
        node.id,
        systemMessage,
        userMessage,
        timeoutMs,
      );
      const agentOutput = await Promise.race([
        deps.liteAgentRuntime.run(agentInput),
        rejectAfter(timeoutMs, "agent timeout"),
      ]);
      rawAnswer = extractLlmAnswerFromAgentOutput(agentOutput);
    } else {
      const llmOutput = await Promise.race([
        deps.llmCall({
          systemPrompt: systemMessage,
          history: [],
          context: { userMessage },
          tools: [],
        }),
        rejectAfter(timeoutMs, "llm timeout"),
      ]);
      // `LlmCallFn` 是 ReAct loop 的 thinking step；正常情况下会通过
      // `finish` 形态返回 markdown JSON 对象。其它形态（action / error）一律
      // 视作 schema 失败 / 上游错误，由 parser 阶段统一降级。
      if (llmOutput.type === "finish") {
        rawAnswer = llmOutput.output;
      } else if (llmOutput.type === "error") {
        throw new Error(`llm error: ${llmOutput.error}`);
      } else {
        throw new Error(
          `llm returned non-finish output: type=${llmOutput.type}`,
        );
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.logger.warn("[spec-docs-llm] llm call failed", {
      nodeId: node.id,
      error: redactAndTruncateReason(reason),
    });
    return buildNodeFallback(deps, node.id, `llm call failed: ${reason}`);
  }

  // 步骤 3：schema 校验。
  const parsed = parseSpecDocsLlmResponse(rawAnswer);
  if (!parsed.ok) {
    deps.logger.warn("[spec-docs-llm] schema validation failed", {
      nodeId: node.id,
      reason: redactAndTruncateReason(parsed.reason),
    });
    return buildNodeFallback(deps, node.id, parsed.reason);
  }

  // 步骤 4：success path——写诊断 + 返回 LLM 输出。
  safeRecordDiagnostics(deps, { mode: "real" });
  return {
    nodeId: node.id,
    generationSource: "llm",
    contextTier,
    requirements: parsed.data.requirements,
    design: normalizeMermaidBlocks(parsed.data.design),
    tasks: parsed.data.tasks,
    promptId: SPEC_DOCS_PROMPT_ID,
    model,
    promptFingerprint,
    responseDigest: computeResponseDigest(rawAnswer),
  };
}

/**
 * 后置规范化 LLM 返回的 design 文档中的 mermaid 代码块。
 *
 * LLM 偶尔会以两种方式输出畸形的 mermaid 块：
 * 1. ` ```\nmermaid graph TD A[..] --> B[..]\n``` ` — 围栏没有语言标注，
 *    `mermaid` 关键字塞在内容里，且所有节点/边折叠成一行。
 * 2. ` ```mermaid\ngraph TD A[..] --> B[..]\n``` ` — 围栏正确，但 body 单行。
 *
 * 该函数仅对 design 文档中的 mermaid 块做以下规范化：
 * - 把 fence 内首行的 `mermaid` 关键字提到 fence 标签上。
 * - 在 `-->` / `---` / `==>` 边语法前插入换行 + 缩进。
 * - 在 `]` 后跟着新节点声明 `X[` 时插入换行。
 *
 * 不修改非 mermaid 代码块、TypeScript 接口块、或 prose 文本。
 */
function normalizeMermaidBlocks(design: string): string {
  // 匹配所有 ``` 代码围栏块（含语言标注与不含）
  return design.replace(
    /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)```/g,
    (match, lang: string, body: string) => {
      const langLower = lang.trim().toLowerCase();
      const trimmedBody = body.trimStart();
      const startsWithMermaidKeyword = /^mermaid[\s\b]/i.test(trimmedBody);

      // 仅处理 mermaid 块（标签或内容首词为 mermaid）
      if (langLower !== "mermaid" && !startsWithMermaidKeyword) {
        return match;
      }

      // 提取 mermaid 实际内容
      let mermaidBody = langLower === "mermaid"
        ? body
        : trimmedBody.replace(/^mermaid[\s\b]+/i, "");

      // 若 body 已多行，仅修正语言标签即可
      if (mermaidBody.includes("\n")) {
        return "```mermaid\n" + mermaidBody.trimEnd() + "\n```";
      }

      // body 单行：在边语法 / 节点声明前插入换行
      mermaidBody = mermaidBody
        .replace(/\s+(-->|---|==>)/g, "\n  $1")
        .replace(/(\])\s+([A-Z][A-Za-z0-9_]*\[)/g, "$1\n  $2");

      return "```mermaid\n" + mermaidBody.trimEnd() + "\n```";
    },
  );
}

// ---------------------------------------------------------------------------
// 全节点降级 / 聚合（Task 3.2 + 3.5）
// ---------------------------------------------------------------------------

/** 把一组节点统一映射为 `template` fallback 节点输出（不调用诊断）。 */
function buildAllTemplateResult(
  request: SpecDocsLlmGenerationRequest,
  rawReason: string,
): SpecDocsLlmGenerationResult {
  const fallbackReason = redactAndTruncateReason(rawReason);
  return {
    perNode: request.nodes.map((node) => ({
      nodeId: node.id,
      generationSource: "template" as const,
      contextTier: "fallback" as const,
      fallbackReason,
    })),
    overallSource: "template" as const,
  };
}

/** 根据每节点的 `generationSource` 计算 `overallSource`。 */
function computeOverallSource(
  perNode: ReadonlyArray<SpecDocsLlmNodeOutput>,
): "llm" | "mixed" | "template" {
  if (perNode.length === 0) {
    return "template";
  }
  let llmCount = 0;
  for (const entry of perNode) {
    if (entry.generationSource === "llm") {
      llmCount += 1;
    }
  }
  if (llmCount === perNode.length) {
    return "llm";
  }
  if (llmCount === 0) {
    return "template";
  }
  return "mixed";
}

// ---------------------------------------------------------------------------
// 工厂入口
// ---------------------------------------------------------------------------

/**
 * 工厂入口：构造 `SpecDocsLlmGeneration` 实例。
 *
 * 行为概要：
 * - env-off / apiKey 缺失：所有节点直接落到 `template` 路径，`overallSource`
 *   恒为 `"template"`，不调用 LLM、不写诊断。
 * - env-on：按 root-first DFS 顺序串行处理节点，每个节点独立 timeout、独立
 *   schema 校验、独立 fallback；父节点产出会被截断到 200 字写入
 *   `parentSummaryMap` 供子节点 prompt 复用。
 * - 整个 `generate()` 永不抛错；任何意外异常都被外层 try/catch 捕获并转换为
 *   全 `template` 输出（与 spec-tree 工厂语义一致）。
 */
export function createSpecDocsLlmGeneration(
  deps: SpecDocsLlmGenerationDeps,
): SpecDocsLlmGeneration {
  return {
    generate: async (request) => {
      try {
        // ─── Tier 1：env 旗标 / BUILD_TARGET 早退 ─────────────────────────
        if (!isSpecDocsLlmEnabled()) {
          deps.logger.debug(
            "[spec-docs-llm] llm disabled, all nodes fall back to template",
            { jobId: request.jobId, nodeCount: request.nodes.length },
          );
          return buildAllTemplateResult(request, "llm disabled");
        }

        // ─── Tier 2：apiKey 缺失早退 ─────────────────────────────────────
        const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
        if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
          deps.logger.debug(
            "[spec-docs-llm] apiKey missing, all nodes fall back to template",
            { jobId: request.jobId, nodeCount: request.nodes.length },
          );
          return buildAllTemplateResult(request, "apiKey missing");
        }

        if (request.nodes.length === 0) {
          return { perNode: [], overallSource: "template" };
        }

        // ─── Tier 3：按 root-first DFS 顺序处理 ────────────────────────
        // 当 key pool 可用时，同层兄弟节点并发调用（最多 poolSize 并发）；
        // pool 不可用时退回到串行单 key 路径。
        const MAX_LLM_NODES = 44; // pool 模式下可以处理更多节点
        const timeoutMs = resolveNodeTimeoutMs();
        const model = process.env.LLM_MODEL ?? "unknown";
        const primaryRouteSummary = request.primaryRoute.summary;
        const parentSummaryMap = new Map<string, string>();
        const perNode: SpecDocsLlmNodeOutput[] = [];

        // 尝试初始化 key pool（仅 spec_docs 使用）
        const poolConfig = parseKeyPoolFromEnv();
        const pool: LlmKeyPool | undefined = poolConfig ? createLlmKeyPool(poolConfig) : undefined;

        if (pool && pool.size > 0) {
          // ─── Pool 并发路径：按层分批，同层并发 ─────────────────────────
          deps.logger.debug("[spec-docs-llm] using key pool", {
            poolSize: pool.size,
            nodeCount: request.nodes.length,
            model: pool.config.model,
          });

          // 创建进度发射器
          const emitter = deps.eventBus
            ? createStageProgressEmitter(deps.eventBus, request.jobId, "spec_docs", "generator")
            : undefined;
          emitter?.thinking(`开始为 ${request.nodes.length} 个 SPEC 节点生成规格文档（${pool.size} 路并发）...`);

          // 按层分组：先处理无 parentId 的根节点，再处理其子节点，依此类推
          const processed = new Set<string>();
          let remaining = [...request.nodes];

          while (remaining.length > 0 && perNode.length < MAX_LLM_NODES) {
            // 找出当前层：parentId 已处理或无 parentId 的节点
            const currentLayer = remaining.filter(
              (node) => !node.parentId || processed.has(node.parentId),
            );
            if (currentLayer.length === 0) {
              // 所有剩余节点的 parent 都未处理（孤儿），直接 template
              for (const node of remaining) {
                perNode.push({
                  nodeId: node.id,
                  generationSource: "template" as const,
                  contextTier: "fallback" as const,
                  fallbackReason: "orphan node: parent not in tree",
                });
              }
              break;
            }

            // 并发处理当前层。每个 task 在自己的 LLM 调用返回时立即
            // emit completed/failed，让前端按真实 per-node 完成顺序更新进度，
            // 而不是等整层全部完成后一次性广播。共享计数器用闭包变量，
            // tasks 之间不会相互阻塞——pool.runConcurrent 仍负责并发限速。
            let _layerCompleted = perNode.filter(p => p.generationSource === "llm").length;
            let _layerFailed = perNode.filter(p => p.generationSource === "template").length;
            const tasks = currentLayer.map((node, layerIdx) => async () => {
              const parentSummary = node.parentId ? parentSummaryMap.get(node.parentId) : undefined;
              // 1-indexed 全局 position：前面已 processed 的节点数 + 当前层内序号
              const position = processed.size + layerIdx + 1;
              request.onNodeProgress?.started(node.id, node.title ?? node.id, position);

              try {
                // 用 pool key 分别生成 requirements / design / tasks（3 次调用，不要求 JSON）
                const poolEntry = pool.next();
                const [requirements, design, tasksDoc] = await Promise.all([
                  callLlmForSpecDoc(poolEntry, pool.config, "requirements", node.title, node.summary, primaryRouteSummary, parentSummary),
                  callLlmForSpecDoc(pool.next(), pool.config, "design", node.title, node.summary, primaryRouteSummary, parentSummary),
                  callLlmForSpecDoc(pool.next(), pool.config, "tasks", node.title, node.summary, primaryRouteSummary, parentSummary),
                ]);

                if (!requirements || !design || !tasksDoc) {
                  // 立即广播失败，不等其他并发节点
                  _layerFailed += 1;
                  request.onNodeProgress?.failed(
                    node.id,
                    "empty response from pool",
                    _layerCompleted + _layerFailed,
                  );
                  emitter?.observing(false, `⚠ ${node.title} — 降级为模板`);
                  return buildNodeFallback(deps, node.id, "empty response from pool");
                }

                safeRecordDiagnostics(deps, { mode: "real" });
                // 立即广播成功，不等其他并发节点——这是用户感知到 per-node
                // 实时进度的关键：哪个 LLM 调用先返回，哪个节点就先标记为 completed。
                _layerCompleted += 1;
                request.onNodeProgress?.completed(node.id, _layerCompleted);
                emitter?.observing(true, `✓ ${node.title} — 规格文档已生成`);
                return {
                  nodeId: node.id,
                  generationSource: "llm" as const,
                  contextTier: "full" as "full" | "route-only",
                  requirements,
                  design: normalizeMermaidBlocks(design),
                  tasks: tasksDoc,
                  promptId: SPEC_DOCS_PROMPT_ID,
                  model: pool.config.model,
                  promptFingerprint: `pool:${node.id}`,
                  responseDigest: computeResponseDigest(requirements + design + tasksDoc),
                } satisfies SpecDocsLlmNodeOutput;
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                _layerFailed += 1;
                request.onNodeProgress?.failed(
                  node.id,
                  `pool call failed: ${reason}`,
                  _layerCompleted + _layerFailed,
                );
                emitter?.observing(false, `⚠ ${node.title} — 降级为模板`);
                return buildNodeFallback(deps, node.id, `pool call failed: ${reason}`);
              }
            });

            const layerResults = await pool.runConcurrent(tasks);
            // 仅做 perNode 累积与 spec.node_completed 事件发射；
            // onNodeProgress 已在每个 task 内部即时发射，这里不重复发。
            for (let i = 0; i < currentLayer.length; i++) {
              const node = currentLayer[i];
              const result = layerResults[i];
              perNode.push(result);
              processed.add(node.id);
              // autopilot-mirofish-stream（2026-05-17）：
              // 在 observing 文案之外,追加结构化 spec.node_completed 事件,
              // 让前端 MiroFishCardStream 直接派生 node_completed 卡片
              // （而不是只能从 deriveSpecDocumentTreeStats 反查 lifecycle）。
              if (deps.eventBus) {
                try {
                  deps.eventBus.emit({
                    id: `${"spec.node_completed"}-${request.jobId}-${node.id}`,
                    jobId: request.jobId,
                    type: "spec.node_completed" as never,
                    family: "spec",
                    stage: "spec_docs",
                    status: "completed",
                    message: `Spec node ${node.title} documents generated.`,
                    occurredAt: new Date().toISOString(),
                    payload: {
                      nodeId: node.id,
                      nodeTitle: node.title,
                      documentTypes: ["requirements", "design", "tasks"],
                      generationSource: result.generationSource,
                      stageId: "spec_docs",
                    },
                  });
                } catch {
                  // emit 不应阻塞 LLM 主流程
                }
              }
              // 写入 parentSummaryMap 供下一层使用
              if (result.generationSource === "llm" && node.summary.length > 0) {
                parentSummaryMap.set(node.id, node.summary.slice(0, PARENT_SUMMARY_MAX_CHARS));
              }
            }

            // 从 remaining 中移除已处理的节点
            remaining = remaining.filter((n) => !processed.has(n.id));
          }

          // 超出 MAX_LLM_NODES 的剩余节点走 template
          for (const node of remaining) {
            if (!processed.has(node.id)) {
              perNode.push({
                nodeId: node.id,
                generationSource: "template" as const,
                contextTier: "fallback" as const,
                fallbackReason: `exceeded max LLM nodes limit (${MAX_LLM_NODES})`,
              });
            }
          }

          // 发射完成事件
          const llmCount = perNode.filter(n => n.generationSource === "llm").length;
          emitter?.completed(`规格文档生成完成：${llmCount}/${perNode.length} 个节点由 LLM 生成`);
        } else {
          // ─── 串行路径（无 pool，使用主 LLM）─────────────────────────────
          const SERIAL_MAX_LLM_NODES = 8;
          let _serialCompleted = 0;
          let _serialFailed = 0;
          for (let i = 0; i < request.nodes.length; i++) {
            const node = request.nodes[i];
            if (i >= SERIAL_MAX_LLM_NODES) {
              perNode.push({
                nodeId: node.id,
                generationSource: "template" as const,
                contextTier: "fallback" as const,
                fallbackReason: `exceeded max LLM nodes limit (${SERIAL_MAX_LLM_NODES})`,
              });
              continue;
            }
            request.onNodeProgress?.started(node.id, node.title ?? node.id, i + 1);
            // eslint-disable-next-line no-await-in-loop
            const nodeResult = await generateForNode(
              deps,
              request,
              node,
              parentSummaryMap,
              timeoutMs,
              primaryRouteSummary,
              model,
            );
            perNode.push(nodeResult);
            if (nodeResult.generationSource === "llm") {
              _serialCompleted += 1;
              request.onNodeProgress?.completed(node.id, _serialCompleted);
            } else {
              _serialFailed += 1;
              request.onNodeProgress?.failed(
                node.id,
                nodeResult.fallbackReason ?? "降级为模板",
                _serialCompleted + _serialFailed,
              );
            }
            if (
              nodeResult.generationSource === "llm" &&
              typeof node.summary === "string" &&
              node.summary.length > 0
            ) {
              parentSummaryMap.set(node.id, node.summary.slice(0, PARENT_SUMMARY_MAX_CHARS));
            }
          }
        }

        return {
          perNode,
          overallSource: computeOverallSource(perNode),
        };
      } catch (err) {
        // 终极兜底：永不抛错。任何依赖意外异常都退化为全 template。
        const reason = err instanceof Error ? err.message : String(err);
        deps.logger.warn("[spec-docs-llm] generate threw, falling back", {
          jobId: request.jobId,
          error: redactAndTruncateReason(reason),
        });
        return buildAllTemplateResult(request, `unexpected error: ${reason}`);
      }
    },
  };
}
