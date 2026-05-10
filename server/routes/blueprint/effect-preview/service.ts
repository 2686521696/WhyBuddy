/**
 * Effect Preview LLM service — factory + main algorithm for the
 * `autopilot-effect-preview-llm` spec.
 *
 * `createEffectPreviewLlmService(ctx)` returns a pure async function that
 * produces a single per-preview `EffectPreviewLlmServiceOutput` for the
 * given SPEC Tree node (design §4.2 / §4.6). The service implements the
 * six-tier fallback contract:
 *
 *   Tier 1: bridge not enabled (`BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED !== "true"`)
 *           → early exit `{ generationSource: "template" }`.
 *   Tier 2: LLM `apiKey` missing → early exit `{ generationSource: "template" }`.
 *           Never call `ctx.llm.callJson` (design §2.D2 + §4.6 + §9.2).
 *   Tier 3: `ctx.llm.callJson` throws (non-timeout) OR returns a non-object /
 *           null / undefined payload → `generationSource: "llm_fallback"` with
 *           a redacted `error` capped to `policy.maxErrorLength`.
 *   Tier 4/5: zod `.safeParse` + `.superRefine` invariants fail →
 *           `generationSource: "llm_fallback"`, `error: "schema validation failed: ..."`
 *   Tier 6: `ctx.llm.callJson` throws with `/abort|timeout/i` error text →
 *           fallback with `error: "llm timeout"` (distinguished from generic
 *           tier-3 throw).
 *
 * Happy path (design §4.6 step 7):
 *   - `normalizeEffectPreviewResponse(parsed.data, { createdAt, activeNodeId, policy })`
 *   - `responseDigest   = "sha256:" + sha256Hex(JSON.stringify(rawPayload))`
 *   - `structuredPayloadDigest = "sha256:" + sha256Hex(JSON.stringify(parsed.data))`
 *   - Returns `generationSource: "llm"` with full content fields.
 *
 * Hard constraints (design §2.D1, task 10.6):
 *   - SHALL NOT `import { callLLMJson }` / `import { getAIConfig }`.
 *   - SHALL NOT call module-level `fetch()` / any HTTP client.
 *   - SHALL NOT hard-code model / provider / temperature defaults.
 *   - All LLM capability via `ctx.llm.callJson` + `ctx.llm.getConfig`.
 *   - SHALL NOT import module-level `eventBus` / `jobStore` singletons.
 *
 * See requirements 2.1-2.8, 3.5, 3.6, 4.1, 4.5, 4.6, 5.1, 7.1, 7.2, 7.4, 7.5.
 */

import { createHash } from "node:crypto";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationSession,
  BlueprintEffectPreviewBrowserPreview,
  BlueprintEffectPreviewHudState,
  BlueprintEffectPreviewLogEntry,
  BlueprintEffectPreviewMilestone,
  BlueprintGenerationJob,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

import type { BlueprintServiceContext } from "../context.js";
import {
  applyEffectPreviewRedaction,
  createDefaultEffectPreviewLlmPolicy,
  type EffectPreviewLlmPolicy,
} from "./policy.js";
import { normalizeEffectPreviewResponse } from "./normalize.js";
import { EffectPreviewLlmResponseSchema } from "./schema.js";
import {
  buildEffectPreviewPrompt,
  EFFECT_PREVIEW_PROMPT_ID,
} from "./prompt.js";

// ---------------------------------------------------------------------------
// Public types (design §4.2)
// ---------------------------------------------------------------------------

/**
 * Single invocation input for the Effect Preview LLM service.
 *
 * One `generateEffectPreviews()` request fans out to N per-preview service
 * calls (one per target SPEC Tree node). Fields mirror design §4.2:
 *
 *  - `jobId` / `job` — parent blueprint generation job (used for intake
 *    block + sessionId fallback).
 *  - `specTreeNode` — target node bound to this preview (id/title/summary/
 *    type/dependencies/outputs/priority feed the prompt).
 *  - `sourceDocuments` — the SPEC Documents attached to this node (already
 *    filtered per `includeDrafts` by the outer layer).
 *  - `primaryRoute` — the selected primary route (optional; nodes without
 *    a route still get a preview).
 *  - `clarificationSession` — used only for locale resolution + sessionId
 *    fallback.
 *  - `domainContext` / `capabilityInvocations` / `capabilityEvidence` —
 *    optional upstream evidence surfaces.
 *  - `includeDrafts` — propagated into the prompt userPayload.
 *  - `createdAt` — ISO timestamp used by `normalizeEffectPreviewResponse`
 *    to backfill missing `logTimeline[*].occurredAt`.
 */
export interface EffectPreviewLlmServiceInput {
  jobId: string;
  job: BlueprintGenerationJob;
  specTreeNode: BlueprintSpecTreeNode;
  sourceDocuments: BlueprintSpecDocument[];
  primaryRoute?: BlueprintRouteCandidate;
  clarificationSession?: BlueprintClarificationSession;
  domainContext?: BlueprintProjectDomainContext;
  capabilityInvocations?: BlueprintCapabilityInvocation[];
  capabilityEvidence?: BlueprintCapabilityEvidence[];
  includeDrafts: boolean;
  createdAt: string;
}

/**
 * Single invocation output for the Effect Preview LLM service.
 *
 *  - Real path (`generationSource: "llm"`) fills every content field +
 *    `responseDigest` / `structuredPayloadDigest` / provenance fields.
 *  - Fallback path (`"llm_fallback"`) leaves all content fields `undefined`
 *    and fills `error` + (optionally) `promptId` / `model` /
 *    `promptFingerprint` when the prompt was actually constructed.
 *  - Template path (`"template"`) returns only `generationSource: "template"`
 *    (no `error`, no `promptId`, no `model`) — the outer
 *    `buildEffectPreview()` will run the templated path unchanged.
 */
export interface EffectPreviewLlmServiceOutput {
  generationSource: "llm" | "llm_fallback" | "template";
  summary?: string;
  architectureNotes?: string[];
  prototypeNotes?: string[];
  progressPlan?: BlueprintEffectPreviewMilestone[];
  renderedHudState?: Pick<
    BlueprintEffectPreviewHudState,
    | "title"
    | "summary"
    | "status"
    | "stage"
    | "progressPercent"
    | "activeNodeId"
    | "badges"
  >;
  renderedConsoleLines?: string[];
  renderedLogTimeline?: Array<
    Pick<
      BlueprintEffectPreviewLogEntry,
      "id" | "level" | "message" | "occurredAt"
    >
  >;
  renderedBrowserPreview?: Pick<
    BlueprintEffectPreviewBrowserPreview,
    "title" | "summary"
  > & { url?: string };
  promptId?: string;
  model?: string;
  promptFingerprint?: string;
  responseDigest?: string;
  structuredPayloadDigest?: string;
  error?: string;
}

/**
 * Pure async function signature returned by the factory.
 */
export type EffectPreviewLlmService = (
  input: EffectPreviewLlmServiceInput,
) => Promise<EffectPreviewLlmServiceOutput>;

// ---------------------------------------------------------------------------
// Private helpers (pure)
// ---------------------------------------------------------------------------

const ENV_ENABLED = "BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Defensive `ctx.llm.getConfig()` wrapper.
 *
 * If a mis-configured test harness throws from `getConfig()`, the service
 * surfaces the failure as "apiKey missing" (tier 2) rather than leaking
 * the thrown error into the tier 3 error channel.
 */
function safeGetConfig(
  ctx: BlueprintServiceContext,
): { apiKey?: string; model?: string } | undefined {
  try {
    const cfg = ctx.llm.getConfig();
    return cfg as { apiKey?: string; model?: string };
  } catch {
    return undefined;
  }
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

/**
 * Apply redaction + truncate to `policy.maxErrorLength`.
 *
 * Used by every tier-3/4/5/6 fallback path so secret material never leaks
 * into `provenance.error` (requirement 4.1 / 4.5 / 5.1).
 */
function redactAndCap(
  raw: string,
  policy: EffectPreviewLlmPolicy,
): string {
  const redacted = applyEffectPreviewRedaction(raw, policy);
  return redacted.length > policy.maxErrorLength
    ? redacted.slice(0, policy.maxErrorLength)
    : redacted;
}

/**
 * Resolve the locale feeding `buildEffectPreviewPrompt`.
 *
 * `BlueprintClarificationSession` does not carry a `locale` field in the
 * current contract (see `shared/blueprint/contracts.ts`). Mirror the
 * aigc-spec-node / role-system-architecture bridges: perform a narrow
 * cast so future locale extensions remain additive, and default to
 * `en-US` when no explicit `zh-CN` is supplied (design §4.6).
 */
function resolveLocale(
  session: BlueprintClarificationSession | undefined,
): "zh-CN" | "en-US" {
  const sessionLocale = (
    session as unknown as { locale?: string } | undefined
  )?.locale;
  return sessionLocale === "zh-CN" ? "zh-CN" : "en-US";
}

// ---------------------------------------------------------------------------
// Public factory (design §4.6)
// ---------------------------------------------------------------------------

/**
 * Build an `EffectPreviewLlmService` bound to the given blueprint service
 * context.
 *
 * The factory resolves the policy exactly once in closure scope. Because
 * `BlueprintServiceContext` does not yet carry `effectPreviewLlmPolicy`
 * (task 11 adds the field), the lookup uses a narrow property-access
 * cast and falls back to `createDefaultEffectPreviewLlmPolicy()`.
 *
 * The returned async function is side-effect free aside from:
 *  - `ctx.llm.callJson` / `ctx.llm.getConfig` (injected LLM I/O).
 *  - `ctx.logger.debug` / `ctx.logger.warn` (observability only).
 * It does not read or write `ctx.eventBus`, `ctx.jobStore`, or any
 * module-level singleton.
 */
export function createEffectPreviewLlmService(
  ctx: BlueprintServiceContext,
): EffectPreviewLlmService {
  const policy: EffectPreviewLlmPolicy =
    (ctx as { effectPreviewLlmPolicy?: EffectPreviewLlmPolicy })
      .effectPreviewLlmPolicy ?? createDefaultEffectPreviewLlmPolicy();

  return async function effectPreviewLlmService(
    input: EffectPreviewLlmServiceInput,
  ): Promise<EffectPreviewLlmServiceOutput> {
    // ---- Tier 1: bridge not enabled (debug, no callJson) ------------------
    if (process.env[ENV_ENABLED] !== "true") {
      ctx.logger.debug(
        "effect-preview llm: not enabled, using template",
        { nodeId: input.specTreeNode.id },
      );
      return { generationSource: "template" };
    }

    // ---- Tier 2: apiKey missing (debug, no callJson) ----------------------
    // Merged with the template path per design §6.3.4 / §9.2: no `error`,
    // no `promptId`, no `model` — the outer layer treats it as the default
    // templated path.
    const aiConfig = safeGetConfig(ctx);
    const apiKey =
      typeof aiConfig?.apiKey === "string" ? aiConfig.apiKey : "";
    if (apiKey.length === 0) {
      ctx.logger.debug(
        "effect-preview llm: apiKey missing, using template",
        { nodeId: input.specTreeNode.id },
      );
      return { generationSource: "template" };
    }

    // ---- Build deterministic prompt (design §4.5) -------------------------
    const locale = resolveLocale(input.clarificationSession);
    const prompt = buildEffectPreviewPrompt({
      job: input.job,
      specTreeNode: input.specTreeNode,
      sourceDocuments: input.sourceDocuments,
      primaryRoute: input.primaryRoute,
      clarificationSession: input.clarificationSession,
      domainContext: input.domainContext,
      capabilityInvocations: input.capabilityInvocations,
      capabilityEvidence: input.capabilityEvidence,
      includeDrafts: input.includeDrafts,
      locale,
    });

    const model = typeof aiConfig?.model === "string" ? aiConfig.model : "";

    // ---- Call LLM (tiers 3 / 6) ------------------------------------------
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
          sessionId:
            input.clarificationSession?.id ??
            input.job.request.clarificationSessionId,
        },
      );
    } catch (error) {
      const errMsg = errorMessage(error);
      const isTimeout = /abort|timeout/i.test(errMsg);
      ctx.logger.warn(
        "effect-preview llm: callJson threw, using fallback",
        {
          promptId: prompt.promptId,
          nodeId: input.specTreeNode.id,
          error: redactAndCap(errMsg, policy),
        },
      );
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: redactAndCap(
          isTimeout ? "llm timeout" : `llm callJson threw: ${errMsg}`,
          policy,
        ),
      };
    }

    // ---- Tier 3: non-JSON / undefined / null / non-object ----------------
    if (
      rawPayload === undefined ||
      rawPayload === null ||
      typeof rawPayload !== "object"
    ) {
      ctx.logger.warn(
        "effect-preview llm: non-json response, using fallback",
        { promptId: prompt.promptId, nodeId: input.specTreeNode.id },
      );
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: redactAndCap("non-json response", policy),
      };
    }

    // ---- Tiers 4 / 5: zod schema + .superRefine invariants ---------------
    const parsed = EffectPreviewLlmResponseSchema.safeParse(rawPayload);
    if (!parsed.success) {
      const errorMsg = parsed.error.message;
      ctx.logger.warn(
        "effect-preview llm: schema validation failed, using fallback",
        {
          promptId: prompt.promptId,
          nodeId: input.specTreeNode.id,
          errorMsg: redactAndCap(errorMsg, policy),
        },
      );
      return {
        generationSource: "llm_fallback",
        promptId: prompt.promptId,
        model,
        promptFingerprint: prompt.promptFingerprint,
        error: redactAndCap(
          `schema validation failed: ${errorMsg}`,
          policy,
        ),
      };
    }

    // ---- Happy path: normalise + compute digests (design §4.6 step 7) ----
    const normalized = normalizeEffectPreviewResponse(parsed.data, {
      createdAt: input.createdAt,
      activeNodeId: input.specTreeNode.id,
      policy,
    });
    const responseDigest =
      "sha256:" + sha256Hex(JSON.stringify(rawPayload));
    const structuredPayloadDigest =
      "sha256:" + sha256Hex(JSON.stringify(parsed.data));

    const output: EffectPreviewLlmServiceOutput = {
      generationSource: "llm",
      summary: normalized.summary,
      architectureNotes: normalized.architectureNotes,
      prototypeNotes: normalized.prototypeNotes,
      progressPlan: normalized.progressPlan,
      renderedHudState: normalized.renderedHudState,
      renderedConsoleLines: normalized.renderedConsoleLines,
      renderedLogTimeline: normalized.renderedLogTimeline,
      promptId: prompt.promptId,
      model,
      promptFingerprint: prompt.promptFingerprint,
      responseDigest,
      structuredPayloadDigest,
    };
    if (normalized.renderedBrowserPreview !== undefined) {
      output.renderedBrowserPreview = normalized.renderedBrowserPreview;
    }
    // Sanity assertion: all real-path outputs carry the stable prompt id
    // constant; this protects against future prompt module refactors that
    // might silently rebind `promptId` via `prompt.promptId` alone.
    if (output.promptId !== EFFECT_PREVIEW_PROMPT_ID) {
      output.promptId = EFFECT_PREVIEW_PROMPT_ID;
    }
    return output;
  };
}
