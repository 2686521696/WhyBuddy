/**
 * Strict zod schema for Effect Preview LLM response validation.
 *
 * Used by the Effect Preview LLM service
 * (autopilot-effect-preview-llm spec) to validate the structured
 * preview payload returned from `ctx.llm.callJson`.
 *
 * Contract (per design §4.4 / requirements 3.1 / 3.2 / 3.3 / 3.4 / 3.5):
 * - Top-level fields: `summary` (1..500), `architectureNotes` (1..8
 *   entries, each 1..400), `prototypeNotes` (1..12 entries, each 1..400),
 *   `progressPlan` (1..20 entries), `runtimeProjection` (required).
 * - `runtimeProjection.hudState.title` is required (1..200);
 *   `runtimeProjection.consoleLines` (1..40 entries, each 1..500);
 *   `runtimeProjection.logTimeline` (1..40 entries);
 *   `runtimeProjection.browserPreview` optional.
 * - `.superRefine()` enforces seven cross-field invariants: trimmed
 *   non-empty strings, case-insensitive unique `progressPlan[].title`,
 *   case-insensitive unique `logTimeline[].id` (when provided), and
 *   presence of `browserPreview.title` / `summary` when provided.
 * - No `.strict()` — zod default strip silently drops unknown top-level
 *   fields (design §2.D8).
 * - No `.transform()` / `z.coerce.*` / `z.preprocess()` coerce chains
 *   (requirement 3.2) — responses either strictly match or fall back.
 *
 * No runtime / business imports — this file is a pure schema module;
 * only `import { z } from "zod"` is allowed (requirement / task 3.10).
 */

import { z } from "zod";

/**
 * Single milestone inside `progressPlan`.
 *
 * Field widths align with `BlueprintEffectPreviewMilestone` semantics
 * (design §4.4). `title` / `summary` / `target` are each required and
 * must trim to a non-empty string (enforced by the parent
 * `.superRefine()`).
 */
export const MilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  target: z.string().min(1).max(200),
});

/**
 * Single entry inside `runtimeProjection.logTimeline`.
 *
 * `id` and `timestamp` are optional — missing values are backfilled by
 * `normalizeEffectPreviewResponse()` with a generated id prefix and
 * `input.createdAt` respectively. `level` is restricted to the three
 * taxonomy tokens driving the front-end HUD timeline color palette.
 */
export const LogEntrySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  level: z.enum(["info", "warning", "success"]),
  message: z.string().min(1).max(500),
  timestamp: z.string().min(1).max(64).optional(),
});

/**
 * `runtimeProjection.hudState` — drives the task wall HUD and the
 * cockpit driving state surface.
 *
 * `title` and `summary` are required non-empty strings; `status` /
 * `stage` / `activeNodeId` / `badges` are optional and backfilled by
 * the outer layer when missing (design §4.4 / §2.D8).
 */
export const HudStateSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  status: z.enum(["preview", "completed"]).optional(),
  stage: z
    .enum([
      "intake",
      "routeset",
      "spec_tree",
      "spec_document",
      "effect_preview",
      "prompt_package",
      "engineering_handoff",
    ])
    .optional(),
  progressPercent: z.number().min(0).max(100),
  activeNodeId: z.string().min(1).max(128).optional(),
  badges: z.array(z.string().min(1).max(64)).max(8).optional(),
});

/**
 * Optional browser preview block inside `runtimeProjection`.
 *
 * Filled only when the LLM decided a browser-facing projection is
 * relevant; otherwise the outer layer keeps the existing template
 * default.
 */
export const BrowserPreviewSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  url: z.string().max(1024).optional(),
});

/**
 * `runtimeProjection` aggregate — bundles HUD, console lines, log
 * timeline and the optional browser preview. Structural identifier
 * fields (`id` / `jobId` / `specTreeId` / ... ) are NOT part of this
 * schema: they are derived by the outer layer (design §2.D3 / §4.4).
 */
export const RuntimeProjectionSchema = z.object({
  hudState: HudStateSchema,
  consoleLines: z.array(z.string().min(1).max(500)).min(1).max(40),
  logTimeline: z.array(LogEntrySchema).min(1).max(40),
  browserPreview: BrowserPreviewSchema.optional(),
});

/**
 * Top-level schema for the Effect Preview LLM response payload.
 *
 * `.superRefine()` enforces the seven preview-level invariants listed
 * in design §4.4:
 *
 *  1. `summary` trims to a non-empty string.
 *  2. Every `architectureNotes[]` / `prototypeNotes[]` entry trims to a
 *     non-empty string.
 *  3. Every `progressPlan[].title` / `summary` / `target` trims to a
 *     non-empty string, and `title` is unique within the payload
 *     (case-insensitive comparison).
 *  4. `hudState.title` and `hudState.summary` trim to non-empty strings.
 *  5. Every `consoleLines[]` entry trims to a non-empty string.
 *  6. Every `logTimeline[].message` trims to a non-empty string, and
 *     `logTimeline[].id` (when provided) is unique within the payload
 *     (case-insensitive comparison).
 *  7. When `browserPreview` is provided, its `title` / `summary` both
 *     trim to non-empty strings.
 *
 * Each invariant calls `ctx.addIssue(...)` and then `return`s to avoid
 * cascading errors from later invariants.
 */
export const EffectPreviewLlmResponseSchema = z
  .object({
    summary: z.string().min(1).max(500),
    architectureNotes: z.array(z.string().min(1).max(400)).min(1).max(8),
    prototypeNotes: z.array(z.string().min(1).max(400)).min(1).max(12),
    progressPlan: z.array(MilestoneSchema).min(1).max(20),
    runtimeProjection: RuntimeProjectionSchema,
  })
  .superRefine((data, ctx) => {
    // Invariant 1: `summary` trims to a non-empty string.
    if (data.summary.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "summary must be a non-empty string after trim",
      });
      return;
    }

    // Invariant 2: every `architectureNotes[]` / `prototypeNotes[]`
    // entry trims to a non-empty string.
    for (let i = 0; i < data.architectureNotes.length; i++) {
      if (data.architectureNotes[i].trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["architectureNotes", i],
          message:
            "architectureNotes[] entries must be non-empty strings after trim",
        });
        return;
      }
    }
    for (let i = 0; i < data.prototypeNotes.length; i++) {
      if (data.prototypeNotes[i].trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prototypeNotes", i],
          message:
            "prototypeNotes[] entries must be non-empty strings after trim",
        });
        return;
      }
    }

    // Invariant 3: every `progressPlan[]` string field trims to a
    // non-empty string, and `title` is unique (case-insensitive).
    const seenMilestoneTitles = new Set<string>();
    for (let i = 0; i < data.progressPlan.length; i++) {
      const milestone = data.progressPlan[i];
      if (milestone.title.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["progressPlan", i, "title"],
          message: "progressPlan[].title must be non-empty after trim",
        });
        return;
      }
      if (milestone.summary.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["progressPlan", i, "summary"],
          message: "progressPlan[].summary must be non-empty after trim",
        });
        return;
      }
      if (milestone.target.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["progressPlan", i, "target"],
          message: "progressPlan[].target must be non-empty after trim",
        });
        return;
      }
      const normalizedTitle = milestone.title.trim().toLowerCase();
      if (seenMilestoneTitles.has(normalizedTitle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["progressPlan", i, "title"],
          message: `progressPlan[].title must be unique (case-insensitive) within a single preview; duplicated title="${milestone.title}"`,
        });
        return;
      }
      seenMilestoneTitles.add(normalizedTitle);
    }

    // Invariant 4: `hudState.title` and `hudState.summary` trim to
    // non-empty strings.
    if (data.runtimeProjection.hudState.title.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeProjection", "hudState", "title"],
        message: "runtimeProjection.hudState.title must be non-empty after trim",
      });
      return;
    }
    if (data.runtimeProjection.hudState.summary.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeProjection", "hudState", "summary"],
        message:
          "runtimeProjection.hudState.summary must be non-empty after trim",
      });
      return;
    }

    // Invariant 5: every `consoleLines[]` entry trims to a non-empty
    // string.
    for (let i = 0; i < data.runtimeProjection.consoleLines.length; i++) {
      if (data.runtimeProjection.consoleLines[i].trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeProjection", "consoleLines", i],
          message:
            "runtimeProjection.consoleLines[] entries must be non-empty strings after trim",
        });
        return;
      }
    }

    // Invariant 6: every `logTimeline[].message` trims to a non-empty
    // string, and `logTimeline[].id` (when provided) is unique within
    // the payload (case-insensitive).
    const seenLogIds = new Set<string>();
    for (let i = 0; i < data.runtimeProjection.logTimeline.length; i++) {
      const entry = data.runtimeProjection.logTimeline[i];
      if (entry.message.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeProjection", "logTimeline", i, "message"],
          message:
            "runtimeProjection.logTimeline[].message must be non-empty after trim",
        });
        return;
      }
      if (typeof entry.id === "string") {
        const normalizedId = entry.id.trim().toLowerCase();
        if (seenLogIds.has(normalizedId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["runtimeProjection", "logTimeline", i, "id"],
            message: `duplicated logTimeline id within a single preview (case-insensitive); duplicated id="${entry.id}"`,
          });
          return;
        }
        seenLogIds.add(normalizedId);
      }
    }

    // Invariant 7: when `browserPreview` is provided, its `title` /
    // `summary` both trim to non-empty strings.
    const browserPreview = data.runtimeProjection.browserPreview;
    if (browserPreview !== undefined) {
      if (browserPreview.title.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeProjection", "browserPreview", "title"],
          message:
            "runtimeProjection.browserPreview.title must be non-empty after trim",
        });
        return;
      }
      if (browserPreview.summary.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeProjection", "browserPreview", "summary"],
          message:
            "runtimeProjection.browserPreview.summary must be non-empty after trim",
        });
        return;
      }
    }
  });

/**
 * Inferred type for a validated Effect Preview LLM response payload.
 */
export type EffectPreviewLlmResponse = z.infer<
  typeof EffectPreviewLlmResponseSchema
>;
