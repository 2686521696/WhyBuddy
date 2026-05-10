import { describe, expect, it } from "vitest";

import { createDefaultEngineeringHandoffLlmPolicy } from "./policy.js";
import {
  renderEngineeringHandoffContent,
  renderEngineeringHandoffSummary,
} from "./render.js";
import type { NormalizedEngineeringRiskNote } from "./normalize.js";

describe("renderEngineeringHandoffSummary", () => {
  // 10.1 — basic merge with label
  it("merges llmSummary and missionSummary with **Mission summary** label", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const out = renderEngineeringHandoffSummary({
      llmSummary: "Deploy dashboard",
      missionSummary: "Rollback plan attached.",
      policy,
    });
    expect(out).toBe(
      "Deploy dashboard\n\n**Mission summary**\nRollback plan attached.",
    );
  });

  // 10.2 — truncation preserves missionSummary and label, adds ellipsis
  it("preserves missionSummary and label when combined exceeds max length", () => {
    const policy = {
      ...createDefaultEngineeringHandoffLlmPolicy(),
      maxSummaryLength: 100,
    };
    const llmSummary = "a".repeat(80);
    const missionSummary = "b".repeat(50);
    const out = renderEngineeringHandoffSummary({
      llmSummary,
      missionSummary,
      policy,
    });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toContain("**Mission summary**");
    expect(out).toContain(missionSummary);
    expect(out).toMatch(/\u2026/);
  });

  // 10.5 (partial) — determinism
  it("is deterministic for the same inputs", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const args = {
      llmSummary: "Ship",
      missionSummary: "Plan",
      policy,
    };
    expect(renderEngineeringHandoffSummary(args)).toBe(
      renderEngineeringHandoffSummary(args),
    );
  });
});

describe("renderEngineeringHandoffContent", () => {
  // 10.3 — both arrays non-empty: appends both sections
  it("appends Acceptance criteria and Risk notes sections when both arrays are non-empty", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const out = renderEngineeringHandoffContent({
      basePlatformContent: "Base content",
      acceptanceCriteria: ["A", "B"],
      riskNotes: [
        { level: "warning", message: "X" },
      ] as NormalizedEngineeringRiskNote[],
      policy,
    });
    expect(out).toContain("## Acceptance criteria\n- A\n- B");
    expect(out).toContain("## Risk notes\n- **warning**: X");
    expect(out.startsWith("Base content")).toBe(true);
  });

  // 10.4 — both arrays empty: return base content unchanged
  it("returns basePlatformContent unchanged when both arrays are empty", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const out = renderEngineeringHandoffContent({
      basePlatformContent: "Base only",
      acceptanceCriteria: [],
      riskNotes: [],
      policy,
    });
    expect(out).toBe("Base only");
  });

  // 10.5 — determinism for content renderer
  it("is deterministic for the same inputs", () => {
    const policy = createDefaultEngineeringHandoffLlmPolicy();
    const args = {
      basePlatformContent: "Base",
      acceptanceCriteria: ["a"],
      riskNotes: [] as NormalizedEngineeringRiskNote[],
      policy,
    };
    expect(renderEngineeringHandoffContent(args)).toBe(
      renderEngineeringHandoffContent(args),
    );
  });
});
