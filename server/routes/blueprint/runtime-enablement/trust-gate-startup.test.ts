/**
 * Startup-wiring + dev:all integration smoke tests for the Trust Gate
 * default-resolution layer (blueprint-trust-enforcement-model, Task 2.2).
 *
 * These tests exercise the latent-hazard fix end-to-end at the wiring boundary
 * without changing any gate's advisory / non-blocking semantics:
 *
 *   1. Startup smoke — with the master switch on, a non-test build, and the 5
 *      Trust Gate flags unset, invoking the wiring hook
 *      (`resolveAllTrustGateEnablement(env)`, the same call `server/index.ts`
 *      performs on `process.env` immediately after `resolveAllBridgeEnablement`)
 *      writes all 5 flags to `"true"` before `buildBlueprintServiceContext`
 *      reads them. (Requirements 1.3, 1.8.)
 *   2. Property 6 — dev:all defaults-to-true preservation (Requirement 1.8).
 *   3. dev:all parity smoke — applying the resolver to the dev:all launch env
 *      shape (the `?? "true"` injection `scripts/dev-all.mjs` performs via
 *      `resolveV4AlignmentGates()` + the `AUTOPILOT_REAL_RUNTIME ?? "true"`
 *      master switch) yields all-`"true"`, and the script source still injects
 *      those 5 flags + the master switch consistently.
 *
 * The wiring hook accepts a caller-supplied env object, so these tests operate
 * on plain local env objects and never mutate the real `process.env`
 * (`vitest.setup.ts` forces `BUILD_TARGET="test"`, which the resolver hard-locks
 * to `"false"`; the wiring hook is only meaningful in a non-test launch, which
 * we model with local objects).
 *
 * Library: fast-check + Vitest. Minimum 100 iterations for the property.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  TRUST_GATE_ENABLEMENT_KEYS,
  resolveAllTrustGateEnablement,
} from "./resolver.js";

const NUM_RUNS = 100;

/** Repo root, resolved from this test file's location. */
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../../..");
const DEV_ALL_SCRIPT = path.join(REPO_ROOT, "scripts", "dev-all.mjs");

/**
 * Mirrors `scripts/dev-all.mjs`'s `resolveV4AlignmentGates()` + the
 * `AUTOPILOT_REAL_RUNTIME ?? "true"` master-switch injection: build the env
 * shape dev:all hands to its child processes from an operator's pre-set env.
 * Each of the 5 flags defaults to `"true"` when unset; the master switch
 * defaults to `"true"` when unset.
 */
function buildDevAllLaunchEnv(
  operatorEnv: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    AUTOPILOT_REAL_RUNTIME: operatorEnv.AUTOPILOT_REAL_RUNTIME ?? "true",
  };
  for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
    env[key] = operatorEnv[key] ?? "true";
  }
  // dev:all is never launched with BUILD_TARGET=test (that path bypasses the
  // script entirely); model that by leaving BUILD_TARGET unset.
  return env;
}

// ─── Startup wiring smoke (Requirements 1.3, 1.8) ─────────────────────────

describe("blueprint-trust-enforcement-model — startup wiring smoke", () => {
  it('master switch "true" + non-test build + 5 flags unset → hook writes all 5 flags to "true" before context build', () => {
    // Operator launch that runs the 6 capability bridges as real but bypasses
    // dev-all.mjs and does not set the 5 Trust Gate flags — the exact latent
    // hazard Requirement 1 closes.
    const env: NodeJS.ProcessEnv = {
      AUTOPILOT_REAL_RUNTIME: "true",
      BUILD_TARGET: "production",
    };

    // Precondition: the 5 flags are genuinely unset before the hook runs.
    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(env[key]).toBeUndefined();
    }

    // Invoke the wiring hook exactly as server/index.ts does on process.env.
    const resolved = resolveAllTrustGateEnablement(env);

    // All 5 process-env-shaped flags are written to "true" before any later
    // `=== "true"` read by buildBlueprintServiceContext / each gate service.
    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(env[key]).toBe("true");
    }

    expect(resolved).toEqual({
      checksLedger: "true",
      contentQuality: "true",
      companion: "true",
      traceabilityMatrix: "true",
      previewAudit: "true",
    });
  });

  it('master switch off + non-test build + 5 flags unset → hook writes all 5 flags to "false" (trust loop stays off, consistently with the master switch)', () => {
    const env: NodeJS.ProcessEnv = { BUILD_TARGET: "production" };

    resolveAllTrustGateEnablement(env);

    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(env[key]).toBe("false");
    }
  });
});

// ─── Property 6 ───────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 6: dev:all defaults-to-true preservation — for any operator pre-set environment in which each of the 5 Trust Gate flags is either unset or already "true", the master switch is "true", and BUILD_TARGET is not "test" (the dev:all launch shape produced by resolveV4AlignmentGates()'s ?? "true" injection), all 5 Trust Gates SHALL resolve to "true".
describe("Feature: blueprint-trust-enforcement-model, Property 6: dev:all defaults-to-true preservation", () => {
  it('for any dev:all-shaped env (each flag unset or "true", master "true", non-test build), all 5 gates resolve "true"', () => {
    // Each of the 5 flags is independently either unset (undefined) or "true".
    const flagArb = fc.constantFrom<string | undefined>(undefined, "true");
    // A BUILD_TARGET that is never exactly "test" (including unset).
    const buildTargetNonTestArb = fc
      .oneof(
        fc.constant(undefined),
        fc.constantFrom("production", "development", "ci", "", "Test", "TEST"),
        fc.string(),
      )
      .filter((value) => value !== "test");

    fc.assert(
      fc.property(
        fc.record({
          checksLedger: flagArb,
          contentQuality: flagArb,
          companion: flagArb,
          traceabilityMatrix: flagArb,
          previewAudit: flagArb,
          buildTarget: buildTargetNonTestArb,
        }),
        (input) => {
          const env: NodeJS.ProcessEnv = { AUTOPILOT_REAL_RUNTIME: "true" };
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

          const resolved = resolveAllTrustGateEnablement(env);

          expect(resolved).toEqual({
            checksLedger: "true",
            contentQuality: "true",
            companion: "true",
            traceabilityMatrix: "true",
            previewAudit: "true",
          });
          // The write-back also leaves every flag at "true".
          for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
            expect(env[key]).toBe("true");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── dev:all parity smoke (Requirement 1.8) ───────────────────────────────

describe("blueprint-trust-enforcement-model — dev:all parity smoke", () => {
  it('applying the resolver to the dev:all launch env shape yields all 5 gates "true"', () => {
    // dev:all with an operator who set nothing: resolveV4AlignmentGates() injects
    // every flag as "true" and the master switch defaults to "true".
    const launchEnv = buildDevAllLaunchEnv({});

    const resolved = resolveAllTrustGateEnablement(launchEnv);

    expect(resolved).toEqual({
      checksLedger: "true",
      contentQuality: "true",
      companion: "true",
      traceabilityMatrix: "true",
      previewAudit: "true",
    });
  });

  it("dev:all launch shape with explicit operator opt-outs is preserved by the resolver (explicit-wins)", () => {
    // An operator can still pin a single gate off in their .env; dev:all's
    // `?? "true"` leaves that explicit value intact and the resolver honors it.
    const launchEnv = buildDevAllLaunchEnv({
      BLUEPRINT_COMPANION_ENABLED: "false",
    });

    const resolved = resolveAllTrustGateEnablement(launchEnv);

    expect(resolved.companion).toBe("false");
    expect(resolved.checksLedger).toBe("true");
    expect(resolved.contentQuality).toBe("true");
    expect(resolved.traceabilityMatrix).toBe("true");
    expect(resolved.previewAudit).toBe("true");
  });

  it("scripts/dev-all.mjs injects the 5 Trust Gate flags and the master switch consistently", () => {
    // resolveV4AlignmentGates() is local to dev-all.mjs (not exported), so we
    // assert the script source still injects the 5 flags via `?? "true"` and the
    // master switch via `AUTOPILOT_REAL_RUNTIME ?? "true"`, keeping the dev:all
    // launch shape this parity smoke models in sync with reality.
    const source = readFileSync(DEV_ALL_SCRIPT, "utf8");

    for (const key of TRUST_GATE_ENABLEMENT_KEYS) {
      expect(source).toContain(key);
      // Each flag is injected with the opt-out-on default.
      const injectionPattern = new RegExp(
        `process\\.env\\.${key}\\s*\\?\\?\\s*"true"`,
      );
      expect(injectionPattern.test(source)).toBe(true);
    }

    // The master switch is injected with the same opt-out-on default.
    expect(
      /process\.env\.AUTOPILOT_REAL_RUNTIME\s*\?\?\s*"true"/.test(source),
    ).toBe(true);
  });
});
