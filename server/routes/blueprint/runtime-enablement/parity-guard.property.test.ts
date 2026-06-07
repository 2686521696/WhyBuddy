/**
 * Property-based test for the Parity Guard detectors
 * (blueprint-trust-enforcement-model, Task 6.2 — Property 8).
 *
 * Where the sibling `parity-guard.test.ts` runs the detectors against the real
 * codebase (the happy-path "no drift / no Red Line" assertions), this test
 * exercises the detectors *generatively* against synthetic `ParityContract`
 * objects laid out over a throwaway temp directory. By controlling exactly
 * which App env flags are real, which route / skill artifacts exist on disk,
 * and whether a forbidden Red Line phrase is injected into a scanned
 * trust-surface source, it verifies the universal Property 8 invariant:
 *
 *   the guard fails *if and only if* at least one node mapping differs OR a
 *   Red Line assertion is present, and on failure the diagnostic report names
 *   the drifted node id / the matched phrase.
 *
 * The detectors (`detectMappingDrift`, `detectRedLineViolations`,
 * `listScannedAppSources`, `formatDriftFindings`, `formatRedLineFindings`) are
 * pure functions of `(repoRoot, contract)`, so we point `repoRoot` at a unique
 * per-run temp dir, write the fixture files the synthetic contract references,
 * run the detectors, and clean the temp dir up afterwards.
 *
 * Library: fast-check + Vitest (server config). Minimum 100 iterations.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CANONICAL_RED_LINE } from "./parity-contract.js";
import {
  detectMappingDrift,
  detectRedLineViolations,
  formatDriftFindings,
  formatRedLineFindings,
  FORBIDDEN_APP_PHRASES,
  TRUST_SECTION_COMPONENT,
  type ParityContract,
  type ParityNode,
} from "./parity-guard-detectors.js";
import {
  TRUST_GATE_ENABLEMENT_KEYS,
  type TrustGateEnablementKey,
} from "./resolver.js";

const NUM_RUNS = 100;

/**
 * Advisory wording the App is *allowed* to use. Deliberately includes the bare
 * words "block" and "never" — which the denylist excludes — so every run also
 * asserts the detector does not produce false positives on legitimate copy.
 */
const CLEAN_TRUST_COPY =
  "// records findings to the checks ledger for human review and never auto-blocks\n";

/** Writes `content` to `<root>/<rel>`, creating parent dirs as needed. */
const writeFixture = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
};

/** Per-node fixture layout knobs the generator varies. */
interface NodeConfig {
  /** Use a real `TRUST_GATE_ENABLEMENT_KEYS` member vs a bogus flag. */
  flagValid: boolean;
  /** Whether the node's App route file is written to disk. */
  routeExists: boolean;
  /** Whether the Skill script path sits under the required prefix. */
  skillPrefixValid: boolean;
  /** Whether the Skill script file is written to disk. */
  skillExists: boolean;
}

const nodeConfigArb: fc.Arbitrary<NodeConfig> = fc.record({
  flagValid: fc.boolean(),
  routeExists: fc.boolean(),
  skillPrefixValid: fc.boolean(),
  skillExists: fc.boolean(),
});

const scenarioArb = fc.record({
  nodes: fc.array(nodeConfigArb, { minLength: 1, maxLength: 4 }),
  /** Optional forbidden phrase injected into the always-scanned TrustSection. */
  injectedPhrase: fc.option(fc.constantFrom(...FORBIDDEN_APP_PHRASES), {
    nil: null,
  }),
});

// Feature: blueprint-trust-enforcement-model, Property 8: Parity Guard detects drift and Red Line violations and reports them — for any codebase-reality mapping compared against the Parity Contract, the guard SHALL fail if and only if at least one node's mapping differs from the contract or a Red Line assertion is present in the scanned App trust-surface text; and whenever it fails, the report SHALL name the specific drifted node id or the matched Red Line phrase.
describe("Feature: blueprint-trust-enforcement-model, Property 8: Parity Guard detects drift and Red Line violations and reports them", () => {
  it("fails iff a node mapping differs or a Red Line phrase is present, and names the drifted node id / matched phrase", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const root = mkdtempSync(path.join(os.tmpdir(), "parity-guard-prop-"));
        try {
          // ── Build the synthetic contract and lay out its fixture files ──
          const nodes: ParityNode[] = scenario.nodes.map((cfg, i) => {
            const validKey =
              TRUST_GATE_ENABLEMENT_KEYS[i % TRUST_GATE_ENABLEMENT_KEYS.length];
            // A synthetic, intentionally-bogus flag exercises the envFlag-drift
            // path; cast is sound only inside this synthetic test fixture.
            const envFlag = (
              cfg.flagValid ? validKey : `NOT_A_REAL_FLAG_${i}`
            ) as TrustGateEnablementKey;

            const routeRel = `synthetic/route-${i}.ts`;
            const skillRel = cfg.skillPrefixValid
              ? `skills/whybuddy/whybuddy/scripts/script-${i}.py`
              : `skills/elsewhere/script-${i}.py`;

            if (cfg.routeExists) {
              writeFixture(root, routeRel, CLEAN_TRUST_COPY);
            }
            if (cfg.skillExists) {
              writeFixture(root, skillRel, CLEAN_TRUST_COPY);
            }

            return {
              nodeId: `node-${i}`,
              label: `Synthetic node ${i}`,
              appModel: "advisory",
              skillModel: "hard-gate",
              divergenceReason: "synthetic divergence reason",
              appArtifact: { envFlag, route: routeRel },
              skillArtifact: { script: skillRel },
            } satisfies ParityNode;
          });

          // The TrustSection component is always scanned; inject the forbidden
          // phrase (if any) here so Red Line presence is deterministic.
          const trustContent =
            CLEAN_TRUST_COPY +
            (scenario.injectedPhrase === null
              ? ""
              : `// design note: ${scenario.injectedPhrase} appears here\n`);
          writeFixture(root, TRUST_SECTION_COMPONENT, trustContent);

          const contract: ParityContract = {
            redLine: CANONICAL_RED_LINE,
            nodes,
          };

          // ── Expected outcome derived from the layout knobs ──
          const expectedDriftIds = new Set<string>();
          scenario.nodes.forEach((cfg, i) => {
            const drifted =
              !cfg.flagValid ||
              !cfg.routeExists ||
              !cfg.skillPrefixValid ||
              !cfg.skillExists;
            if (drifted) expectedDriftIds.add(`node-${i}`);
          });
          const expectRedLine = scenario.injectedPhrase !== null;
          const expectGuardFails = expectedDriftIds.size > 0 || expectRedLine;

          // ── Run the detectors ──
          const drift = detectMappingDrift(root, contract);
          const violations = detectRedLineViolations(root, contract);
          const guardFails = drift.length > 0 || violations.length > 0;

          // Drift is detected exactly for the nodes whose mapping differs.
          expect(new Set(drift.map((f) => f.nodeId))).toEqual(expectedDriftIds);

          // Red Line is detected exactly when a forbidden phrase was injected.
          expect(violations.length > 0).toBe(expectRedLine);

          // The guard fails iff drift OR a Red Line assertion is present.
          expect(guardFails).toBe(expectGuardFails);

          // On failure, the report names the drifted node id(s) ...
          if (drift.length > 0) {
            const report = formatDriftFindings(drift);
            for (const nodeId of expectedDriftIds) {
              expect(report).toContain(nodeId);
            }
          }

          // ... and/or the matched Red Line phrase.
          if (violations.length > 0) {
            const report = formatRedLineFindings(violations);
            expect(report).toContain(scenario.injectedPhrase);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
