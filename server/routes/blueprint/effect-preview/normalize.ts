/**
 * Pure normalization helpers for the Effect Preview LLM service.
 *
 * Once `EffectPreviewLlmResponseSchema.safeParse(...)` succeeds the
 * payload is structurally valid (design §4.4). This module performs the
 * additional *defensive* normalisation required by design §2.D8 /
 * requirements 2.4 / 2.6 / 3.6 so the downstream assembly step
 * (`server/routes/blueprint.ts → buildEffectPreview()`) never has to
 * re-implement trim / id-backfill / timestamp-backfill semantics per
 * caller:
 *
 *  (a) trim the leading / trailing whitespace off every string field;
 *  (b) defensively clamp string lengths to the corresponding policy
 *      upper bounds (redundant with the zod `.max(...)` already applied
 *      but cheap and keeps the contract self-describing);
 *  (c) backfill missing `logTimeline[*].id` with
 *      `createId("blueprint-effect-preview-log")` so downstream event
 *      keying stays stable even when the LLM omits the hint;
 *  (d) map the schema-level `logTimeline[*].timestamp` to the canonical
 *      `BlueprintEffectPreviewLogEntry.occurredAt` field and fall back
 *      to `input.createdAt` when the LLM did not supply a value;
 *  (e) backfill `hudState.activeNodeId` with `input.activeNodeId`
 *      (typically the spec tree node id) when the LLM left it blank;
 *  (f) synthesise a stable `progressPlan[*].id` from
 *      `createId("blueprint-effect-preview-milestone")` because the LLM
 *      schema does not carry ids for milestones.
 *
 * `renderedBrowserPreview` is only emitted when
 * `validated.runtimeProjection.browserPreview` is present in the LLM
 * payload — the outer `buildEffectPreview()` is responsible for
 * assembling the default template / browser preview when the LLM
 * elected to omit it (design §2.D8, task 7.3).
 *
 * Import rules (task 7.4): this file only depends on
 * `server/core/ids.ts` + pure `import type` declarations. No runtime /
 * business module is imported so the normalizer stays trivially
 * testable and re-usable from both the service factory
 * (`service.ts`, task 10) and the co-located unit tests (task 8).
 *
 * See:
 *  - design §2.D8 (defensive normalisation after zod)
 *  - design §4.2 (`EffectPreviewLlmServiceOutput.rendered*` shapes)
 *  - design §4.4 / §4.6 (schema + fallback hierarchy)
 *  - requirements 2.4, 2.6, 3.6.
 */

import { createId } from "../../../core/ids.js";

import type {
  BlueprintEffectPreviewBrowserPreview,
  BlueprintEffectPreviewHudState,
  BlueprintEffectPreviewLogEntry,
  BlueprintEffectPreviewMilestone,
} from "../../../../shared/blueprint/index.js";

import type { EffectPreviewLlmPolicy } from "./policy.js";
import type { EffectPreviewLlmResponse } from "./schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Context required to normalise an already-validated
 * `EffectPreviewLlmResponse`.
 *
 * All three fields are supplied by the service factory
 * (`createEffectPreviewLlmService`, task 10) from the per-preview
 * `EffectPreviewLlmServiceInput`:
 *
 *  - `createdAt` — ISO timestamp used to backfill
 *    `logTimeline[*].occurredAt` when the LLM omitted a `timestamp`.
 *  - `activeNodeId` — typically the spec tree node id; used to backfill
 *    `hudState.activeNodeId` when missing so downstream HUD rendering
 *    never observes an undefined active node.
 *  - `policy` — the resolved `EffectPreviewLlmPolicy`; the normaliser
 *    uses its string-length caps as a defensive upper bound.
 */
export interface NormalizeEffectPreviewInput {
  createdAt: string;
  activeNodeId: string;
  policy: EffectPreviewLlmPolicy;
}

/**
 * Content-field projection produced by `normalizeEffectPreviewResponse`.
 *
 * The `rendered*` keys intentionally mirror
 * `EffectPreviewLlmServiceOutput` (design §4.2) so the service factory
 * can spread this object straight into its return value. The remaining
 * keys (`summary` / `architectureNotes` / `prototypeNotes` /
 * `progressPlan`) are the LLM-authored narrative fields that replace
 * the templated equivalents in the outer `buildEffectPreview()` merge
 * step.
 *
 * Notes:
 *  - `progressPlan[*].sourceDocumentIds` is initialised to `[]` here
 *    because the normaliser has no access to the source-document set
 *    (it is intentionally scoped to what the LLM produced plus the
 *    lightweight `NormalizeEffectPreviewInput`). The outer
 *    `buildEffectPreview()` merges the real source document id list in
 *    when assembling the canonical `BlueprintEffectPreviewMilestone[]`
 *    (design §2.D8 mapping rule).
 *  - `renderedHudState.progressPercent` is carried through verbatim —
 *    zod already enforces `[0, 100]` so no defensive clamp is needed.
 *  - `renderedBrowserPreview.url` remains optional: the zod schema
 *    allows the LLM to omit it, and the outer layer will decide
 *    whether to fall back to the template default URL when needed.
 */
export interface NormalizeEffectPreviewOutput {
  summary: string;
  architectureNotes: string[];
  prototypeNotes: string[];
  progressPlan: BlueprintEffectPreviewMilestone[];
  renderedHudState: Pick<
    BlueprintEffectPreviewHudState,
    | "title"
    | "summary"
    | "status"
    | "stage"
    | "progressPercent"
    | "activeNodeId"
    | "badges"
  >;
  renderedConsoleLines: string[];
  renderedLogTimeline: Array<
    Pick<
      BlueprintEffectPreviewLogEntry,
      "id" | "level" | "message" | "occurredAt"
    >
  >;
  renderedBrowserPreview?: Pick<
    BlueprintEffectPreviewBrowserPreview,
    "title" | "summary"
  > & { url?: string };
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/** Trim + defensively clamp `value` to at most `max` characters. */
function trimAndClamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Resolve a potentially-missing optional string with a fallback.
 *
 * Returns the trimmed-and-clamped original when it is a non-empty
 * string, otherwise returns `fallback` unchanged (the caller provides
 * an already-prepared fallback value).
 */
function resolveOptionalString(
  value: string | undefined,
  fallback: string,
  max: number,
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalise an already zod-validated `EffectPreviewLlmResponse` into
 * the content-field projection consumed by the Effect Preview LLM
 * service (design §4.2 / §2.D8).
 *
 * This function is pure: it does not read `process.env`, does not call
 * out to any LLM / logger / network primitive, and does not mutate
 * `validated`. All backfill values are derived from `input`.
 */
export function normalizeEffectPreviewResponse(
  validated: EffectPreviewLlmResponse,
  input: NormalizeEffectPreviewInput,
): NormalizeEffectPreviewOutput {
  const { policy } = input;

  const summary = trimAndClamp(validated.summary, policy.maxSummaryLength);

  const architectureNotes = validated.architectureNotes.map((note) =>
    trimAndClamp(note, policy.maxArchitectureNoteLength),
  );

  const prototypeNotes = validated.prototypeNotes.map((note) =>
    trimAndClamp(note, policy.maxPrototypeNoteLength),
  );

  const progressPlan: BlueprintEffectPreviewMilestone[] =
    validated.progressPlan.map((milestone) => ({
      id: createId("blueprint-effect-preview-milestone"),
      title: trimAndClamp(milestone.title, policy.maxMilestoneTitle),
      summary: trimAndClamp(milestone.summary, policy.maxMilestoneSummary),
      target: trimAndClamp(milestone.target, policy.maxMilestoneTarget),
      // The normaliser deliberately leaves `sourceDocumentIds` empty;
      // the outer `buildEffectPreview()` knows the per-preview source
      // document set and will merge the real id list during canonical
      // milestone assembly (design §2.D8 mapping rule).
      sourceDocumentIds: [],
    }));

  const hud = validated.runtimeProjection.hudState;
  const renderedHudState: NormalizeEffectPreviewOutput["renderedHudState"] = {
    title: trimAndClamp(hud.title, policy.maxHudStateTitle),
    summary: trimAndClamp(hud.summary, policy.maxHudStateSummary),
    progressPercent: hud.progressPercent,
    activeNodeId: resolveOptionalString(
      hud.activeNodeId,
      input.activeNodeId,
      // No dedicated policy cap for activeNodeId; the schema already
      // limits it to 128 characters. Re-apply the same bound so the
      // fallback path cannot accidentally exceed the schema width if a
      // caller ever passes an unusually long `input.activeNodeId`.
      128,
    ),
  };
  if (hud.status !== undefined) {
    renderedHudState.status = hud.status;
  }
  if (hud.stage !== undefined) {
    renderedHudState.stage = hud.stage;
  }
  if (Array.isArray(hud.badges)) {
    const clamped = hud.badges
      .map((badge) => trimAndClamp(badge, policy.maxHudStateBadgeLength))
      .slice(0, policy.maxHudStateBadges);
    renderedHudState.badges = clamped;
  }

  const renderedConsoleLines = validated.runtimeProjection.consoleLines.map(
    (line) => trimAndClamp(line, policy.maxConsoleLineLength),
  );

  const renderedLogTimeline = validated.runtimeProjection.logTimeline.map(
    (entry) => ({
      id:
        typeof entry.id === "string" && entry.id.trim().length > 0
          ? trimAndClamp(entry.id, policy.maxLogIdLength)
          : createId("blueprint-effect-preview-log"),
      level: entry.level,
      message: trimAndClamp(entry.message, policy.maxLogMessageLength),
      occurredAt:
        typeof entry.timestamp === "string" && entry.timestamp.trim().length > 0
          ? entry.timestamp.trim()
          : input.createdAt,
    }),
  );

  const browserPreview = validated.runtimeProjection.browserPreview;
  let renderedBrowserPreview: NormalizeEffectPreviewOutput["renderedBrowserPreview"];
  if (browserPreview !== undefined) {
    const projected: NormalizeEffectPreviewOutput["renderedBrowserPreview"] = {
      title: trimAndClamp(browserPreview.title, policy.maxBrowserPreviewTitle),
      summary: trimAndClamp(
        browserPreview.summary,
        policy.maxBrowserPreviewSummary,
      ),
    };
    if (
      typeof browserPreview.url === "string" &&
      browserPreview.url.trim().length > 0
    ) {
      projected.url = trimAndClamp(
        browserPreview.url,
        policy.maxBrowserPreviewUrlLength,
      );
    }
    renderedBrowserPreview = projected;
  }

  const output: NormalizeEffectPreviewOutput = {
    summary,
    architectureNotes,
    prototypeNotes,
    progressPlan,
    renderedHudState,
    renderedConsoleLines,
    renderedLogTimeline,
  };
  if (renderedBrowserPreview !== undefined) {
    output.renderedBrowserPreview = renderedBrowserPreview;
  }
  return output;
}
