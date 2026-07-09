import type { TurnStep } from "./types";

/** S9: execution substeps — everything except the final narration. */
export function executionTurnSteps(steps: TurnStep[]): TurnStep[] {
  return steps.filter(
    (s) => !(s.kind === "narration" && "isFinal" in s && s.isFinal)
  );
}

export function finalNarrationStep(
  steps: TurnStep[]
): Extract<TurnStep, { kind: "narration" }> | null {
  const fin = steps.find(
    (s): s is Extract<TurnStep, { kind: "narration" }> =>
      s.kind === "narration" && "isFinal" in s && Boolean(s.isFinal)
  );
  return fin ?? null;
}