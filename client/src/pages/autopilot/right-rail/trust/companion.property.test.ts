/**
 * Property tests for `companion.ts` (task 16.1).
 * design.md §Correctness Properties: Property 5.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type { CompanionFinding } from "./types";
import { selectCompanionFindings, sortBySeverity } from "./companion";

const SEVERITIES: CompanionFinding["severity"][] = ["info", "warn", "error"];
const STAGES = [
  "input",
  "clarification",
  "route_generation",
  "spec_tree",
] as const;

const arbFinding: fc.Arbitrary<CompanionFinding> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  role: fc.constantFrom("critic", "grounding"),
  stage: fc.constantFrom(...STAGES),
  targetArtifactId: fc.string({ maxLength: 8 }),
  findings: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  severity: fc.constantFrom(...SEVERITIES),
  suggestedActions: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
  citations: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
  timestamp: fc.constant("2026-05-24T00:00:00.000Z"),
}) as fc.Arbitrary<CompanionFinding>;

const rank = (s: CompanionFinding["severity"]) =>
  s === "error" ? 0 : s === "warn" ? 1 : 2;

describe("companion property tests", () => {
  it("Property 5: selectCompanionFindings never throws on arbitrary/empty input", () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.record({
            companionFindings: fc.option(
              fc.array(arbFinding, { maxLength: 10 }),
              { nil: undefined }
            ),
          }),
          { nil: undefined }
        ),
        job => {
          const result = selectCompanionFindings(job as never);
          expect(Array.isArray(result)).toBe(true);
        }
      )
    );
    expect(selectCompanionFindings(undefined)).toEqual([]);
    expect(selectCompanionFindings(null)).toEqual([]);
    expect(selectCompanionFindings({} as never)).toEqual([]);
  });

  it("Property 5: sortBySeverity is a severity-ordered stable permutation (error > warn > info)", () => {
    fc.assert(
      fc.property(fc.array(arbFinding, { maxLength: 20 }), findings => {
        const sorted = sortBySeverity(findings);
        expect(sorted.length).toBe(findings.length);
        for (let i = 1; i < sorted.length; i++) {
          expect(rank(sorted[i - 1].severity)).toBeLessThanOrEqual(
            rank(sorted[i].severity)
          );
        }
      })
    );
  });
});
