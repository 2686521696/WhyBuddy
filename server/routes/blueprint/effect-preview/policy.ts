/**
 * Policy + redaction helpers for the Effect Preview LLM service.
 *
 * Owns:
 * - `EffectPreviewLlmPolicy` interface (schema bounds / redaction config).
 * - `createDefaultEffectPreviewLlmPolicy()` factory honoring
 *   `BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS` env override
 *   (clamped to `(0, 30_000]`; illegal / non-finite / non-positive / empty
 *   values fall back to the 30s default).
 * - `applyEffectPreviewRedaction(value, policy)` pure redaction helper.
 *
 * No runtime / business imports — this file is intentionally a pure data
 * module + pure functions so it can be imported from service.ts, tests, and
 * future shared-redaction abstractions without introducing cycles. Only
 * `process.env` is consulted, and only at factory invocation time.
 *
 * See design §4.3 / §D9, requirements 2.8 / 4.1 / 4.5 / 5.1.
 */

export interface EffectPreviewLlmPolicy {
  /** Single LLM-call + validation wall-clock upper bound (ms); never exceeds 30_000. */
  maxInvocationTimeoutMs: number;
  /** Temperature forwarded to ctx.llm.callJson. */
  temperature: number;
  /** Retry attempts forwarded to ctx.llm.callJson. */
  callJsonRetryAttempts: number;

  // --- Top-level field bounds ---
  maxSummaryLength: number;
  minArchitectureNotes: number;
  maxArchitectureNotes: number;
  maxArchitectureNoteLength: number;
  minPrototypeNotes: number;
  maxPrototypeNotes: number;
  maxPrototypeNoteLength: number;
  minProgressPlan: number;
  maxProgressPlan: number;

  // --- Milestone-level bounds ---
  maxMilestoneTitle: number;
  maxMilestoneSummary: number;
  maxMilestoneTarget: number;

  // --- Runtime projection bounds ---
  maxHudStateTitle: number;
  maxHudStateSummary: number;
  maxHudStateBadges: number;
  maxHudStateBadgeLength: number;
  minConsoleLines: number;
  maxConsoleLines: number;
  maxConsoleLineLength: number;
  minLogTimeline: number;
  maxLogTimeline: number;
  maxLogMessageLength: number;
  maxLogIdLength: number;
  maxBrowserPreviewTitle: number;
  maxBrowserPreviewSummary: number;
  maxBrowserPreviewUrlLength: number;

  // --- Redaction ---
  /** Case-insensitive keyword list for key:value redaction. */
  redactionKeywords: readonly string[];
  /** Email regex (global) for defensive redaction. */
  redactedEmailPattern: RegExp;
  /** OpenAI / Anthropic API key regex. */
  redactedApiKeyPattern: RegExp;
  /** GitHub PAT / fine-grained token regex. */
  redactedGithubPatPattern: RegExp;
  /** Error message truncation upper bound. */
  maxErrorLength: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;
const TIMEOUT_ENV_VAR = "BLUEPRINT_EFFECT_PREVIEW_LLM_TIMEOUT_MS";

function resolveTimeoutOverride(): number {
  const raw = process.env[TIMEOUT_ENV_VAR];
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

export function createDefaultEffectPreviewLlmPolicy(): EffectPreviewLlmPolicy {
  return {
    maxInvocationTimeoutMs: resolveTimeoutOverride(),
    temperature: 0.2,
    callJsonRetryAttempts: 1,

    maxSummaryLength: 500,
    minArchitectureNotes: 1,
    maxArchitectureNotes: 8,
    maxArchitectureNoteLength: 400,
    minPrototypeNotes: 1,
    maxPrototypeNotes: 12,
    maxPrototypeNoteLength: 400,
    minProgressPlan: 1,
    maxProgressPlan: 20,

    maxMilestoneTitle: 200,
    maxMilestoneSummary: 500,
    maxMilestoneTarget: 200,

    maxHudStateTitle: 200,
    maxHudStateSummary: 500,
    maxHudStateBadges: 8,
    maxHudStateBadgeLength: 64,
    minConsoleLines: 1,
    maxConsoleLines: 40,
    maxConsoleLineLength: 500,
    minLogTimeline: 1,
    maxLogTimeline: 40,
    maxLogMessageLength: 500,
    maxLogIdLength: 64,
    maxBrowserPreviewTitle: 200,
    maxBrowserPreviewSummary: 500,
    maxBrowserPreviewUrlLength: 1024,

    redactionKeywords: [
      "authorization",
      "token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "bearer",
      "access_token",
      "x-github-token",
      "openai-api-key",
    ],
    // Bounded quantifiers avoid ReDoS catastrophic backtracking when the
    // input contains long runs of word characters without an `@`: the
    // engine cannot explore all exponential splits because each side of
    // the `@` caps its match length at 64/255 characters (RFC 5321-ish
    // local/domain practical bounds).
    redactedEmailPattern: /[\w.+-]{1,64}@[\w.-]{1,255}/g,
    redactedApiKeyPattern: /\b(sk-[A-Za-z0-9]{20,}|clp_[A-Za-z0-9]{20,})\b/g,
    redactedGithubPatPattern:
      /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
    maxErrorLength: 400,
  };
}

/**
 * Escape regex metacharacters so user-supplied keywords can be safely embedded
 * inside a `new RegExp(...)` without regex-injection surprises.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Defensive redaction for strings that will be persisted to
 * `provenance.error`, logger meta, or other audit-visible fields.
 *
 * Applied in order:
 *   1. API keys (OpenAI / Anthropic-style: sk-... / clp_...)
 *   2. GitHub PATs (classic gh[pousr]_... + fine-grained github_pat_...)
 *   3. Emails
 *   4. key:value pairs for each `redactionKeywords` entry (case-insensitive)
 *
 * The key:value pattern consumes the entire remainder of the line (up to a
 * newline, comma, or semicolon) to ensure scheme-prefixed secrets such as
 * `Authorization: Bearer <jwt>` are redacted as a whole rather than leaving
 * the payload after the scheme token exposed.
 *
 * Pure, side-effect free, no dependency on ctx. Returns a new string; never
 * mutates input.
 */
export function applyEffectPreviewRedaction(
  value: string,
  policy: EffectPreviewLlmPolicy,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  let result = value;
  result = result.replace(policy.redactedApiKeyPattern, "[redacted-api-key]");
  result = result.replace(
    policy.redactedGithubPatPattern,
    "[redacted-github-token]",
  );
  // Fast path: if the input contains no `@` character it cannot contain
  // an email address; skipping the regex avoids the catastrophic
  // backtracking cost that `[\w.+-]{1,64}@[\w.-]{1,255}` would pay on
  // long runs of word characters without an `@` (ReDoS sentinel at
  // 5MB inputs). See design §D9 + requirement 9.8.
  if (result.indexOf("@") !== -1) {
    result = result.replace(policy.redactedEmailPattern, "[redacted-email]");
  }
  for (const keyword of policy.redactionKeywords) {
    // Fast path: skip entire keyword pass when neither `:` nor `=` is
    // present — the key:value pattern requires one of them immediately
    // after the keyword, so the replace() would just scan the whole
    // string for nothing. This keeps the 5MB ReDoS sentinel well under
    // 200ms even with ~10 keywords to iterate through.
    if (result.indexOf(":") === -1 && result.indexOf("=") === -1) {
      break;
    }
    const pattern = new RegExp(
      `(${escapeRegex(keyword)})\\s*[:=]\\s*"?[^"\\r\\n,;]+"?`,
      "gi",
    );
    result = result.replace(pattern, "$1: [redacted]");
  }
  return result;
}
