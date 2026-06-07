/**
 * Property-based tests for the Trust Gate default-resolution layer
 * (`resolveTrustGateEnablement` + `resolveAllTrustGateEnablement`) added by the
 * blueprint-trust-enforcement-model spec.
 *
 * These cover Properties 1–4 from design.md §Correctness Properties. Each test
 * draws its env values from a shared "env-value vocabulary" arbitrary that mixes
 * canonical values (`"true"`, `"false"`), empty / whitespace-only strings, case
 * variants (`"TRUE"`, `"True"`), numeric / word lookalikes (`"1"`, `"yes"`,
 * `"on"`), random strings, and `undefined`, so the case-sensitive and
 * non-canonical paths are exercised every run.
 *
 * Library: fast-check + Vitest. Minimum 100 iterations per property.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  TRUST_GATE_ENABLEMENT_KEYS,
  type ResolvedTrustGates,
  resolveAllTrustGateEnablement,
  resolveTrustGateEnablement,
} from "./resolver.js";

// ─── Shared "env-value vocabulary" arbitrary ──────────────────────────────

/**
 * The fixed adversarial vocabulary required by design.md §Testing Strategy:
 * canonical values, empty / whitespace-only strings, case variants, numeric /
 * word lookalikes.
 */
const ENV_VALUE_VOCABULARY = [
  "true",
  "false",
  "",
  " ",
  "   ",
  "\t",
  "\n",
  " true ",
  "TRUE",
  "True",
  "1",
  "yes",
  "on",
] as const;

/**
 * Mixes the fixed vocabulary with random strings and `undefined` (unset env).
 */
const envValueArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom<(string | undefined)[]>(...ENV_VALUE_VOCABULARY),
  fc.string(),
  fc.constant(undefined),
);

/** A `BUILD_TARGET` value that is never exactly `"test"`. */
const buildTargetNonTestArb: fc.Arbitrary<string | undefined> = fc
  .oneof(
    fc.constant(undefined),
    fc.constantFrom("production", "development", "ci", "", "Test", "TEST"),
    fc.string(),
  )
  .filter((value) => value !== "test");

/** Any of the 5 Trust Gate env flag names. */
const gateKeyArb = fc.constantFrom(...TRUST_GATE_ENABLEMENT_KEYS);

const trim = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : value.trim();

const NUM_RUNS = 100;

// ─── Property 1 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 1: Resolution is total and well-typed — for any environment input (any combination of master switch, build target, and the 5 explicit flag values), the aggregate resolver SHALL return a result containing all 5 Trust Gates, with each resolved value within the set {"true", "false"}.
describe("Feature: blueprint-trust-enforcement-model, Property 1: Resolution is total and well-typed", () => {
  it("aggregate resolves all 5 gates to a defined value within {true, false} (or a preserved explicit value)", () => {
    fc.assert(
      fc.property(
        fc.record({
          masterSwitch: envValueArb,
          buildTarget: envValueArb,
          checksLedger: envValueArb,
          contentQuality: envValueArb,
          companion: envValueArb,
          traceabilityMatrix: envValueArb,
          previewAudit: envValueArb,
        }),
        (input) => {
          const env: NodeJS.ProcessEnv = {};
          if (input.masterSwitch !== undefined) {
            env.AUTOPILOT_REAL_RUNTIME = input.masterSwitch;
          }
          if (input.buildTarget !== undefined) {
            env.BUILD_TARGET = input.buildTarget;
          }
          if (input.checksLedger !== undefined) {
            env.BLUEPRINT_CHECKS_LEDGER_ENABLED = input.checksLedger;
          }
          if (input.contentQuality !== undefined) {
            env.BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED = input.contentQuality;
          }
          if (input.companion !== undefined) {
            env.BLUEPRINT_COMPANION_ENABLED = input.companion;
          }
          if (input.traceabilityMatrix !== undefined) {
            env.BLUEPRINT_TRACEABILITY_MATRIX_ENABLED = input.traceabilityMatrix;
          }
          if (input.previewAudit !== undefined) {
            env.BLUEPRINT_PREVIEW_AUDIT_ENABLED = input.previewAudit;
          }

          const result = resolveAllTrustGateEnablement(env);

          // Totality: the result contains exactly the 5 named Trust Gates.
          expect(Object.keys(result).sort()).toEqual(
            [
              "checksLedger",
              "companion",
              "contentQuality",
              "previewAudit",
              "traceabilityMatrix",
            ].sort(),
          );

          const isTest = input.buildTarget === "test";

          // Well-typed: each gate is a defined string within {"true","false"},
          // except where a non-empty explicit value is preserved verbatim by
          // the explicit-wins rule outside a test build (design §C1/§C2).
          const assertGate = (
            value: ResolvedTrustGates[keyof ResolvedTrustGates],
            explicit: string | undefined,
          ): void => {
            expect(typeof value).toBe("string");
            const trimmed = trim(explicit);
            const explicitWins =
              !isTest && trimmed !== undefined && trimmed !== "";
            if (explicitWins) {
              expect(value).toBe(trimmed);
            } else {
              expect(value === "true" || value === "false").toBe(true);
            }
          };

          assertGate(result.checksLedger, input.checksLedger);
          assertGate(result.contentQuality, input.contentQuality);
          assertGate(result.companion, input.companion);
          assertGate(result.traceabilityMatrix, input.traceabilityMatrix);
          assertGate(result.previewAudit, input.previewAudit);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 2 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 2: Explicit per-flag value wins (outside test build) — for any Trust Gate, for any master switch value, when BUILD_TARGET is not "test" and the explicit per-flag value is present and non-empty after trimming whitespace, the resolver SHALL return that explicit value unchanged; and for any whitespace-only or empty explicit value, the resolver SHALL treat it as unset and fall through to the master-switch default.
describe("Feature: blueprint-trust-enforcement-model, Property 2: Explicit per-flag value wins (outside test build)", () => {
  it("non-empty trimmed explicit value wins; empty/whitespace-only falls through to the master-switch default", () => {
    fc.assert(
      fc.property(
        gateKeyArb,
        envValueArb, // explicit per-flag value
        envValueArb, // master switch
        buildTargetNonTestArb,
        (envFlag, explicitEnvValue, masterSwitch, buildTarget) => {
          const result = resolveTrustGateEnablement({
            envFlag,
            explicitEnvValue,
            masterSwitch,
            buildTarget,
          });

          const trimmed = trim(explicitEnvValue);
          const explicitWins = trimmed !== undefined && trimmed !== "";

          if (explicitWins) {
            // Explicit value wins, overriding the master switch. The resolver
            // normalizes only surrounding whitespace, never the value itself.
            expect(result).toBe(trimmed);
          } else {
            // Empty / whitespace-only / unset → treated as unset, fall through
            // to the master-switch default (Property 3 territory).
            expect(result).toBe(masterSwitch === "true" ? "true" : "false");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 3 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 3: Master-switch default resolves true iff exactly "true" — for any Trust Gate with no explicit value set and BUILD_TARGET not "test", the resolved default SHALL be "true" when AUTOPILOT_REAL_RUNTIME equals exactly the case-sensitive string "true", and SHALL be "false" for every other master-switch value including unset, empty, and non-canonical values such as "TRUE", "1", and "yes".
describe('Feature: blueprint-trust-enforcement-model, Property 3: Master-switch default resolves true iff exactly "true"', () => {
  it('with no explicit value and non-test build, resolves "true" iff masterSwitch === "true" (case-sensitive)', () => {
    fc.assert(
      fc.property(
        gateKeyArb,
        // "no explicit value set" — undefined, empty, or whitespace-only.
        fc.constantFrom<(string | undefined)[]>(undefined, "", " ", "  ", "\t"),
        envValueArb, // master switch (full adversarial vocabulary)
        buildTargetNonTestArb,
        (envFlag, explicitEnvValue, masterSwitch, buildTarget) => {
          const result = resolveTrustGateEnablement({
            envFlag,
            explicitEnvValue,
            masterSwitch,
            buildTarget,
          });

          expect(result).toBe(masterSwitch === "true" ? "true" : "false");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 4 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 4: Test build-target hard-lock precedence — for any Trust Gate and for any master switch value, when BUILD_TARGET equals "test" the resolver SHALL resolve to "true" if and only if the trimmed explicit value is exactly "true", and to "false" otherwise; this test-lock SHALL hold even when the master switch is "true".
describe("Feature: blueprint-trust-enforcement-model, Property 4: Test build-target hard-lock precedence", () => {
  it('with BUILD_TARGET="test", resolves "true" iff trimmed explicit === "true", regardless of the master switch', () => {
    fc.assert(
      fc.property(
        gateKeyArb,
        envValueArb, // explicit per-flag value
        envValueArb, // master switch (including "true")
        (envFlag, explicitEnvValue, masterSwitch) => {
          const result = resolveTrustGateEnablement({
            envFlag,
            explicitEnvValue,
            masterSwitch,
            buildTarget: "test",
          });

          const expected = trim(explicitEnvValue) === "true" ? "true" : "false";
          expect(result).toBe(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('test-lock holds even when masterSwitch === "true" and there is no explicit opt-in', () => {
    fc.assert(
      fc.property(
        gateKeyArb,
        fc.constantFrom<(string | undefined)[]>(undefined, "", " ", "false"),
        (envFlag, explicitEnvValue) => {
          const result = resolveTrustGateEnablement({
            envFlag,
            explicitEnvValue,
            masterSwitch: "true",
            buildTarget: "test",
          });
          expect(result).toBe("false");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 5 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 5: Idempotency and no further write-back — for any environment input, running the aggregate resolver twice SHALL produce identical resolved results on both runs, and the environment object after the second run SHALL be byte-for-byte equal to the environment object after the first run (no further write-backs occur after the first run).
describe("Feature: blueprint-trust-enforcement-model, Property 5: Idempotency and no further write-back", () => {
  it("two runs produce identical results and the env object is byte-for-byte equal after the second run", () => {
    fc.assert(
      fc.property(
        fc.record({
          masterSwitch: envValueArb,
          buildTarget: envValueArb,
          checksLedger: envValueArb,
          contentQuality: envValueArb,
          companion: envValueArb,
          traceabilityMatrix: envValueArb,
          previewAudit: envValueArb,
        }),
        // Unrelated env keys must survive untouched across both runs, so mix in
        // a couple of decoy entries and assert the snapshot equality below.
        fc.dictionary(fc.string(), fc.string()),
        (input, decoyEnv) => {
          const env: NodeJS.ProcessEnv = { ...decoyEnv };
          if (input.masterSwitch !== undefined) {
            env.AUTOPILOT_REAL_RUNTIME = input.masterSwitch;
          }
          if (input.buildTarget !== undefined) {
            env.BUILD_TARGET = input.buildTarget;
          }
          if (input.checksLedger !== undefined) {
            env.BLUEPRINT_CHECKS_LEDGER_ENABLED = input.checksLedger;
          }
          if (input.contentQuality !== undefined) {
            env.BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED = input.contentQuality;
          }
          if (input.companion !== undefined) {
            env.BLUEPRINT_COMPANION_ENABLED = input.companion;
          }
          if (input.traceabilityMatrix !== undefined) {
            env.BLUEPRINT_TRACEABILITY_MATRIX_ENABLED = input.traceabilityMatrix;
          }
          if (input.previewAudit !== undefined) {
            env.BLUEPRINT_PREVIEW_AUDIT_ENABLED = input.previewAudit;
          }

          // First run mutates the env via the idempotent write-back.
          const firstResult = resolveAllTrustGateEnablement(env);
          const envAfterFirst = JSON.stringify(env);

          // Second run observes the already-written defaults and must perform
          // no further write-backs.
          const secondResult = resolveAllTrustGateEnablement(env);
          const envAfterSecond = JSON.stringify(env);

          // Identical resolved results on both runs.
          expect(secondResult).toEqual(firstResult);

          // The env object is byte-for-byte equal after the second run.
          expect(envAfterSecond).toBe(envAfterFirst);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
