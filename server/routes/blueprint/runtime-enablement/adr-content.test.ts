/**
 * Enforcement_Model_Decision_Record (ADR) content example tests
 * (blueprint-trust-enforcement-model, Task 4.3).
 *
 * These are example-based (not property-based) structural tests over the fixed
 * ADR markdown document. They assert, per design §Testing Strategy "ADR content
 * (2.1–2.4, 2.6, 2.7)":
 *
 *  - the ADR exists as a single committed document (2.6);
 *  - it states the decision: App = advisory/non-blocking, Skill = hard-gate,
 *    the fork is intentional, and the App's advisory model is not a defect to be
 *    remediated (2.1);
 *  - it documents both rationales: the App supervised-cockpit rationale (2.2)
 *    and the Skill unattended-agent-host rationale (2.3);
 *  - it states the Red Line (2.4) and expresses it as exactly one canonical,
 *    verbatim, uniquely delimited fenced `canonical-red-line` block (2.5); and
 *  - it is cross-referenced from a fixed version-controlled entry point —
 *    `resolver.ts` and/or `parity-contract.ts` reference its exact path (2.7).
 *
 * Library: Vitest + node:fs. Reads the ADR and the cross-referencing source
 * files straight off disk, with no mocks.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ─── Repo-root + file path resolution ─────────────────────────────────────

/**
 * This test lives at
 * `<repo>/server/routes/blueprint/runtime-enablement/adr-content.test.ts`, so
 * the repository root is four directories up (mirrors `parity-contract.test.ts`).
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../");

/**
 * The fixed, version-controlled ADR path. Cross-referencing source files must
 * reference this exact repo-relative path (Requirement 2.7).
 */
const ADR_REL_PATH =
  ".kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md";

const ADR_PATH = path.join(REPO_ROOT, ADR_REL_PATH);

/** Fixed entry points that cross-reference the ADR by its exact path (2.7). */
const CROSS_REF_REL_PATHS = [
  "server/routes/blueprint/runtime-enablement/resolver.ts",
  "server/routes/blueprint/runtime-enablement/parity-contract.ts",
] as const;

/**
 * The canonical, verbatim Red Line string. MUST be byte-for-byte identical to
 * the line inside the ADR's fenced `canonical-red-line` block (Requirements
 * 2.4, 2.5).
 */
const CANONICAL_RED_LINE =
  "The App must never claim or imply the Skill's \"agent-can't-touch\" guarantee.";

const readAdr = (): string => readFileSync(ADR_PATH, "utf8");

// ─── 2.6: single committed document ───────────────────────────────────────

describe("ADR content (blueprint-trust-enforcement-model, Task 4.3)", () => {
  it("exists as a single committed document (2.6)", () => {
    expect(
      existsSync(ADR_PATH),
      `ADR must exist at ${ADR_REL_PATH}`,
    ).toBe(true);

    const adr = readAdr();
    expect(adr.trim().length).toBeGreaterThan(0);
    // It is an ADR: a recognizable title heading anchors the single document.
    expect(adr).toMatch(/^#\s+ADR/m);
  });

  // ─── 2.1: the decision statement ────────────────────────────────────────

  it("states the App=advisory / Skill=hard-gate decision, the intentional fork, and that the App model is not a defect (2.1)", () => {
    const adr = readAdr().toLowerCase();

    // App uses advisory / non-blocking enforcement.
    expect(adr).toContain("advisory");
    expect(adr).toMatch(/non-?blocking/);
    // Skill uses hard-gate enforcement.
    expect(adr).toMatch(/hard-?gate/);
    // The fork is intentional.
    expect(adr).toContain("intentional");
    // The App's advisory model is not a defect to be remediated.
    expect(adr).toContain("not a defect");
  });

  // ─── 2.2: App supervised-cockpit rationale ──────────────────────────────

  it("documents the App supervised-cockpit rationale (2.2)", () => {
    const adr = readAdr().toLowerCase();

    expect(adr).toContain("supervised cockpit");
    // A human watches the right-rail in real time and is the gate.
    expect(adr).toContain("right-rail");
    expect(adr).toContain("real time");
    expect(adr).toMatch(/human (is the gate|supervisor|watches)/);
    // Findings are recorded / surfaced for human review rather than auto-blocked.
    expect(adr).toContain("checks ledger");
  });

  // ─── 2.3: Skill unattended-agent-host rationale ─────────────────────────

  it("documents the Skill unattended-agent-host rationale (2.3)", () => {
    const adr = readAdr().toLowerCase();

    expect(adr).toContain("unattended agent host");
    // The enforcer lives outside the agent's control because the agent may cheat.
    expect(adr).toContain("outside the agent's control");
    expect(adr).toContain("may cheat");
  });

  // ─── 2.4 + 2.5: the Red Line as exactly one canonical block ─────────────

  it("states the Red Line verbatim somewhere in the document (2.4)", () => {
    const adr = readAdr();
    expect(adr).toContain(CANONICAL_RED_LINE);
  });

  it("expresses the Red Line as exactly one uniquely delimited canonical block (2.5)", () => {
    const adr = readAdr();

    // Exactly one BEGIN/END delimiter pair.
    const beginCount = adr.split("CANONICAL-RED-LINE:BEGIN").length - 1;
    const endCount = adr.split("CANONICAL-RED-LINE:END").length - 1;
    expect(beginCount, "exactly one CANONICAL-RED-LINE:BEGIN").toBe(1);
    expect(endCount, "exactly one CANONICAL-RED-LINE:END").toBe(1);

    const beginIdx = adr.indexOf("CANONICAL-RED-LINE:BEGIN");
    const endIdx = adr.indexOf("CANONICAL-RED-LINE:END");
    expect(endIdx).toBeGreaterThan(beginIdx);

    // Exactly one fenced `canonical-red-line` code block inside that region.
    const region = adr.slice(beginIdx, endIdx);
    const fenceMatches = region.match(
      /```canonical-red-line\s*\n([\s\S]*?)\n```/g,
    );
    expect(
      fenceMatches,
      "ADR must contain a fenced canonical-red-line block",
    ).not.toBeNull();
    expect(
      (fenceMatches as RegExpMatchArray).length,
      "exactly one fenced canonical-red-line block",
    ).toBe(1);

    // The block contains exactly the canonical Red Line, verbatim.
    const fence = region.match(/```canonical-red-line\s*\n([\s\S]*?)\n```/);
    const blockBody = (fence as RegExpMatchArray)[1].trim();
    expect(blockBody).toBe(CANONICAL_RED_LINE);

    // And there is no second `canonical-red-line` fence anywhere in the doc.
    const docFenceCount =
      adr.match(/```canonical-red-line/g)?.length ?? 0;
    expect(docFenceCount, "only one canonical-red-line fence in the whole ADR").toBe(
      1,
    );
  });

  // ─── 2.7: cross-referenced from a fixed entry point ─────────────────────

  it("is cross-referenced from at least one fixed version-controlled entry point by its exact path (2.7)", () => {
    const referencingFiles = CROSS_REF_REL_PATHS.filter((relPath) => {
      const abs = path.join(REPO_ROOT, relPath);
      if (!existsSync(abs)) return false;
      return readFileSync(abs, "utf8").includes(ADR_REL_PATH);
    });

    expect(
      referencingFiles.length,
      `at least one of ${CROSS_REF_REL_PATHS.join(", ")} must reference ${ADR_REL_PATH}`,
    ).toBeGreaterThanOrEqual(1);
  });
});
