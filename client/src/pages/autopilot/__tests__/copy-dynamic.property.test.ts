/**
 * autopilot-i18n-consistency — Property tests for copyDynamic.
 *
 * Properties 3, 4, 5 from the design document.
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { copyDynamic } from "../copy-dynamic";

// We need to access the dictionary to test Property 4.
// Since DYNAMIC_ZH_COPY is not exported, we test via known keys.
const KNOWN_DICTIONARY_KEYS = [
  "Primary SPEC asset route",
  "Documentation-first conservative route",
  "Preview-first exploratory route",
  "Primary runtime path",
  "Fallback runtime path",
  "Clarify execution intent",
  "Scan GitHub source",
  "Map capability pool",
  "Derive SPEC tree seed",
  "Plan previews and prompts",
  "Specification document generation",
  "Select a route for SPEC tree derivation.",
];

describe("copyDynamic property tests", () => {
  it("Property 3: copyDynamic en-US passthrough — for any string, copyDynamic('en-US', value) returns value unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (value) => {
          const result = copyDynamic("en-US", value);
          expect(result).toBe(value);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 4: copyDynamic zh-CN dictionary hit — for any key in DYNAMIC_ZH_COPY, copyDynamic('zh-CN', key) returns the corresponding Chinese translation", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KNOWN_DICTIONARY_KEYS),
        (key) => {
          const result = copyDynamic("zh-CN", key);
          // Must return a non-empty string that is the dictionary value
          expect(result.length).toBeGreaterThan(0);
          // Must not return the original English key unchanged (these are all English keys with Chinese translations)
          expect(result).not.toBe(key);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 5: copyDynamic zh-CN fallback passthrough — for any string not matching dictionary or regex, copyDynamic('zh-CN', value) returns value unchanged", () => {
    // Use UUIDs prefixed with a safe string to guarantee no dictionary/regex match
    fc.assert(
      fc.property(
        fc.uuid().map(uuid => `zzz_test_${uuid}`),
        (value) => {
          const result = copyDynamic("zh-CN", value);
          expect(result).toBe(value);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 5 (alternative): copyDynamic returns original for random UUIDs in zh-CN", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (uuid) => {
          const result = copyDynamic("zh-CN", uuid);
          expect(result).toBe(uuid);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("copyDynamic handles empty/undefined gracefully", () => {
    expect(copyDynamic("zh-CN", "")).toBe("");
    expect(copyDynamic("zh-CN", undefined)).toBe("");
    expect(copyDynamic("en-US", "")).toBe("");
    expect(copyDynamic("en-US", undefined)).toBe("");
  });
});
