/**
 * autopilot-i18n-consistency — Property tests for resolveRoleLabel and resolveStageLabel.
 *
 * Properties 1, 2, 6 from the design document.
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { ROLE_LABELS, resolveRoleLabel, resolveStageLabel } from "../role-labels";

const VALID_LOCALES = ["zh-CN", "en-US"] as const;

describe("resolveRoleLabel property tests", () => {
  const knownRoleIds = Object.keys(ROLE_LABELS);

  it("Property 1: Role label resolver locale symmetry — for any roleId in ROLE_LABELS and any valid locale, resolveRoleLabel returns the dictionary label and the result is NOT equal to the raw roleId", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownRoleIds),
        fc.constantFrom(...VALID_LOCALES),
        (roleId, locale) => {
          const result = resolveRoleLabel(roleId, locale);
          // Must return the dictionary value
          expect(result).toBe(ROLE_LABELS[roleId][locale]);
          // Dictionary entries provide human-readable forms, not machine IDs
          expect(result).not.toBe(roleId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 2: Role label resolver fallback passthrough — for any string NOT in ROLE_LABELS, resolveRoleLabel returns the input unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !(s in ROLE_LABELS)),
        fc.constantFrom(...VALID_LOCALES),
        (unknownRoleId, locale) => {
          const result = resolveRoleLabel(unknownRoleId, locale);
          expect(result).toBe(unknownRoleId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("resolveStageLabel property tests", () => {
  it("Property 6: Stage label locale correctness — for any valid stage index (0–5), zh-CN returns string starting with '阶段', en-US returns string starting with 'Stage'", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (index) => {
          const zhResult = resolveStageLabel(index, "zh-CN");
          const enResult = resolveStageLabel(index, "en-US");
          expect(zhResult.startsWith("阶段")).toBe(true);
          expect(enResult.startsWith("Stage")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 6 extended: resolveStageLabel handles out-of-range indices gracefully", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 100 }),
        (index) => {
          const zhResult = resolveStageLabel(index, "zh-CN");
          const enResult = resolveStageLabel(index, "en-US");
          expect(zhResult).toBe(`阶段 ${index}`);
          expect(enResult).toBe(`Stage ${index}`);
        }
      ),
      { numRuns: 50 }
    );
  });
});
