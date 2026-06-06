/**
 * Property tests for `provenance.ts` (task 12.1).
 * design.md §Correctness Properties: Property 3.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type { BlueprintPreviewProvenance } from "./types";
import { classifyProvenance } from "./provenance";

const arbProvenance: fc.Arbitrary<BlueprintPreviewProvenance> = fc.record({
  source: fc.constantFrom("model", "template", "fallback"),
  ok: fc.boolean(),
  errorIndicators: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  generatedAt: fc.constant("2026-05-24T00:00:00.000Z"),
  retryCount: fc.nat({ max: 5 }),
}) as fc.Arbitrary<BlueprintPreviewProvenance>;

describe("provenance property tests", () => {
  it("Property 3: classifyProvenance is total and never maps fallback-fraud to model_ok", () => {
    fc.assert(
      fc.property(arbProvenance, (p) => {
        const c = classifyProvenance(p);
        expect(["model_ok", "fallback", "failed"]).toContain(c);
        // model_ok iff (source === model && ok === true)
        expect(c === "model_ok").toBe(p.source === "model" && p.ok === true);
        // fallback + ok:true never model_ok
        if (p.source === "fallback" && p.ok === true) {
          expect(c).toBe("fallback");
        }
      }),
    );
  });

  it("Property 3 (defensive): undefined/null/partial never throws and is conservative", () => {
    expect(classifyProvenance(undefined)).toBe("failed");
    expect(classifyProvenance(null)).toBe("failed");
    expect(classifyProvenance({} as BlueprintPreviewProvenance)).toBe("failed");
  });
});
