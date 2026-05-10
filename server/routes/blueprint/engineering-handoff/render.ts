/**
 * Engineering Handoff LLM — summary & content renderers.
 *
 * Pure helpers that inject `missionSummary` / `acceptanceCriteria` / `riskNotes`
 * into the outer plan's `summary` and `handoffs[0].content` respectively
 * (design §D11).
 *
 * Hard constraints:
 * - No runtime / business module imports.
 * - Inputs are not mutated.
 */

import type { EngineeringHandoffLlmPolicy } from "./policy.js";
import type { NormalizedEngineeringRiskNote } from "./normalize.js";

const MISSION_SUMMARY_LABEL = "**Mission summary**";
const ACCEPTANCE_HEADER = "## Acceptance criteria";
const RISK_NOTES_HEADER = "## Risk notes";
const ELLIPSIS = "\u2026";

export interface RenderEngineeringHandoffSummaryArgs {
  readonly llmSummary: string;
  readonly missionSummary: string;
  readonly policy: EngineeringHandoffLlmPolicy;
}

/**
 * Render the plan `summary` with a mission summary prefix block.
 *
 * Format: `${llmSummary}\n\n**Mission summary**\n${missionSummary}`.
 *
 * When the combined length exceeds `policy.maxSummaryLength`, the full
 * missionSummary + label are preserved and the leading llmSummary is clipped
 * to fit, ending with `…`.
 */
export function renderEngineeringHandoffSummary(
  args: RenderEngineeringHandoffSummaryArgs,
): string {
  const { llmSummary, missionSummary, policy } = args;
  const max = policy.maxSummaryLength;

  const candidate = `${llmSummary}\n\n${MISSION_SUMMARY_LABEL}\n${missionSummary}`;
  if (candidate.length <= max) {
    return candidate;
  }

  // Preserve the full missionSummary + label block.
  const suffix = `\n\n${MISSION_SUMMARY_LABEL}\n${missionSummary}`;
  const budget = max - suffix.length;
  if (budget <= 0) {
    // missionSummary alone exceeds the budget. Keep label + missionSummary
    // and drop the llmSummary head entirely.
    return suffix.slice(-max);
  }

  // Clip llmSummary to budget - 1 (reserve 1 char for ellipsis) and append `…`.
  const head =
    llmSummary.length > budget
      ? `${llmSummary.slice(0, Math.max(0, budget - 1))}${ELLIPSIS}`
      : llmSummary;
  return `${head}${suffix}`;
}

export interface RenderEngineeringHandoffContentArgs {
  readonly basePlatformContent: string;
  readonly acceptanceCriteria: readonly string[];
  readonly riskNotes: readonly NormalizedEngineeringRiskNote[];
  readonly policy: EngineeringHandoffLlmPolicy;
}

/**
 * Append mission-level acceptance criteria and risk notes to the base
 * platform handoff content (design §D11).
 *
 * When both arrays are empty, the base content is returned unchanged.
 */
export function renderEngineeringHandoffContent(
  args: RenderEngineeringHandoffContentArgs,
): string {
  const { basePlatformContent, acceptanceCriteria, riskNotes } = args;
  if (acceptanceCriteria.length === 0 && riskNotes.length === 0) {
    return basePlatformContent;
  }

  const parts: string[] = [basePlatformContent];
  if (acceptanceCriteria.length > 0) {
    const bullets = acceptanceCriteria.map(item => `- ${item}`).join("\n");
    parts.push(`${ACCEPTANCE_HEADER}\n${bullets}`);
  }
  if (riskNotes.length > 0) {
    const bullets = riskNotes
      .map(note => `- **${note.level}**: ${note.message}`)
      .join("\n");
    parts.push(`${RISK_NOTES_HEADER}\n${bullets}`);
  }
  return parts.join("\n\n");
}
