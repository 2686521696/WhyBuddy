/**
 * Engineering Handoff LLM — service factory.
 *
 * Implements the `createEngineeringHandoffLlmService(ctx)` factory described
 * in design §4.2 / §4.6. The returned service performs a six-tier fallback:
 *
 *   Tier 1: `BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED !== "true"`
 *     → `{ generationSource: "template" }` (no LLM attempt).
 *   Tier 2: `ctx.llm.getConfig().apiKey` missing
 *     → `{ generationSource: "template" }` (no LLM attempt).
 *   Tier 3: `callJson` threw or returned non-object
 *     → `{ generationSource: "llm_fallback", error, promptId, model, promptFingerprint }`.
 *   Tier 4/5: zod `safeParse` or `.superRefine` failure
 *     → `{ generationSource: "llm_fallback", error, promptId, model, promptFingerprint }`.
 *   Tier 6: abort/timeout
 *     → `{ generationSource: "llm_fallback", error: "llm timeout", ... }`.
 *
 * Happy path (`parsed.success === true`) returns `{ generationSource: "llm" }`
 * with renderedTitle / renderedSummary / renderedSummaryWithMissionPrefix /
 * renderedSteps / renderedHandoffs / missionSummary / acceptanceCriteria /
 * riskNotes / missionMetadata / responseDigest / structuredPayloadDigest /
 * promptId / model / promptFingerprint.
 *
 * Hard constraints (design §2.D1):
 * - This file MUST NOT `import { callLLMJson }` / `import { getAIConfig }`.
 * - No module-level `fetch`, no hard-coded model / temperature / provider.
 * - All LLM capability must come from `ctx.llm.callJson` + `ctx.llm.getConfig`.
 * - No module-level eventBus / jobStore singleton imports.
 */

import { createHash } from "node:crypto";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationSession,
  BlueprintEffectPreview,
  BlueprintEngineeringLandingPlanStatus,
  BlueprintGenerationJob,
  BlueprintImplementationPromptPackage,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import type { BlueprintServiceContext } from "../context.js";

import {
  applyEngineeringHandoffRedaction,
  createDefaultEngineeringHandoffLlmPolicy,
  type EngineeringHandoffLlmPolicy,
} from "./policy.js";
import {
  normalizeEngineeringHandoffResponse,
  type NormalizedEngineeringHandoff,
  type NormalizedEngineeringRiskNote,
  type NormalizedEngineeringStep,
} from "./normalize.js";
import {
  ENGINEERING_HANDOFF_PROMPT_ID,
  buildEngineeringHandoffPrompt,
} from "./prompt.js";
import { renderEngineeringHandoffSummary } from "./render.js";
import {
  createEngineeringHandoffLlmResponseSchema,
  type EngineeringHandoffLlmMissionMetadata,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Types (design §4.2)
// ---------------------------------------------------------------------------

export type EngineeringHandoffGenerationSource =
  | "llm"
  | "llm_fallback"
  | "template";

export interface EngineeringHandoffLlmServiceInput {
  readonly jobId: string;
  readonly job: BlueprintGenerationJob;
  readonly specTree: BlueprintSpecTree;
  readonly promptPackage: BlueprintImplementationPromptPackage;
  readonly sourceNodes: readonly BlueprintSpecTreeNode[];
  readonly sourceDocuments: readonly BlueprintSpecDocument[];
  readonly sourcePreviews: readonly BlueprintEffectPreview[];
  readonly selectedRoute?: BlueprintRouteCandidate;
  readonly clarificationSession?: BlueprintClarificationSession;
  readonly domainContext?: BlueprintProjectDomainContext;
  readonly capabilityInvocations?: readonly BlueprintCapabilityInvocation[];
  readonly capabilityEvidence?: readonly BlueprintCapabilityEvidence[];
  readonly status: BlueprintEngineeringLandingPlanStatus;
  readonly createdAt: string;
}

export type RenderedEngineeringStep = NormalizedEngineeringStep;
export type RenderedEngineeringHandoff = NormalizedEngineeringHandoff;
export type RenderedEngineeringRiskNote = NormalizedEngineeringRiskNote;

export interface EngineeringHandoffLlmServiceOutput {
  readonly generationSource: EngineeringHandoffGenerationSource;
  readonly renderedTitle?: string;
  readonly renderedSummary?: string;
  readonly renderedSummaryWithMissionPrefix?: string;
  readonly renderedSteps?: readonly RenderedEngineeringStep[];
  readonly renderedHandoffs?: readonly RenderedEngineeringHandoff[];
  readonly missionSummary?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly riskNotes?: readonly RenderedEngineeringRiskNote[];
  readonly missionMetadata?: EngineeringHandoffLlmMissionMetadata;
  readonly promptId?: string;
  readonly model?: string;
  readonly promptFingerprint?: string;
  readonly responseDigest?: string;
  readonly structuredPayloadDigest?: string;
  readonly error?: string;
}

export type EngineeringHandoffLlmService = (
  input: EngineeringHandoffLlmServiceInput,
) => Promise<EngineeringHandoffLlmServiceOutput>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function formatZodError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: unknown[] }).issues;
    if (Array.isArray(issues)) {
      const parts = issues.slice(0, 10).map(issue => {
        if (issue && typeof issue === "object") {
          const path = Array.isArray((issue as { path?: unknown }).path)
            ? ((issue as { path: unknown[] }).path.join(".") || "(root)")
            : "(root)";
          const message =
            typeof (issue as { message?: unknown }).message === "string"
              ? (issue as { message: string }).message
              : String(issue);
          return `${path}: ${message}`;
        }
        return String(issue);
      });
      return parts.join("; ");
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutLikeError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return /abort|timeout/i.test(message);
}

function redactError(
  message: string,
  policy: EngineeringHandoffLlmPolicy,
): string {
  const redacted = applyEngineeringHandoffRedaction(message, policy);
  return redacted.length > policy.maxErrorLength
    ? redacted.slice(0, policy.maxErrorLength)
    : redacted;
}

function redactMeta(
  meta: Record<string, unknown>,
  policy: EngineeringHandoffLlmPolicy,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string") {
      result[key] = applyEngineeringHandoffRedaction(value, policy);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveLocale(ctx: BlueprintServiceContext): string {
  try {
    const config = ctx.llm.getConfig() as { locale?: string } & Record<string, unknown>;
    if (typeof config.locale === "string" && config.locale.length > 0) {
      return config.locale;
    }
  } catch {
    // ignore — fall through to default
  }
  return "en-US";
}

function resolveSessionId(
  input: EngineeringHandoffLlmServiceInput,
): string | undefined {
  if (input.clarificationSession?.id) {
    return input.clarificationSession.id;
  }
  const jobWithSession = input.job as unknown as {
    clarificationSessionId?: string;
  };
  return jobWithSession.clarificationSessionId ?? undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the Engineering Handoff LLM service for the given context.
 *
 * The returned async function performs per-plan LLM inference with the six-tier
 * fallback documented above. It never throws — all errors are captured and
 * returned via `{ generationSource: "llm_fallback", error }` (or "template"
 * when the LLM is disabled / apiKey missing).
 */
export function createEngineeringHandoffLlmService(
  ctx: BlueprintServiceContext,
): EngineeringHandoffLlmService {
  const policy =
    ctx.engineeringHandoffLlmPolicy ??
    createDefaultEngineeringHandoffLlmPolicy();

  return async function engineeringHandoffLlmService(
    input: EngineeringHandoffLlmServiceInput,
  ): Promise<EngineeringHandoffLlmServiceOutput> {
    const promptPackageId = input.promptPackage.id;
    const baseMeta = { promptId: ENGINEERING_HANDOFF_PROMPT_ID, promptPackageId };

    // Tier 1: feature flag disabled.
    if (process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_ENABLED !== "true") {
      ctx.logger.debug(
        "engineering-handoff llm: not enabled, using template",
        redactMeta(baseMeta, policy),
      );
      return { generationSource: "template" };
    }

    // Tier 2: apiKey missing.
    let aiConfig;
    try {
      aiConfig = ctx.llm.getConfig();
    } catch (configError) {
      ctx.logger.debug(
        "engineering-handoff llm: getConfig threw, using template",
        redactMeta(
          {
            ...baseMeta,
            error:
              configError instanceof Error
                ? configError.message
                : String(configError),
          },
          policy,
        ),
      );
      return { generationSource: "template" };
    }
    if (!aiConfig.apiKey || aiConfig.apiKey.length === 0) {
      ctx.logger.debug(
        "engineering-handoff llm: apiKey missing, using template",
        redactMeta(baseMeta, policy),
      );
      return { generationSource: "template" };
    }
    const model = aiConfig.model;

    // Build prompt (deterministic).
    const locale = resolveLocale(ctx);
    const promptInput = {
      promptPackage: input.promptPackage,
      sourceNodes: input.sourceNodes,
      sourceDocuments: input.sourceDocuments,
      sourcePreviews: input.sourcePreviews,
      selectedRoute: input.selectedRoute,
      specTreeSummary: {
        id: input.specTree.id,
        version: input.specTree.version,
        nodeCount: input.specTree.nodes.length,
      },
      clarificationSession: input.clarificationSession,
      domainContext: input.domainContext,
      capabilityInvocations: input.capabilityInvocations,
      capabilityEvidence: input.capabilityEvidence,
      locale,
      status: input.status,
      intake: {
        targetText: input.job.request?.targetText,
        githubUrls: input.job.request?.githubUrls ?? [],
      },
    };
    const prompt = buildEngineeringHandoffPrompt(promptInput);
    const sessionId = resolveSessionId(input);

    // Tier 3 & Tier 6: callJson error / timeout.
    let rawPayload: unknown;
    try {
      rawPayload = await ctx.llm.callJson(
        [
          { role: "system", content: prompt.systemMessage },
          { role: "user", content: prompt.userMessage },
        ],
        {
          model,
          temperature: policy.temperature,
          timeoutMs: policy.maxInvocationTimeoutMs,
          retryAttempts: policy.callJsonRetryAttempts,
          ...(sessionId !== undefined ? { sessionId } : {}),
        } as Parameters<typeof ctx.llm.callJson>[1],
      );
    } catch (callError) {
      const errMessage =
        callError instanceof Error ? callError.message : String(callError);
      const isTimeout = isTimeoutLikeError(callError);
      const errorText = isTimeout
        ? "llm timeout"
        : redactError(`llm callJson threw: ${errMessage}`, policy);
      ctx.logger.warn(
        "engineering-handoff llm: callJson failed, falling back",
        redactMeta(
          { ...baseMeta, error: errorText, model },
          policy,
        ),
      );
      return {
        generationSource: "llm_fallback",
        promptId: ENGINEERING_HANDOFF_PROMPT_ID,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: errorText,
      };
    }

    // Tier 3: non-JSON / non-object response.
    if (
      rawPayload === undefined ||
      rawPayload === null ||
      typeof rawPayload !== "object" ||
      Array.isArray(rawPayload)
    ) {
      const errorText = "non-json response";
      ctx.logger.warn(
        "engineering-handoff llm: non-json response, falling back",
        redactMeta({ ...baseMeta, model, error: errorText }, policy),
      );
      return {
        generationSource: "llm_fallback",
        promptId: ENGINEERING_HANDOFF_PROMPT_ID,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: errorText,
      };
    }

    // Tier 4/5: schema validation + superRefine.
    const resolverInput = {
      promptPackage: input.promptPackage,
      sourceNodes: input.sourceNodes,
      sourceDocuments: input.sourceDocuments,
      sourcePreviews: input.sourcePreviews,
    };
    const schema = createEngineeringHandoffLlmResponseSchema(resolverInput);
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      const errorText = redactError(
        `schema validation failed: ${formatZodError(parsed.error)}`,
        policy,
      );
      ctx.logger.warn(
        "engineering-handoff llm: schema validation failed, falling back",
        redactMeta({ ...baseMeta, model, error: errorText }, policy),
      );
      return {
        generationSource: "llm_fallback",
        promptId: ENGINEERING_HANDOFF_PROMPT_ID,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: errorText,
      };
    }

    // Happy path.
    const normalized = normalizeEngineeringHandoffResponse({
      validated: parsed.data,
      resolverInput,
      policy,
      status: input.status,
    });
    const renderedSummaryWithMissionPrefix = renderEngineeringHandoffSummary({
      llmSummary: normalized.summary,
      missionSummary: normalized.missionSummary,
      policy,
    });
    const responseDigest = `sha256:${sha256Hex(JSON.stringify(rawPayload))}`;
    const structuredPayloadDigest = `sha256:${sha256Hex(
      JSON.stringify(parsed.data),
    )}`;

    return {
      generationSource: "llm",
      renderedTitle: normalized.title,
      renderedSummary: normalized.summary,
      renderedSummaryWithMissionPrefix,
      renderedSteps: normalized.steps,
      renderedHandoffs: normalized.handoffs,
      missionSummary: normalized.missionSummary,
      acceptanceCriteria: normalized.acceptanceCriteria,
      riskNotes: normalized.riskNotes,
      missionMetadata: normalized.missionMetadata,
      promptId: ENGINEERING_HANDOFF_PROMPT_ID,
      model,
      promptFingerprint: prompt.promptFingerprint,
      responseDigest,
      structuredPayloadDigest,
    };
  };
}
