/**
 * 子域 6：SPEC Documents 的服务层。
 *
 * 本文件包含两个独立导出：
 *
 * 1. `createSpecDocumentService(ctx)` + `SpecDocumentService`（既有）：
 *    只读 service 壳，从 `ctx.jobStore` 拉出 `spec_document` / `spec_document_version`
 *    artifact；`review = accepted` 推进到 `confirmed` 的逻辑由 `handoff-projection.ts`
 *    自动派生。对应需求 2.1 子域 6、3.2、4.1、4.4、7.3。
 *
 * 2. `createSpecDocumentsLlmService(ctx)` + `SpecDocumentsLlmService`（`autopilot-spec-documents-llm` spec 任务 10 新增）：
 *    LLM 驱动的**单文档**生成 service。每次调用仅产出一份 SPEC Document（单个
 *    `(nodeId, type)` 对）的 `title` / `summary` / `content`。六档 fallback 保证
 *    LLM 未启用 / apiKey 缺失 / callJson 抛错或超时 / 非 JSON / schema 校验失败
 *    时都能返回确定性产物，外层 `buildSpecDocument()` 通过 `generationSource` 字段
 *    决定是否走模板化路径。
 *
 *    **硬约束**（design §2.D1 / 需求 7.1-7.5）：
 *    - SHALL NOT `import { callLLMJson }` / `import { getAIConfig }`
 *    - SHALL NOT 模块级 `fetch()` / 任何 HTTP 客户端
 *    - SHALL NOT 硬编码 model / provider / temperature
 *    - SHALL NOT `import` 模块级 eventBus / jobStore 单例
 *    - 所有 LLM 能力来自 `ctx.llm.callJson` + `ctx.llm.getConfig`
 *
 * 对应 design §4.2 / §4.6 / §4.7 与任务 10 的 6 个子任务。
 */

import { createHash } from "node:crypto";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintGenerationRequest,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
  BlueprintSpecDocumentVersionSnapshot,
  BlueprintSpecTreeNode,
  BrainstormReasoningGraph,
} from "../../../../shared/blueprint/index.js";

import type { BlueprintServiceContext } from "../context.js";
import {
  applySpecDocumentsRedaction,
  createDefaultSpecDocumentsLlmPolicy,
  type SpecDocumentsLlmPolicy,
} from "./policy.js";
import {
  SpecDocumentsLlmResponseSchema,
  type SpecDocumentsLlmResponse,
} from "./schema.js";
import {
  buildSpecDocumentsPrompt,
  type SpecDocumentsPromptPayload,
} from "./prompt.js";
import { renderSectionsToMarkdown } from "./render.js";
import { parseBrainstormReasoningGraphPayload } from "../brainstorm-reasoning-graph-payload.js";

// ─── 既有只读 service shell ──────────────────────────────────────────────────

export interface SpecDocumentService {
  listDocuments(jobId: string): BlueprintSpecDocument[];
  listVersions(jobId: string): BlueprintSpecDocumentVersionSnapshot[];
}

function readArtifactPayloads<T>(
  job: BlueprintGenerationJob | null,
  types: string[]
): T[] {
  if (!job) return [];
  return job.artifacts
    .filter((artifact: BlueprintGenerationArtifact) => types.includes(artifact.type))
    .map((artifact: BlueprintGenerationArtifact) => artifact.payload as T)
    .filter((payload): payload is T => payload !== undefined && payload !== null);
}

export function createSpecDocumentService(
  ctx: BlueprintServiceContext
): SpecDocumentService {
  return {
    listDocuments(jobId) {
      const job = ctx.jobStore.get(jobId);
      return readArtifactPayloads<BlueprintSpecDocument>(job, [
        "requirements",
        "design",
        "tasks",
      ]);
    },
    listVersions(jobId) {
      const job = ctx.jobStore.get(jobId);
      return readArtifactPayloads<BlueprintSpecDocumentVersionSnapshot>(
        job,
        ["spec_document_version"]
      );
    },
  };
}

// ─── LLM 驱动 SPEC Document 生成 service（任务 10）──────────────────────────

/**
 * Service 的单次调用输入（单份文档）。
 *
 * 一次 `generateSpecDocuments()` 请求的 N × M 份文档 → N × M 次独立 service 调用；
 * 每次调用互不影响（design §D1 / 需求 2.2）。
 */
export interface SpecDocumentsLlmServiceInput {
  jobId: string;
  job: BlueprintGenerationJob;
  request: BlueprintGenerationRequest;
  /** 目标 SPEC Tree 节点；每份文档绑定到唯一节点。 */
  specTreeNode: BlueprintSpecTreeNode;
  /** 目标文档类型：requirements / design / tasks。 */
  targetDocumentType: BlueprintSpecDocumentType;
  /** 该节点关联的主路线（若节点未关联 route 则为 undefined）。 */
  primaryRoute?: BlueprintRouteCandidate;
  clarificationSession?: BlueprintClarificationSession;
  domainContext?: BlueprintProjectDomainContext;
  /** 可选上游证据：当前 `collectReusableRoleFindings()` 返回的派生摘要。 */
  upstreamEvidence?: {
    reusableRoleFindings: Array<{ id: string; label: string; summary: string }>;
  };
  createdAt: string;
}

/**
 * Service 的单次调用输出。
 *
 * - Real path：`generationSource="llm"`，返回 `title` / `summary` / `content`
 *   + provenance 扩展字段（`promptId` / `model` / `responseDigest` /
 *   `structuredPayloadDigest` / `promptFingerprint`）。
 * - Fallback path：`generationSource="llm_fallback"`，返回 `error` + 可选
 *   `promptId` / `model` / `promptFingerprint`；`title` / `summary` / `content`
 *   为 `undefined`（由外层走模板路径）。
 * - Template path：`generationSource="template"`，其它字段全 `undefined`。
 */
export interface SpecDocumentsLlmServiceOutput {
  generationSource: "llm" | "llm_fallback" | "template";
  /** Real path 下填充；fallback / template 路径下 undefined。 */
  title?: string;
  summary?: string;
  content?: string;
  /** Real path 可选填充；LLM 返回的 status（已规范化）。 */
  status?: BlueprintSpecDocumentStatus;
  /** Real / fallback 有 LLM 调用时填充。 */
  promptId?: string;
  model?: string;
  promptFingerprint?: string;
  /** Real path 必填。 */
  responseDigest?: string;
  structuredPayloadDigest?: string;
  /** llm_fallback 路径填充。 */
  error?: string;
  /** Optional LLM-authored reasoning graph for the Stage 2 wall. */
  reasoningGraph?: BrainstormReasoningGraph;
}

export type SpecDocumentsLlmService = (
  input: SpecDocumentsLlmServiceInput
) => Promise<SpecDocumentsLlmServiceOutput>;

// ─── Helpers（纯函数，无副作用） ─────────────────────────────────────────────

const PYTHON_PROXY_ENABLED = "BLUEPRINT_SPEC_DOCS_PYTHON_PROXY";
const PYTHON_PROXY_BASE_URL = "PYTHON_SLIDE_RULE_BASE_URL";
const PYTHON_PROXY_INTERNAL_KEY = "PYTHON_SLIDE_RULE_INTERNAL_KEY";

function isPythonSpecDocsProxyEnabled(): boolean {
  const value = process.env[PYTHON_PROXY_ENABLED];
  if (value === "true") return true;
  if (value === "false") return false;
  // Python-first：未显式配置时默认走 Python 代理（失败自动回退 Node）。
  // 测试环境保持默认关，避免每个用例先打一次不可达的 :9700。
  return !isVitestEnvironment();
}

function isVitestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.VITEST_POOL_ID !== undefined
  );
}

function resolvePythonSpecDocsBaseUrl(): string {
  return (process.env[PYTHON_PROXY_BASE_URL] || "http://localhost:9700").replace(/\/+$/, "");
}

function resolvePythonSpecDocsInternalKey(): string {
  return process.env[PYTHON_PROXY_INTERNAL_KEY] || "dev-slide-rule-internal";
}

function isSpecDocumentsLlmServiceOutput(value: unknown): value is SpecDocumentsLlmServiceOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.generationSource !== "llm" &&
    candidate.generationSource !== "llm_fallback" &&
    candidate.generationSource !== "template"
  ) {
    return false;
  }
  if (candidate.generationSource === "llm") {
    return (
      typeof candidate.title === "string" &&
      typeof candidate.summary === "string" &&
      typeof candidate.content === "string"
    );
  }
  return true;
}

async function callPythonSpecDocumentsProxy(
  input: SpecDocumentsLlmServiceInput,
): Promise<SpecDocumentsLlmServiceOutput> {
  const response = await fetch(`${resolvePythonSpecDocsBaseUrl()}/api/blueprint/spec-documents/generate-one`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": resolvePythonSpecDocsInternalKey(),
    },
    body: JSON.stringify({
      jobId: input.jobId,
      targetDocumentType: input.targetDocumentType,
      specTreeNode: input.specTreeNode,
      request: input.request,
      primaryRoute: input.primaryRoute,
      clarificationSession: input.clarificationSession,
      domainContext: input.domainContext,
      upstreamEvidence: input.upstreamEvidence,
      createdAt: input.createdAt,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`python spec-docs proxy failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (!isSpecDocumentsLlmServiceOutput(payload)) {
    throw new Error("python spec-docs proxy returned invalid shape");
  }
  return payload;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function safeGetConfig(
  ctx: BlueprintServiceContext
): { apiKey?: string; model?: string } | undefined {
  try {
    const cfg = ctx.llm.getConfig();
    return cfg as { apiKey?: string; model?: string };
  } catch {
    // 防御：如果 getConfig 抛出（测试装配错误），当作 apiKey 缺失 → tier 2 早退。
    return undefined;
  }
}

/**
 * 规范化 LLM 返回的（已通过 zod 校验的）payload：
 *
 * - trim `title` / `summary` / 每个 `section.title` / `section.summary` /
 *   `section.body` 的首尾空白；
 * - `section.id` 做 `trim().toLowerCase()` 规范化；
 * - `status`（若提供）已由 zod enum 校验，此处原样保留。
 *
 * 对应 design §4.6 step 7 与需求 3.6。
 */
function normalizeSpecDocumentsResponse(
  validated: SpecDocumentsLlmResponse,
  _policy: SpecDocumentsLlmPolicy
): SpecDocumentsLlmResponse {
  return {
    title: validated.title.trim(),
    summary: validated.summary.trim(),
    sections: validated.sections.map((section) => ({
      id: section.id.trim().toLowerCase(),
      title: section.title.trim(),
      summary: section.summary.trim(),
      body: section.body.trim(),
    })),
    ...(validated.status !== undefined ? { status: validated.status } : {}),
  };
}

// ─── Factory（design §4.6 伪代码实现） ───────────────────────────────────────

const ENV_ENABLED = "BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED";

/**
 * 创建 SPEC Documents LLM 驱动生成 service。
 *
 * 策略（按 design §4.6 的六档 fallback 依次判定）：
 *
 * 1. 未启用（`BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED !== "true"`）→ template
 * 2. apiKey 缺失 → template（与档位 1 合流；design §5.1 锁定口径）
 * 3. callJson 抛错 / 超时 → llm_fallback，`error="llm callJson threw: ..."` 或 `"llm timeout"`
 * 4. 非 JSON / undefined / null / 非 object → llm_fallback，`error="non-json response"`
 * 5. Schema + `.superRefine()` 不变量失败 → llm_fallback，`error="schema validation failed: ..."`
 * 6. Happy path：normalize → render Markdown → compute digests → 返回 generationSource="llm"
 *
 * 所有 error 文本经 `applySpecDocumentsRedaction()` 脱敏后截断到
 * `policy.maxErrorLength` 字符。
 */
export function createSpecDocumentsLlmService(
  ctx: BlueprintServiceContext
): SpecDocumentsLlmService {
  // Policy 在闭包内一次性解析：未注入时使用默认值。
  // `ctx.specDocumentsLlmPolicy` 字段将在 task 11 正式加入 `BlueprintServiceContext`；
  // 此处用 `as` 窄化以便 task 10 能独立落地（design §4.6 policy 解析）。
  const policy =
    (ctx as BlueprintServiceContext & {
      specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy;
    }).specDocumentsLlmPolicy ?? createDefaultSpecDocumentsLlmPolicy();

  return async function service(
    input: SpecDocumentsLlmServiceInput
  ): Promise<SpecDocumentsLlmServiceOutput> {
    if (isPythonSpecDocsProxyEnabled()) {
      try {
        return await callPythonSpecDocumentsProxy(input);
      } catch (error) {
        const redacted = applySpecDocumentsRedaction(errorMessage(error), policy);
        ctx.logger.warn("spec-documents python proxy failed, using fallback", {
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
          error: redacted,
        });
        return {
          generationSource: "llm_fallback",
          error: `python proxy failed: ${redacted}`.slice(0, policy.maxErrorLength),
        };
      }
    }

    // ---- 档位 1：未启用 → template（design §4.6 step 1） --------------------
    if (process.env[ENV_ENABLED] !== "true") {
      ctx.logger.debug(
        "spec-documents llm: not enabled, using template",
        {
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
        }
      );
      return { generationSource: "template" };
    }

    // ---- 档位 2：apiKey 缺失 → template（design §4.6 step 2） ----------------
    // 永远不在 apiKey 缺失时调用 `ctx.llm.callJson`（tier 2 硬需求）。
    const aiConfig = safeGetConfig(ctx);
    const apiKey = typeof aiConfig?.apiKey === "string" ? aiConfig.apiKey : "";
    if (apiKey.length === 0) {
      ctx.logger.debug(
        "spec-documents llm: apiKey missing, using template",
        {
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
        }
      );
      return { generationSource: "template" };
    }

    // ---- 构造 prompt（locale-aware，按 targetDocumentType 分支） ------------
    // `BlueprintClarificationSession` 当前没有 `locale` 字段；采用兼容读取：
    // 若 session 上出现 `locale === "zh-CN"`，走中文 prompt，否则默认英文。
    const sessionLocale = (
      input.clarificationSession as unknown as { locale?: unknown } | undefined
    )?.locale;
    const locale: "zh-CN" | "en-US" =
      sessionLocale === "zh-CN" ? "zh-CN" : "en-US";

    const prompt: SpecDocumentsPromptPayload = buildSpecDocumentsPrompt({
      request: input.request,
      specTreeNode: input.specTreeNode,
      targetDocumentType: input.targetDocumentType,
      primaryRoute: input.primaryRoute,
      clarificationSession: input.clarificationSession,
      domainContext: input.domainContext,
      upstreamEvidence: input.upstreamEvidence,
      locale,
    });

    const model =
      typeof aiConfig?.model === "string" ? aiConfig.model : "";

    // ---- 档位 3：调用 LLM（可能抛错 / 超时） --------------------------------
    let rawPayload: unknown;
    try {
      rawPayload = await ctx.llm.callJson<unknown>(
        [
          { role: "system", content: prompt.systemMessage },
          { role: "user", content: prompt.userMessage },
        ],
        {
          model,
          temperature: policy.temperature,
          timeoutMs: policy.maxInvocationTimeoutMs,
          retryAttempts: policy.callJsonRetryAttempts,
          sessionId:
            input.clarificationSession?.id ??
            input.request.clarificationSessionId,
        }
      );
    } catch (error) {
      const errMsg = errorMessage(error);
      const isTimeout = /abort|timeout/i.test(errMsg);
      const redactedMsg = applySpecDocumentsRedaction(errMsg, policy);
      ctx.logger.warn(
        "spec-documents llm: callJson threw, using fallback",
        {
          promptId: prompt.promptId,
          error: redactedMsg,
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
        }
      );
      const rawReason = isTimeout
        ? "llm timeout"
        : `llm callJson threw: ${errMsg}`;
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: applySpecDocumentsRedaction(rawReason, policy).slice(
          0,
          policy.maxErrorLength
        ),
      };
    }

    // ---- 档位 4：非 JSON / undefined / null / 非 object → llm_fallback -----
    if (
      rawPayload === undefined ||
      rawPayload === null ||
      typeof rawPayload !== "object"
    ) {
      ctx.logger.warn(
        "spec-documents llm: non-json response, using fallback",
        {
          promptId: prompt.promptId,
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
        }
      );
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: "non-json response",
      };
    }

    // ---- 档位 5：Strict zod + .superRefine() 不变量 -------------------------
    const parsed = SpecDocumentsLlmResponseSchema.safeParse(rawPayload);
    if (!parsed.success) {
      const schemaErrMsg = parsed.error.message;
      const redactedMsg = applySpecDocumentsRedaction(schemaErrMsg, policy);
      ctx.logger.warn(
        "spec-documents llm: schema validation failed, using fallback",
        {
          promptId: prompt.promptId,
          errorMsg: redactedMsg,
          nodeId: input.specTreeNode.id,
          type: input.targetDocumentType,
        }
      );
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: applySpecDocumentsRedaction(
          `schema validation failed: ${schemaErrMsg}`,
          policy
        ).slice(0, policy.maxErrorLength),
      };
    }

    // ---- 档位 6：Happy path — normalize + 渲染 Markdown + 计算 digests -----
    const normalized = normalizeSpecDocumentsResponse(parsed.data, policy);
    const content = renderSectionsToMarkdown({
      title: normalized.title,
      summary: normalized.summary,
      sections: normalized.sections,
    });
    const structuredPayloadDigest = `sha256:${sha256Hex(
      JSON.stringify(normalized)
    )}`;
    const responseDigest = `sha256:${sha256Hex(JSON.stringify(rawPayload))}`;
    const reasoningGraph = parseBrainstormReasoningGraphPayload({
      payload: rawPayload,
      jobId: input.jobId,
      stage: "spec_docs",
      subStage: input.targetDocumentType,
      fallbackQuestionTitle: `${input.targetDocumentType}: ${input.specTreeNode.title}`,
      createdAt: input.createdAt,
    });

    return {
      generationSource: "llm",
      title: normalized.title,
      summary: normalized.summary,
      content,
      status: normalized.status,
      promptId: prompt.promptId,
      model,
      promptFingerprint: prompt.promptFingerprint,
      responseDigest,
      structuredPayloadDigest,
      reasoningGraph: reasoningGraph ?? undefined,
    };
  };
}
