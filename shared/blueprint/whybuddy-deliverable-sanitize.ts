/**
 * Deterministic deliverable sanitizer for WhyBuddy narration fallback (S1).
 * Single source of truth — client must NOT duplicate this logic.
 */

export type GoalStatusForNarration = "clear" | "needs_refinement" | "not_recommended" | undefined;

const ENGINEERING_CUTOFF_MARKERS = [
  "\n下一步工程化分支",
  "\nprovenance / upstream refs",
] as const;

const LINE_DROP_RE =
  /provenance|evidencerefs|mcp|sqlite|postgres|session\s*store|invalidate/i;

const TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/artifacts?/gi, "产物"],
  [/stale/gi, "已过期"],
  [/upstreams?/gi, "上游依据"],
  [/gated/gi, "已校验"],
  [/capabilityexecutor/gi, "分析能力"],
  [/capabilities/gi, "分析能力"],
  [/capability/gi, "分析能力"],
  [/trust\s*gate/gi, "信任校验"],
];

/** Strip engineering tail and internal vocabulary from raw deliverable text. */
export function sanitizeDeliverable(raw: string): string {
  let text = String(raw || "");

  let cutAt = -1;
  for (const marker of ENGINEERING_CUTOFF_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx >= 0 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
  }
  if (cutAt >= 0) text = text.slice(0, cutAt);

  text = text.replace(/【|】/g, "");

  for (const [re, repl] of TERM_REPLACEMENTS) {
    text = text.replace(re, repl);
  }

  text = text
    .split("\n")
    .filter((line) => !LINE_DROP_RE.test(line))
    .join("\n");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Mechanical goal.status → user-facing status line (transcribe only, never adjudicate). */
export function goalStatusNarrationLine(status: GoalStatusForNarration): string {
  if (status === "clear") return "当前结论状态（机械裁决）：已收敛。";
  if (status === "not_recommended") return "当前结论状态（机械裁决）：不建议推进。";
  return "当前结论状态（机械裁决）：待细化。";
}

export type FallbackNarrationInput = {
  userText: string;
  goalStatus: GoalStatusForNarration;
  analysisCount: number;
  interventionIntent?: string | null;
  mainArtifactContent?: string | null;
};

/** Deterministic fallback narration when LLM is unavailable (HTTP 200, source: fallback). */
export function buildFallbackNarration(input: FallbackNarrationInput): string {
  const challengeHint =
    input.interventionIntent === "challenge"
      ? "你提出了质疑，我会据此重新推演相关依据。"
      : "";

  const head = [
    challengeHint,
    `本轮完成了 ${input.analysisCount} 项分析。`,
    goalStatusNarrationLine(input.goalStatus),
    "以下是基于本轮材料的整理说明；如需核对依据，可通过脚注查看证据链。",
  ]
    .filter(Boolean)
    .join("\n");

  const body = input.mainArtifactContent
    ? sanitizeDeliverable(input.mainArtifactContent)
    : "";

  return body ? `${head}\n\n${body}` : head;
}