/**
 * `route-llm-generator.ts`：RouteSet LLM 驱动生成器。
 *
 * 对应 `.kiro/specs/autopilot-routeset-llm-generation/design.md` §4.3 / §4.5 / §4.6
 * 与 `tasks.md` 任务 6 的 5 个子任务：
 *
 * - 6.1 导出类型 `RouteSetLlmGeneratorInput` / `RouteSetLlmProvenanceExtras` /
 *       `RouteSetLlmGeneratorOutput` / `RouteSetLlmGenerator`，并暴露工厂
 *       `createRouteSetLlmGenerator(ctx)`。
 * - 6.2 实现 `generate(input)`：`apiKey` 缺失早退到 fallback；构造 prompt →
 *       `ctx.llm.callJson` → `safeParse` → 成功走 normalize，失败回退到模板化
 *       3 条路线并把错误摘要写入 `provenanceExtras.error`。
 * - 6.3 实现 `buildTemplatedRoutes(input)`：复现 `buildRouteSet()` 当前的三条
 *       模板路线（`Primary SPEC asset route` / `Documentation-first conservative
 *       route` / `Preview-first exploratory route`），保证与不走 LLM 时的字段结构
 *       100% 一致。
 * - 6.4 实现 `normalizeToRouteCandidates`：primary 路线 id 被重写为 caller 传入的
 *       `primaryRouteId`；alternative 路线 id 形如 `${routeSetId}:alternative-${index}`；
 *       capabilities 不在注册表时保留 LLM id 并用注册表补齐 label/kind；LLM 骨架通过
 *       `buildRouteCandidate` 的 `externalOverrides` 注入，由服务端自动补齐
 *       `steps` / `outputs`。
 * - 6.5 所有依赖**必须**走 `ctx.llm.callJson` / `ctx.llm.getConfig` / `ctx.logger.warn`；
 *       **不得** `import { callLLMJson } from "../../core/llm-client.js"` 或
 *       `import { getAIConfig } from "../../core/ai-config.js"`。
 *
 * 纯异步函数，不持有模块级单例；所有依赖通过 `BlueprintServiceContext` 注入，
 * 便于测试完全短路 LLM（见 `route-llm-generator.test.ts`）。
 */

import type {
  BlueprintCapabilityUsage,
  BlueprintClarificationSession,
  BlueprintGenerationRequest,
  BlueprintIntake,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintRuntimeCapability,
  BlueprintRuntimeCapabilityKind,
} from "../../../../shared/blueprint/index.js";
import {
  buildClarificationRouteContext,
  buildRouteCandidate,
  type BlueprintClarificationRouteContext,
} from "./route-candidate.js";
import type { BlueprintServiceContext } from "../context.js";
import {
  BlueprintRouteSetLlmResponseSchema,
  type BlueprintRouteSetLlmResponse,
} from "./route-schema.js";
import {
  buildRouteSetPrompt,
  ROUTE_SET_PROMPT_ID,
  type RouteSetPromptLocale,
} from "./route-prompt.js";

export interface RouteSetLlmGeneratorInput {
  request: BlueprintGenerationRequest;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  projectContext?: BlueprintProjectDomainContext;
  /** 调用方（`buildRouteSet`）生成的 RouteSet id；用于派生 alternative 路线 id。 */
  routeSetId: string;
  /** 调用方已决定的 primary 路线 id；normalize 阶段会把 LLM primary 路线 id 强制改写为此值。 */
  primaryRouteId: string;
  /** 与调用方 `buildRouteSet` 共享的 ISO 时间戳；当前仅用于测试可预测性，暂未写入路线字段。 */
  createdAt: string;
}

export interface RouteSetLlmProvenanceExtras {
  /**
   * RouteSet 的产出源。
   * - `"llm"`：路线完全来自 LLM；
   * - `"llm_fallback"`：尝试过 LLM 但因超时、错误或 schema 校验失败回退到模板化路线；
   * - `"template"`：未尝试 LLM（本轮暂不产出此值，仅保留枚举位以备 feature flag 接入）。
   */
  generationSource: "llm" | "llm_fallback" | "template";
  /** Prompt 版本标识，恒等于 `ROUTE_SET_PROMPT_ID`，除非显式未走 LLM。 */
  promptId?: string;
  /** 实际调用的 LLM 模型名；从 `ctx.llm.getConfig().model` 读取。 */
  model?: string;
  /**
   * 进入 fallback 的原因（LLM 错误信息或 schema 校验错误摘要）。
   * 长度被截断到 400 字符以免 provenance 被长错误文本撑爆。
   */
  error?: string;
}

export interface RouteSetLlmGeneratorOutput {
  routes: BlueprintRouteCandidate[];
  provenanceExtras: RouteSetLlmProvenanceExtras;
}

export type RouteSetLlmGenerator = (
  input: RouteSetLlmGeneratorInput,
) => Promise<RouteSetLlmGeneratorOutput>;

/**
 * 错误/校验失败摘要的最大长度（见 design §5）。避免把 zod 长错误文本塞进 provenance。
 */
const PROVENANCE_ERROR_MAX_LENGTH = 400;

const ROUTE_LLM_TIMEOUT_MS_DEFAULT = 30000;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 读取 RouteSet LLM 调用的超时毫秒数；允许通过
 * `BLUEPRINT_ROUTESET_LLM_TIMEOUT_MS` 环境变量覆盖（见 design §4.6）。
 */
function resolveTimeoutMs(): number {
  const raw = process.env.BLUEPRINT_ROUTESET_LLM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return ROUTE_LLM_TIMEOUT_MS_DEFAULT;
}

/**
 * 从 clarificationSession 派生 prompt locale。
 *
 * `BlueprintClarificationSession` 当前在 `shared/blueprint/contracts.ts` 里没有 `locale`
 * 字段，但我们采用兼容性读取：若 session 上出现 `locale === "zh-CN"`，走中文 prompt；
 * 其他情况默认英文 prompt（与 design §2.D6 选项 A 对齐）。这一兼容读取保证未来 clarification
 * 侧显式挂载 `locale` 时 RouteSet 侧无需再做签名变更。
 */
function resolveLocale(
  session: BlueprintClarificationSession | undefined,
): RouteSetPromptLocale {
  if (!session) return "en-US";
  const raw = (session as { locale?: unknown }).locale;
  return raw === "zh-CN" ? "zh-CN" : "en-US";
}

/**
 * 调用既有 `buildRouteCandidate()` 复现当前不走 LLM 时的三条模板路线。
 *
 * 三条路线（`primary` / `docs-first` / `preview-first`）的文案、riskLevel、costLevel、
 * complexity、estimatedEffort 等字段与 `server/routes/blueprint.ts` 中 `buildRouteSet()`
 * 的硬编码完全一致；唯一差异是 id 的派生方式：primary 使用 caller 传入的
 * `primaryRouteId`，两条 alternative 使用 `${routeSetId}:alternative-docs-first` 与
 * `${routeSetId}:alternative-preview-first` —— 两者与今天一致。
 */
function buildTemplatedRoutes(
  input: RouteSetLlmGeneratorInput,
): BlueprintRouteCandidate[] {
  const hasGithub = (input.request.githubUrls?.length ?? 0) > 0;
  const clarificationContext = buildClarificationRouteContext(
    input.request,
    input.clarificationSession,
  );
  const targetLabel = summarizeRequestTargetForRoutes(input.request);

  return [
    buildRouteCandidate({
      id: input.primaryRouteId,
      kind: "primary",
      title: "Primary SPEC asset route",
      summary: `Clarify ${targetLabel}, derive the durable SPEC tree, then expand documents, preview, and implementation prompts.`,
      rationale:
        "Balances product clarification, architecture analysis, and asset persistence so the selected path can become the long-lived SPEC tree.",
      riskLevel: "medium",
      costLevel: "medium",
      complexity: "balanced",
      estimatedEffort: hasGithub
        ? "2-4 analysis passes"
        : "1-3 analysis passes",
      includeGithubStep: hasGithub,
      clarificationContext,
    }),
    buildRouteCandidate({
      id: `${input.routeSetId}:alternative-docs-first`,
      kind: "alternative",
      title: "Documentation-first conservative route",
      summary:
        "Create a narrower SPEC tree first, freeze requirements/design/tasks, then preview and package prompts after review.",
      rationale:
        "Reduces downstream churn when the business boundary is still broad or governance matters more than speed.",
      riskLevel: "low",
      costLevel: "low",
      complexity: "light",
      estimatedEffort: "1-2 review passes",
      includeGithubStep: hasGithub,
      clarificationContext,
    }),
    buildRouteCandidate({
      id: `${input.routeSetId}:alternative-preview-first`,
      kind: "alternative",
      title: "Preview-first exploratory route",
      summary:
        "Push route analysis toward effect preview early, then backfill SPEC documents from the selected prototype direction.",
      rationale:
        "Useful when the user needs to see the future system effect before locking detailed specifications.",
      riskLevel: "high",
      costLevel: "high",
      complexity: "deep",
      estimatedEffort: "3-5 exploration passes",
      includeGithubStep: hasGithub,
      clarificationContext,
    }),
  ];
}

/**
 * 产出用于模板路线 `summary` 中 `"Clarify ${targetLabel}"` 片段的目标标签。
 *
 * 与 `server/routes/blueprint.ts` 里 `summarizeRequestTarget` 的行为保持一致，
 * 以保证模板化回退路径在文案层面也与今天完全相同。
 */
function summarizeRequestTargetForRoutes(
  request: BlueprintGenerationRequest,
): string {
  if (request.targetText) {
    const normalized = request.targetText.replace(/\s+/g, " ").trim();
    return normalized.length > 80
      ? `${normalized.slice(0, 77).trim()}...`
      : normalized;
  }
  const firstGithubUrl = request.githubUrls?.[0];
  if (firstGithubUrl) {
    return firstGithubUrl.replace(/^https:\/\/github\.com\//i, "GitHub ");
  }
  return "the requested product direction";
}

/**
 * Capability 注册表最小视图（只取 id / label / kind）。LLM 产出的 capability
 * 若命中注册表，会用注册表里的 label/kind 覆盖 LLM 的对应字段；未命中时 LLM
 * 的 id / label / kind / purpose 原样保留（不 fallback，见 design §4.5）。
 */
interface RouteSetCapabilityRegistryEntry {
  id: string;
  label: string;
  kind: BlueprintRuntimeCapabilityKind;
}

function projectRegistry(
  registry: BlueprintRuntimeCapability[],
): Map<string, RouteSetCapabilityRegistryEntry> {
  const map = new Map<string, RouteSetCapabilityRegistryEntry>();
  for (const capability of registry) {
    map.set(capability.id, {
      id: capability.id,
      label: capability.label,
      kind: capability.kind,
    });
  }
  return map;
}

/**
 * 将 LLM capability 条目与 capability 注册表对齐。
 *
 * - 命中注册表：保留 LLM id 与 purpose，用注册表覆盖 label / kind（对齐 contract 枚举）。
 * - 未命中注册表：原样返回（label / kind 保持 LLM 值）；`kind` 只在能被窄化到
 *   `BlueprintRuntimeCapabilityKind` 枚举时才窄化，否则保持字符串（按 `as` 断言）。
 */
function alignCapability(
  llmCapability: BlueprintRouteSetLlmResponse["routes"][number]["capabilities"][number],
  registry: Map<string, RouteSetCapabilityRegistryEntry>,
): BlueprintCapabilityUsage {
  const hit = registry.get(llmCapability.id);
  if (hit) {
    return {
      id: llmCapability.id,
      label: hit.label,
      kind: hit.kind,
      purpose: llmCapability.purpose,
    };
  }
  return {
    id: llmCapability.id,
    label: llmCapability.label,
    kind: llmCapability.kind as BlueprintRuntimeCapabilityKind,
    purpose: llmCapability.purpose,
  };
}

/**
 * 将 LLM schema 通过的 routes 规范化为 `BlueprintRouteCandidate[]`。
 *
 * 规则（design §4.5）：
 * 1. primary 路线的 id 被改写为 caller 传入的 `input.primaryRouteId`；
 * 2. 每条 alternative 路线的 id 被改写为 `${routeSetId}:alternative-${index}`，
 *    index 为 alternative 在数组中的出现顺序（从 0 开始）；
 * 3. capabilities 走 `alignCapability()` 对齐注册表（未命中保留原值）；
 * 4. 路线“骨架”通过 `buildRouteCandidate` 的 `externalOverrides` 注入，由
 *    `buildRouteCandidate` 内部统一生成 `steps` / `outputs`；这也意味着模板路径
 *    与 LLM 路径最终产出的 `BlueprintRouteCandidate` 结构**完全一致**。
 */
function normalizeToRouteCandidates(
  llmRoutes: BlueprintRouteSetLlmResponse["routes"],
  input: RouteSetLlmGeneratorInput,
  clarificationContext: BlueprintClarificationRouteContext,
  capabilityRegistry: Map<string, RouteSetCapabilityRegistryEntry>,
): BlueprintRouteCandidate[] {
  const hasGithub = (input.request.githubUrls?.length ?? 0) > 0;
  let alternativeIndex = 0;

  return llmRoutes.map((llmRoute) => {
    const kind = llmRoute.kind;
    const id =
      kind === "primary"
        ? input.primaryRouteId
        : `${input.routeSetId}:alternative-${alternativeIndex++}`;
    const capabilities = llmRoute.capabilities.map((capability) =>
      alignCapability(capability, capabilityRegistry),
    );
    return buildRouteCandidate({
      // 以 LLM 路线为骨架，`externalOverrides` 字段接管 id/kind/title/summary/rationale/
      // risk/cost/complexity/estimatedEffort/capabilities；`input` 层的值仅用作 TS 签名
      // 上的占位，实际被 overrides 替换（见 `buildRouteCandidate` 内部实现）。
      id,
      kind,
      title: llmRoute.title,
      summary: llmRoute.summary,
      rationale: llmRoute.rationale,
      riskLevel: llmRoute.riskLevel,
      costLevel: llmRoute.costLevel,
      complexity: llmRoute.complexity,
      estimatedEffort: llmRoute.estimatedEffort,
      includeGithubStep: hasGithub,
      clarificationContext,
      externalOverrides: {
        id,
        kind,
        title: llmRoute.title,
        summary: llmRoute.summary,
        rationale: llmRoute.rationale,
        riskLevel: llmRoute.riskLevel,
        costLevel: llmRoute.costLevel,
        complexity: llmRoute.complexity,
        estimatedEffort: llmRoute.estimatedEffort,
        capabilities,
      },
    });
  });
}

/**
 * 创建 RouteSet LLM 生成器工厂。
 *
 * 生成器遵循 "fail-open to templated routes" 原则：任何一步失败（apiKey 未配置 /
 * LLM 抛错 / 响应非 JSON / schema 校验失败）都回退到模板化三条路线，并把错误摘要
 * 写入 `provenanceExtras.error`，不向上抛出（见 design §5）。
 */
export function createRouteSetLlmGenerator(
  ctx: BlueprintServiceContext,
): RouteSetLlmGenerator {
  return async (input) => {
    const config = ctx.llm.getConfig();
    const promptId = ROUTE_SET_PROMPT_ID;
    const model = config.model;
    const clarificationContext = buildClarificationRouteContext(
      input.request,
      input.clarificationSession,
    );
    // Capability 注册表由 generator 本身持有一份只读副本；保持与服务端
    // `getDefaultRuntimeCapabilities()` 的 id/label/kind 对齐，但不从 blueprint.ts
    // 反向导入，避免循环依赖。未来 capability registry 落到 context 时可无缝替换。
    const capabilityRegistry = projectRegistry(getRouteSetCapabilityRegistry());

    if (!config.apiKey) {
      return {
        routes: buildTemplatedRoutes(input),
        provenanceExtras: {
          generationSource: "llm_fallback",
          promptId,
          model,
          error: "LLM provider is not configured; using templated RouteSet.",
        },
      };
    }

    try {
      const prompt = buildRouteSetPrompt({
        request: input.request,
        intake: input.intake,
        clarificationSession: input.clarificationSession,
        projectContext: input.projectContext,
        locale: resolveLocale(input.clarificationSession),
      });

      const payload = await ctx.llm.callJson(
        [
          { role: "system", content: prompt.systemMessage },
          { role: "user", content: prompt.userMessage },
        ],
        {
          model,
          temperature: 0.2,
          maxTokens: 2000,
          retryAttempts: 1,
          timeoutMs: resolveTimeoutMs(),
          sessionId:
            input.request.clarificationSessionId ?? input.request.intakeId,
        },
      );

      const parsed = BlueprintRouteSetLlmResponseSchema.safeParse(payload);
      if (!parsed.success) {
        const schemaError = `Schema validation failed: ${parsed.error.message}`;
        ctx.logger.warn("RouteSet LLM schema validation failed", {
          error: parsed.error.message,
          promptId,
        });
        return {
          routes: buildTemplatedRoutes(input),
          provenanceExtras: {
            generationSource: "llm_fallback",
            promptId,
            model,
            error: truncate(schemaError, PROVENANCE_ERROR_MAX_LENGTH),
          },
        };
      }

      const normalized = normalizeToRouteCandidates(
        parsed.data.routes,
        input,
        clarificationContext,
        capabilityRegistry,
      );
      return {
        routes: normalized,
        provenanceExtras: {
          generationSource: "llm",
          promptId,
          model,
        },
      };
    } catch (error) {
      const message = errorMessage(error);
      ctx.logger.warn("RouteSet LLM call failed, using fallback", {
        error: message,
        promptId,
      });
      return {
        routes: buildTemplatedRoutes(input),
        provenanceExtras: {
          generationSource: "llm_fallback",
          promptId,
          model,
          error: truncate(message, PROVENANCE_ERROR_MAX_LENGTH),
        },
      };
    }
  };
}

/**
 * RouteSet generator 持有的 capability 注册表（与 blueprint.ts
 * `getDefaultRuntimeCapabilities()` 的前三列字段对齐）。
 *
 * 这里故意维护一份独立的 id → label/kind 对照，而**不**从 `blueprint.ts` 反向
 * 导入 `getDefaultRuntimeCapabilities()`：
 * 1. 避免在 `blueprint.ts → route-llm-generator.ts → blueprint.ts` 之间造成循环；
 * 2. 当前 normalize 只需要 id/label/kind 三列，不需要完整 capability runtime 元数据；
 * 3. 未来若需要动态注册表，可以在 `BlueprintServiceContext` 追加
 *    `capabilityRegistry` 字段，按优先级接管此处。
 */
function getRouteSetCapabilityRegistry(): BlueprintRuntimeCapability[] {
  return [
    {
      id: "docker-analysis-sandbox",
      label: "Docker analysis sandbox",
      kind: "docker",
      purpose: "Run isolated repository analysis and deterministic command previews.",
      description:
        "Sandboxed container adapter for blueprint runtime inspection without host writes.",
      tags: ["runtime", "sandbox", "analysis"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.docker.simulated",
      inputSchema: "text/plain",
      outputTypes: ["log", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "mcp-github-source",
      label: "GitHub source reader",
      kind: "mcp",
      purpose: "Read network-backed repository context through an MCP adapter.",
      description:
        "Networked MCP source adapter used when blueprint execution needs external repository context.",
      tags: ["runtime", "mcp", "github"],
      securityLevel: "networked",
      status: "requires_approval",
      adapter: "blueprint.runtime.mcp.github.simulated",
      inputSchema: "application/json",
      outputTypes: ["document", "log"],
      supportedStages: ["route_generation", "runtime_capability"],
      requiresApproval: true,
      projectScoped: true,
    },
    {
      id: "skill-svg-architecture",
      label: "SVG architecture skill",
      kind: "skill",
      purpose: "Produce architecture diagram evidence from SPEC and preview inputs.",
      description:
        "Readonly skill adapter that summarizes architecture relationships as deterministic diagram evidence.",
      tags: ["runtime", "skill", "diagram"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.skill.svg-architecture.simulated",
      inputSchema: "text/markdown",
      outputTypes: ["diagram", "document"],
      supportedStages: ["effect_preview", "runtime_capability"],
      requiresApproval: false,
      projectScoped: false,
    },
    {
      id: "aigc-spec-node",
      label: "AIGC SPEC derivation node",
      kind: "aigc_node",
      purpose: "Derive SPEC node alternatives and evidence summaries.",
      description:
        "Sandboxed AIGC node adapter for deterministic SPEC derivation simulations.",
      tags: ["runtime", "aigc", "spec"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.aigc.spec-node.simulated",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "role-system-architecture",
      label: "System architecture role",
      kind: "role",
      purpose: "Evaluate architecture risks, handoff readiness, and role coverage.",
      description:
        "Readonly specialist role adapter for runtime capability review and execution planning.",
      tags: ["runtime", "role", "architecture"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.role.system-architecture.simulated",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "safety"],
      supportedStages: [
        "route_generation",
        "prompt_packaging",
        "runtime_capability",
        "engineering_landing",
      ],
      requiresApproval: false,
      projectScoped: false,
    },
  ];
}
