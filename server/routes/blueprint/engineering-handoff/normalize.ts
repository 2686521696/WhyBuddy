/**
 * Engineering Handoff LLM — response normalizer.
 *
 * Normalizes a zod-validated LLM response into a canonical shape that downstream
 * renderers (and the outer `buildEngineeringLandingPlan` hook) can consume
 * without needing to re-handle optionality or casing edge cases.
 *
 * Normalization steps (design §D8 / §4.4):
 * 1. Trim all string fields.
 * 2. Generate missing `steps[*].id` values by slugifying the title; dedupe
 *    with `-2` / `-3` suffixes for title collisions.
 * 3. Dedupe (preserve order) `steps[*].fileScopes` / `verificationCommands` /
 *    `sourceNodeIds` / `sourceDocumentIds` / `sourcePreviewIds` /
 *    `promptPackageIds`.
 * 4. Fill missing `riskLevel` using a pure riskLevel resolver.
 * 5. Fill missing source/prompt package id arrays with promptPackage-derived
 *    defaults.
 * 6. Defensively clip over-long strings.
 * 7. Pass through `missionMetadata` as-is (unknown fields already stripped).
 */

import type {
  BlueprintEngineeringLandingPlanStatus,
  BlueprintEngineeringLandingRiskLevel,
  BlueprintEngineeringLandingStepMode,
} from "../../../../shared/blueprint/index.js";

import type { EngineeringHandoffLlmPolicy } from "./policy.js";
import type {
  EngineeringHandoffLlmHandoff,
  EngineeringHandoffLlmMissionMetadata,
  EngineeringHandoffLlmResponse,
  EngineeringHandoffLlmRiskNote,
  EngineeringHandoffLlmStep,
  EngineeringHandoffSchemaInput,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Pure riskLevel resolver (mirrors server/routes/blueprint.ts)
// ---------------------------------------------------------------------------

/**
 * Pure mirror of the riskLevel derivation used by today's
 * `buildEngineeringLandingSteps()`.
 */
export function resolveEngineeringStepRiskLevelPure(
  planStatus: BlueprintEngineeringLandingPlanStatus,
  mode: BlueprintEngineeringLandingStepMode,
): BlueprintEngineeringLandingRiskLevel {
  if (planStatus === "draft") {
    return mode === "automatic" ? "medium" : "high";
  }
  return mode === "automatic" ? "low" : "medium";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedEngineeringStep {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly mode: BlueprintEngineeringLandingStepMode;
  readonly fileScopes: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly riskLevel: BlueprintEngineeringLandingRiskLevel;
  readonly sourceNodeIds: readonly string[];
  readonly sourceDocumentIds: readonly string[];
  readonly sourcePreviewIds: readonly string[];
  readonly promptPackageIds: readonly string[];
}

export interface NormalizedEngineeringHandoff {
  readonly platform: EngineeringHandoffLlmHandoff["platform"];
  readonly promptPackageId?: string;
  readonly summary?: string;
}

export interface NormalizedEngineeringRiskNote {
  readonly level: EngineeringHandoffLlmRiskNote["level"];
  readonly message: string;
}

export interface NormalizeEngineeringHandoffInput {
  readonly validated: EngineeringHandoffLlmResponse;
  readonly resolverInput: EngineeringHandoffSchemaInput;
  readonly policy: EngineeringHandoffLlmPolicy;
  readonly status: BlueprintEngineeringLandingPlanStatus;
}

export interface NormalizeEngineeringHandoffOutput {
  readonly title: string;
  readonly summary: string;
  readonly missionSummary: string;
  readonly missionMetadata: EngineeringHandoffLlmMissionMetadata;
  readonly steps: readonly NormalizedEngineeringStep[];
  readonly handoffs: readonly NormalizedEngineeringHandoff[];
  readonly acceptanceCriteria: readonly string[];
  readonly riskNotes: readonly NormalizedEngineeringRiskNote[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "step";
}

function dedupePreserveOrder<T>(values: readonly T[] | undefined): T[] {
  if (!values) {
    return [];
  }
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function safeClip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  // Clip at character boundary — String slice by code units is safe for BMP
  // and well-formed UTF-16 strings; avoid cutting surrogate pairs by stepping
  // back when the final code unit is a high surrogate.
  let end = maxLength;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }
  return value.slice(0, end);
}

function buildDefaultPromptPackageIds(
  resolver: EngineeringHandoffSchemaInput,
): readonly string[] {
  return [resolver.promptPackage.id];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Normalize a validated Engineering Handoff LLM response. Pure function.
 */
export function normalizeEngineeringHandoffResponse(
  input: NormalizeEngineeringHandoffInput,
): NormalizeEngineeringHandoffOutput {
  const { validated, resolverInput, policy, status } = input;

  // (1) Trim top-level strings + defensive length clip.
  const title = safeClip(validated.title.trim(), policy.maxTitleLength);
  const summary = safeClip(validated.summary.trim(), policy.maxSummaryLength);
  const missionSummary = safeClip(
    validated.missionSummary.trim(),
    policy.maxMissionSummaryLength,
  );

  // (7) missionMetadata — zod already stripped unknown fields; pass through.
  const missionMetadata = validated.missionMetadata;

  // Defaults for missing source/prompt package id arrays.
  const defaultSourceNodeIds = dedupePreserveOrder(
    resolverInput.promptPackage.nodeIds,
  );
  const defaultSourceDocumentIds = dedupePreserveOrder(
    resolverInput.promptPackage.sourceDocumentIds,
  );
  const defaultSourcePreviewIds = dedupePreserveOrder(
    resolverInput.promptPackage.sourcePreviewIds,
  );
  const defaultPromptPackageIds = buildDefaultPromptPackageIds(resolverInput);

  // (2) + (3) + (4) + (5) + (6) Steps.
  const usedIds = new Map<string, number>();
  const steps: NormalizedEngineeringStep[] = validated.steps.map(step => {
    const trimmedTitle = safeClip(
      step.title.trim(),
      policy.maxStepTitleLength,
    );
    const trimmedSummary = safeClip(
      step.summary.trim(),
      policy.maxStepSummaryLength,
    );

    // (2) Step id: either trim the provided value or slugify the title.
    let id: string;
    if (step.id !== undefined) {
      id = safeClip(step.id.trim(), policy.maxStepIdLength);
    } else {
      const slug = slugify(trimmedTitle);
      const count = usedIds.get(slug) ?? 0;
      id = count === 0 ? slug : `${slug}-${count + 1}`;
      usedIds.set(slug, count + 1);
    }
    if (step.id === undefined) {
      // Already recorded above.
    } else {
      const key = id.toLowerCase();
      usedIds.set(key, (usedIds.get(key) ?? 0) + 1);
    }

    // (3) Dedupe arrays.
    const fileScopes = dedupePreserveOrder(step.fileScopes).map(scope =>
      safeClip(scope.trim(), policy.maxFileScopeLength),
    );
    const verificationCommands = dedupePreserveOrder(
      step.verificationCommands,
    ).map(cmd =>
      safeClip(cmd.trim(), policy.maxVerificationCommandLength),
    );

    // (5) Source id arrays: LLM-provided (deduped) preferred, else defaults.
    const sourceNodeIds =
      step.sourceNodeIds !== undefined
        ? dedupePreserveOrder(step.sourceNodeIds)
        : defaultSourceNodeIds.slice();
    const sourceDocumentIds =
      step.sourceDocumentIds !== undefined
        ? dedupePreserveOrder(step.sourceDocumentIds)
        : defaultSourceDocumentIds.slice();
    const sourcePreviewIds =
      step.sourcePreviewIds !== undefined
        ? dedupePreserveOrder(step.sourcePreviewIds)
        : defaultSourcePreviewIds.slice();
    const promptPackageIds =
      step.promptPackageIds !== undefined
        ? dedupePreserveOrder(step.promptPackageIds)
        : defaultPromptPackageIds.slice();

    // (4) riskLevel fallback.
    const riskLevel: BlueprintEngineeringLandingRiskLevel =
      step.riskLevel ?? resolveEngineeringStepRiskLevelPure(status, step.mode);

    return {
      id,
      title: trimmedTitle,
      summary: trimmedSummary,
      mode: step.mode,
      fileScopes,
      verificationCommands,
      riskLevel,
      sourceNodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
      promptPackageIds,
    };
  });

  // Ensure step id uniqueness after normalization. Rare edge case where
  // the LLM provided duplicate ids that schema already rejected; guard here
  // in case this function is called from non-schema callers in the future.
  const idSet = new Set<string>();
  for (let i = 0; i < steps.length; i += 1) {
    let candidate = steps[i].id;
    let suffix = 2;
    while (idSet.has(candidate.toLowerCase())) {
      candidate = `${steps[i].id}-${suffix}`;
      suffix += 1;
    }
    idSet.add(candidate.toLowerCase());
    if (candidate !== steps[i].id) {
      (steps as NormalizedEngineeringStep[])[i] = {
        ...steps[i],
        id: candidate,
      };
    }
  }

  // Handoffs.
  const handoffs: NormalizedEngineeringHandoff[] = validated.handoffs.map(
    handoff => ({
      platform: handoff.platform,
      promptPackageId: handoff.promptPackageId,
      summary:
        handoff.summary !== undefined
          ? safeClip(handoff.summary.trim(), policy.maxHandoffSummaryLength)
          : undefined,
    }),
  );

  // Acceptance criteria.
  const acceptanceCriteria = validated.acceptanceCriteria.map(criterion =>
    safeClip(criterion.trim(), policy.maxAcceptanceCriterionLength),
  );

  // Risk notes.
  const riskNotes: NormalizedEngineeringRiskNote[] = validated.riskNotes.map(
    note => ({
      level: note.level,
      message: safeClip(note.message.trim(), policy.maxRiskNoteMessageLength),
    }),
  );

  return {
    title,
    summary,
    missionSummary,
    missionMetadata,
    steps,
    handoffs,
    acceptanceCriteria,
    riskNotes,
  };
}
