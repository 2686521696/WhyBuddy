/**
 * Parity Guard Test (blueprint-trust-enforcement-model, Task 6.1).
 *
 * The CI enforcement layer that protects the intentional App=advisory /
 * Skill=hard-gate divergence and the Red Line. Unlike the sibling
 * `parity-contract.test.ts` (which checks the contract's internal structure),
 * this guard scans the **actual App source files** and the ADR on disk and
 * fails when reality drifts from the recorded Parity Contract or when the App
 * begins asserting the Skill's "agent-can't-touch" guarantee.
 *
 * Requirements covered:
 *  - 4.1 Mapping-drift check: each contract node's App env flag is a real Trust
 *    Gate key, its route/component exists on disk, and its Skill script exists
 *    under `skills/whybuddy/whybuddy/scripts/**`.
 *  - 4.2 Red Line check: scan the App trust-surface sources (the 5 gate services
 *    + the right-rail trust panels + `TrustSection.tsx`) using a denylist
 *    derived from the ADR's canonical concepts.
 *  - 4.3 Pass condition: mapping matches AND no Red Line assertion is found.
 *  - 4.4 Diagnostic reporting: on failure, name the drifted node id or the
 *    matched file + phrase.
 *  - 4.5 Runnable by the existing Vitest server runner
 *    (`vitest.config.server.ts` include `server/routes/blueprint/**\/*.test.ts`).
 *
 * Library: Vitest (server config). Example/structural assertions — the
 * universal property form is Task 6.2 (`Property 8`), implemented separately.
 */

import path from "node:path";

import { describe, expect, it } from "vitest";

import { PARITY_CONTRACT, CANONICAL_RED_LINE } from "./parity-contract.js";
import {
  detectMappingDrift,
  detectRedLineViolations,
  formatDriftFindings,
  formatRedLineFindings,
  listScannedAppSources,
  readAdrCanonicalRedLine,
  TRUST_SECTION_COMPONENT,
} from "./parity-guard-detectors.js";

/**
 * This test lives at
 * `<repo>/server/routes/blueprint/runtime-enablement/parity-guard.test.ts`,
 * so the repository root is four directories up — matching the sibling
 * `parity-contract.test.ts`.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../");

describe("Parity Guard Test (blueprint-trust-enforcement-model, Requirements 4.1–4.5)", () => {
  // ─── Mapping-drift check (4.1, 4.4) ──────────────────────────────────────

  it("App/Skill node mapping matches codebase reality — no drift (4.1, 4.4)", () => {
    const drift = detectMappingDrift(REPO_ROOT);
    expect(
      drift,
      drift.length === 0
        ? "expected no mapping drift"
        : `Parity Contract drifted from codebase reality:\n${formatDriftFindings(drift)}`,
    ).toHaveLength(0);
  });

  // ─── Red Line check (4.2, 4.4) ───────────────────────────────────────────

  it("App trust-surface sources assert no Red Line guarantee (4.2, 4.4)", () => {
    const violations = detectRedLineViolations(REPO_ROOT);
    expect(
      violations,
      violations.length === 0
        ? "expected no Red Line assertions"
        : `App asserted the Skill's hard-gate / agent-can't-touch guarantee:\n${formatRedLineFindings(violations)}`,
    ).toHaveLength(0);
  });

  // ─── Pass condition (4.3) ────────────────────────────────────────────────

  it("passes when the mapping matches AND no Red Line assertion is found (4.3)", () => {
    const drift = detectMappingDrift(REPO_ROOT);
    const violations = detectRedLineViolations(REPO_ROOT);
    const passes = drift.length === 0 && violations.length === 0;
    expect(
      passes,
      passes
        ? "guard passes"
        : `guard fails:\nDRIFT:\n${formatDriftFindings(drift)}\nRED LINE:\n${formatRedLineFindings(
            violations,
          )}`,
    ).toBe(true);
  });

  // ─── Red Line single source of truth ─────────────────────────────────────

  it("contract redLine equals the ADR canonical Red Line verbatim", () => {
    const adrRedLine = readAdrCanonicalRedLine(REPO_ROOT);
    expect(PARITY_CONTRACT.redLine).toBe(adrRedLine);
    expect(CANONICAL_RED_LINE).toBe(adrRedLine);
  });

  // ─── Scan coverage sanity ────────────────────────────────────────────────

  it("scans the 5 gate services + the trust panels + TrustSection.tsx (4.2)", () => {
    const scanned = listScannedAppSources(REPO_ROOT);

    // TrustSection is always scanned.
    expect(scanned).toContain(TRUST_SECTION_COMPONENT);

    // All 5 gate-service routes recorded in the contract are scanned.
    for (const node of PARITY_CONTRACT.nodes) {
      if (node.appArtifact.route) {
        expect(
          scanned,
          `gate service ${node.appArtifact.route} is scanned`,
        ).toContain(node.appArtifact.route);
      }
      if (node.appArtifact.component) {
        expect(
          scanned,
          `trust panel ${node.appArtifact.component} is scanned`,
        ).toContain(node.appArtifact.component);
      }
    }
  });
});
