/**
 * Engineering Handoff LLM — strict zod schema factory for LLM response validation.
 *
 * This module owns the runtime validation surface for the Engineering Handoff
 * LLM generator. A fresh schema is produced per invocation via
 * {@link createEngineeringHandoffLlmResponseSchema} so `.superRefine` closures
 * can capture the resolvable id sets and the expected target platform.
 *
 * Hard constraints (design §2.D8, §3.3):
 * - No `.strict()`; zod default strip behavior silently drops unknown keys.
 * - No `.transform(...)` / `z.coerce.*` / `z.preprocess(...)` coercion chains.
 * - Only `zod` and `import type` shared blueprint types are imported.
 * - No runtime / business module imports; no HTTP client imports.
 */

import { z } from "zod";

import type {
  BlueprintEffectPreview,
  BlueprintImplementationPromptPackage,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

// ---------------------------------------------------------------------------
// Leaf enum schemas (design §4.4)
// ---------------------------------------------------------------------------

const StepModeSchema = z.enum(["automatic", "manual", "handoff"]);
const RiskLevelSchema = z.enum(["low", "medium", "high"]);
const RiskNoteLevelSchema = z.enum(["info", "warning", "critical"]);
const PlatformSchema = z.enum([
  "codex",
  "claude",
  "cursor",
  "kiro",
  "trae",
  "windsurf",
]);

// ---------------------------------------------------------------------------
// Leaf object schemas (design §4.4)
// ---------------------------------------------------------------------------

const StepSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  mode: StepModeSchema,
  fileScopes: z.array(z.string().min(1).max(200)).min(0).max(50).optional(),
  verificationCommands: z
    .array(z.string().min(1).max(500))
    .min(0)
    .max(20)
    .optional(),
  riskLevel: RiskLevelSchema.optional(),
  sourceNodeIds: z.array(z.string().min(1).max(128)).min(0).max(50).optional(),
  sourceDocumentIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(50)
    .optional(),
  sourcePreviewIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(20)
    .optional(),
  promptPackageIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(10)
    .optional(),
});

const HandoffSchema = z.object({
  platform: PlatformSchema,
  promptPackageId: z.string().min(1).max(128).optional(),
  summary: z.string().min(1).max(500).optional(),
});

const RiskNoteSchema = z.object({
  level: RiskNoteLevelSchema,
  message: z.string().min(1).max(500),
});

const MissionMetadataSchema = z.object({
  targetPlatform: z.string().min(1).max(64).optional(),
  sourceNodeIds: z.array(z.string().min(1).max(128)).min(0).max(50).optional(),
  sourceDocumentIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(50)
    .optional(),
  sourcePreviewIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(20)
    .optional(),
  promptPackageIds: z
    .array(z.string().min(1).max(128))
    .min(0)
    .max(10)
    .optional(),
});

// ---------------------------------------------------------------------------
// Exported types (design §4.4)
// ---------------------------------------------------------------------------

export type EngineeringHandoffLlmStep = z.infer<typeof StepSchema>;
export type EngineeringHandoffLlmHandoff = z.infer<typeof HandoffSchema>;
export type EngineeringHandoffLlmRiskNote = z.infer<typeof RiskNoteSchema>;
export type EngineeringHandoffLlmMissionMetadata = z.infer<
  typeof MissionMetadataSchema
>;

/**
 * Input required to build the per-invocation response schema. Provides the
 * resolvable id sets and the expected target platform used by
 * {@link createEngineeringHandoffLlmResponseSchema}'s `.superRefine` closures.
 */
export interface EngineeringHandoffSchemaInput {
  readonly promptPackage: BlueprintImplementationPromptPackage;
  readonly sourceNodes: readonly BlueprintSpecTreeNode[];
  readonly sourceDocuments: readonly BlueprintSpecDocument[];
  readonly sourcePreviews: readonly BlueprintEffectPreview[];
}

/**
 * Build the strict response schema for the Engineering Handoff LLM generator.
 *
 * The schema enforces leaf-level length bounds, enum membership, plus plan-level
 * cross-field invariants via `.superRefine` (design §4.4 / §3.4):
 * - All string fields (title / summary / missionSummary / steps[*].title /
 *   steps[*].summary / steps[*].fileScopes[*] / steps[*].verificationCommands[*] /
 *   acceptanceCriteria[*] / riskNotes[*].message / handoffs[*].summary?) must
 *   be non-empty after trim.
 * - `steps[*].id` values must be unique within a plan (compared case-insensitively
 *   after trim).
 * - `steps[*].sourceNodeIds` must resolve to `input.promptPackage.nodeIds ∪
 *   input.sourceNodes.map(.id)`.
 * - `steps[*].sourceDocumentIds` must resolve to `input.promptPackage.sourceDocumentIds ∪
 *   input.sourceDocuments.map(.id)`.
 * - `steps[*].sourcePreviewIds` must resolve to `input.promptPackage.sourcePreviewIds ∪
 *   input.sourcePreviews.map(.id)`.
 * - `steps[*].promptPackageIds` must equal `[input.promptPackage.id]`.
 * - `handoffs[*].platform` must equal `input.promptPackage.targetPlatform`.
 * - `handoffs[*].promptPackageId` (if provided) must equal `input.promptPackage.id`.
 */
export function createEngineeringHandoffLlmResponseSchema(
  input: EngineeringHandoffSchemaInput,
) {
  const resolvableNodeIds = new Set<string>([
    ...input.promptPackage.nodeIds,
    ...input.sourceNodes.map(node => node.id),
  ]);
  const resolvableDocumentIds = new Set<string>([
    ...input.promptPackage.sourceDocumentIds,
    ...input.sourceDocuments.map(document => document.id),
  ]);
  const resolvablePreviewIds = new Set<string>([
    ...input.promptPackage.sourcePreviewIds,
    ...input.sourcePreviews.map(preview => preview.id),
  ]);
  const resolvablePromptPackageIds = new Set<string>([input.promptPackage.id]);
  const expectedPlatform = input.promptPackage.targetPlatform;

  return z
    .object({
      title: z.string().min(1).max(200),
      summary: z.string().min(1).max(500),
      missionSummary: z.string().min(1).max(1000),
      missionMetadata: MissionMetadataSchema.default({}),
      steps: z.array(StepSchema).min(1).max(30),
      acceptanceCriteria: z
        .array(z.string().min(1).max(500))
        .min(1)
        .max(20),
      riskNotes: z.array(RiskNoteSchema).min(0).max(20),
      handoffs: z.array(HandoffSchema).min(1).max(10),
    })
    .superRefine((data, ctx) => {
      // (1) Top-level strings must be non-empty after trim.
      if (data.title.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["title"],
          message: "title must be non-empty after trim",
        });
      }
      if (data.summary.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["summary"],
          message: "summary must be non-empty after trim",
        });
      }
      if (data.missionSummary.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["missionSummary"],
          message: "missionSummary must be non-empty after trim",
        });
      }

      // (2) steps[*].id must be unique after trim + lowercase.
      const idToFirstIndex = new Map<string, number>();
      data.steps.forEach((step, index) => {
        if (step.id === undefined) {
          return;
        }
        const key = step.id.trim().toLowerCase();
        if (key.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "id"],
            message: "steps[].id must be non-empty after trim",
          });
          return;
        }
        const firstIndex = idToFirstIndex.get(key);
        if (firstIndex !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "id"],
            message: `steps[].id must be unique within the plan; duplicate of index ${firstIndex}`,
          });
        } else {
          idToFirstIndex.set(key, index);
        }
      });

      // (3) All other string fields must be non-empty after trim.
      data.steps.forEach((step, stepIndex) => {
        if (step.title.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", stepIndex, "title"],
            message: "steps[].title must be non-empty after trim",
          });
        }
        if (step.summary.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", stepIndex, "summary"],
            message: "steps[].summary must be non-empty after trim",
          });
        }
        step.fileScopes?.forEach((scope, scopeIndex) => {
          if (scope.trim().length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "fileScopes", scopeIndex],
              message: "steps[].fileScopes[] must be non-empty after trim",
            });
          }
        });
        step.verificationCommands?.forEach((cmd, cmdIndex) => {
          if (cmd.trim().length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "verificationCommands", cmdIndex],
              message:
                "steps[].verificationCommands[] must be non-empty after trim",
            });
          }
        });
      });
      data.acceptanceCriteria.forEach((criterion, index) => {
        if (criterion.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["acceptanceCriteria", index],
            message: "acceptanceCriteria[] must be non-empty after trim",
          });
        }
      });
      data.riskNotes.forEach((note, index) => {
        if (note.message.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["riskNotes", index, "message"],
            message: "riskNotes[].message must be non-empty after trim",
          });
        }
      });
      data.handoffs.forEach((handoff, index) => {
        if (handoff.summary !== undefined && handoff.summary.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["handoffs", index, "summary"],
            message: "handoffs[].summary must be non-empty after trim",
          });
        }
      });

      // (4-7) steps[*] id-reference invariants.
      data.steps.forEach((step, stepIndex) => {
        step.sourceNodeIds?.forEach((nodeId, refIndex) => {
          if (!resolvableNodeIds.has(nodeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "sourceNodeIds", refIndex],
              message: `steps[].sourceNodeIds[] does not resolve to a known node: unknown id "${nodeId}"`,
            });
          }
        });
        step.sourceDocumentIds?.forEach((documentId, refIndex) => {
          if (!resolvableDocumentIds.has(documentId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "sourceDocumentIds", refIndex],
              message: `steps[].sourceDocumentIds[] does not resolve to a known document: unknown id "${documentId}"`,
            });
          }
        });
        step.sourcePreviewIds?.forEach((previewId, refIndex) => {
          if (!resolvablePreviewIds.has(previewId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "sourcePreviewIds", refIndex],
              message: `steps[].sourcePreviewIds[] does not resolve to a known preview: unknown id "${previewId}"`,
            });
          }
        });
        step.promptPackageIds?.forEach((promptPackageId, refIndex) => {
          if (!resolvablePromptPackageIds.has(promptPackageId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["steps", stepIndex, "promptPackageIds", refIndex],
              message: `steps[].promptPackageIds[] does not resolve to the current prompt package: unknown id "${promptPackageId}"`,
            });
          }
        });
      });

      // (8) handoffs[*].platform must equal expectedPlatform.
      data.handoffs.forEach((handoff, index) => {
        if (handoff.platform !== expectedPlatform) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["handoffs", index, "platform"],
            message: `handoffs[].platform mismatch: expected "${expectedPlatform}", actual "${handoff.platform}"`,
          });
        }
      });

      // (9) handoffs[*].promptPackageId (if provided) must equal input.promptPackage.id.
      data.handoffs.forEach((handoff, index) => {
        if (
          handoff.promptPackageId !== undefined &&
          handoff.promptPackageId !== input.promptPackage.id
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["handoffs", index, "promptPackageId"],
            message: `handoffs[].promptPackageId must equal "${input.promptPackage.id}", received "${handoff.promptPackageId}"`,
          });
        }
      });
    });
}

export type EngineeringHandoffLlmResponse = z.infer<
  ReturnType<typeof createEngineeringHandoffLlmResponseSchema>
>;
