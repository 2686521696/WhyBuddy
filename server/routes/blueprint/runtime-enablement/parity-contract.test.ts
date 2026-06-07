/**
 * Parity Contract structure tests + Red Line property test
 * (blueprint-trust-enforcement-model, Task 5.2).
 *
 * Two complementary kinds of test live here:
 *
 * 1. **Structure tests (example-based, design §Testing Strategy "Parity
 *    Contract structure 3.1–3.4"):** all 5 enforcement-relevant v4 nodes are
 *    enumerated; each carries `appModel`, `skillModel`, `appArtifact`, and
 *    `skillArtifact`; each diverging node has a non-empty `divergenceReason`;
 *    and every referenced artifact (App env flag / route / component, Skill
 *    script) actually resolves in the codebase.
 *
 * 2. **Property 7 (property-based):** the Parity Contract Red Line holds across
 *    all nodes — no node's App-side description implies the Skill's
 *    "agent-can't-touch" guarantee, and the contract `redLine` equals the
 *    canonical verbatim Red Line string defined in the
 *    Enforcement_Model_Decision_Record (ADR).
 *
 * Library: fast-check + Vitest. Minimum 100 iterations for the property.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  PARITY_CONTRACT,
  CANONICAL_RED_LINE,
  type ParityNode,
} from "./parity-contract.js";
import { TRUST_GATE_ENABLEMENT_KEYS } from "./resolver.js";

// ─── Repo-root + ADR path resolution ──────────────────────────────────────

/**
 * This test lives at
 * `<repo>/server/routes/blueprint/runtime-enablement/parity-contract.test.ts`,
 * so the repository root is four directories up.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../");

const ADR_PATH = path.join(
  REPO_ROOT,
  ".kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md",
);

/**
 * The 5 enforcement-relevant v4 node ids expected by Requirement 3.1.
 */
const EXPECTED_NODE_IDS = [
  "checks-ledger",
  "content-quality",
  "companion",
  "traceability-matrix",
  "preview-audit",
] as const;

const NUM_RUNS = 100;

/**
 * Reads the single canonical Red Line out of the ADR's uniquely delimited
 * `CANONICAL-RED-LINE:BEGIN / END` region and its fenced `canonical-red-line`
 * block, exactly as the guard test will. Returns the trimmed verbatim line.
 */
const readAdrCanonicalRedLine = (): string => {
  const adr = readFileSync(ADR_PATH, "utf8");
  const beginIdx = adr.indexOf("CANONICAL-RED-LINE:BEGIN");
  const endIdx = adr.indexOf("CANONICAL-RED-LINE:END");
  expect(beginIdx).toBeGreaterThanOrEqual(0);
  expect(endIdx).toBeGreaterThan(beginIdx);

  const region = adr.slice(beginIdx, endIdx);
  const fence = region.match(/```canonical-red-line\s*\n([\s\S]*?)\n```/);
  expect(fence, "ADR must contain a fenced canonical-red-line block").not.toBeNull();
  return (fence as RegExpMatchArray)[1].trim();
};

/**
 * Resolves the App-side description of a node — the model plus only the
 * "App:" portion of its `divergenceReason`, stopping before the "Skill:"
 * portion (whose hard-gate language is correct and must not trip the scan).
 */
const appSideDescription = (node: ParityNode): string => {
  const reason = node.divergenceReason ?? "";
  const skillIdx = reason.indexOf("Skill:");
  const appPortion = skillIdx >= 0 ? reason.slice(0, skillIdx) : reason;
  return `${node.appModel} ${appPortion}`.toLowerCase();
};

/**
 * Phrases that would assert or imply the Skill's "agent-can't-touch"
 * guarantee. Derived from the ADR's canonical concepts: the App must never
 * describe its own gates as a hard gate, tamper-proof, or a guarantee the
 * agent cannot touch / modify / bypass. Deliberately excludes the word
 * "block" alone, since the App's correct stance is "never auto-blocks".
 */
const FORBIDDEN_APP_PHRASES = [
  "hard-gate",
  "hard gate",
  "tamper-proof",
  "tamperproof",
  "tamper-evident",
  "agent-can't-touch",
  "agent can't touch",
  "agent cannot touch",
  "agent can't modify",
  "agent cannot modify",
  "agent cannot bypass",
  "agent can't bypass",
  "outside the agent's control",
  "cannot be modified by the agent",
  "can't be modified by the agent",
  "won't let it pass",
] as const;

// ─── Structure tests (Requirements 3.1–3.4) ───────────────────────────────

describe("Parity Contract structure (blueprint-trust-enforcement-model, Requirements 3.1–3.4)", () => {
  it("enumerates exactly the 5 enforcement-relevant v4 nodes (3.1)", () => {
    expect(PARITY_CONTRACT.nodes).toHaveLength(5);
    expect(PARITY_CONTRACT.nodes.map((n) => n.nodeId).sort()).toEqual(
      [...EXPECTED_NODE_IDS].sort(),
    );
  });

  it("every node records appModel, skillModel, appArtifact, and skillArtifact (3.2, 3.4)", () => {
    for (const node of PARITY_CONTRACT.nodes) {
      expect(node.appModel, `${node.nodeId}.appModel`).toBe("advisory");
      expect(["advisory", "hard-gate"]).toContain(node.skillModel);
      expect(node.appArtifact, `${node.nodeId}.appArtifact`).toBeDefined();
      // App artifact must name at least one concrete artifact.
      const hasAppArtifact =
        Boolean(node.appArtifact.envFlag) ||
        Boolean(node.appArtifact.route) ||
        Boolean(node.appArtifact.component);
      expect(hasAppArtifact, `${node.nodeId} has an App artifact`).toBe(true);
      expect(
        node.skillArtifact.script,
        `${node.nodeId}.skillArtifact.script`,
      ).toBeTruthy();
    }
  });

  it("every diverging node has a non-empty divergenceReason (3.3)", () => {
    for (const node of PARITY_CONTRACT.nodes) {
      if (node.appModel !== node.skillModel) {
        expect(
          node.divergenceReason?.trim(),
          `${node.nodeId} must carry a non-empty divergenceReason`,
        ).toBeTruthy();
      }
    }
  });

  it("every referenced App env flag is a real Trust Gate key (3.4)", () => {
    for (const node of PARITY_CONTRACT.nodes) {
      const flag = node.appArtifact.envFlag;
      if (flag !== undefined) {
        expect(
          TRUST_GATE_ENABLEMENT_KEYS as readonly string[],
          `${node.nodeId} env flag ${flag} is a known Trust Gate key`,
        ).toContain(flag);
      }
    }
  });

  it("every referenced route / component / Skill script resolves on disk (3.4)", () => {
    for (const node of PARITY_CONTRACT.nodes) {
      if (node.appArtifact.route) {
        expect(
          existsSync(path.join(REPO_ROOT, node.appArtifact.route)),
          `${node.nodeId} route exists: ${node.appArtifact.route}`,
        ).toBe(true);
      }
      if (node.appArtifact.component) {
        expect(
          existsSync(path.join(REPO_ROOT, node.appArtifact.component)),
          `${node.nodeId} component exists: ${node.appArtifact.component}`,
        ).toBe(true);
      }
      expect(
        existsSync(path.join(REPO_ROOT, node.skillArtifact.script)),
        `${node.nodeId} Skill script exists: ${node.skillArtifact.script}`,
      ).toBe(true);
    }
  });

  it("records the canonical Red Line as a contract-wide property (3.5)", () => {
    expect(PARITY_CONTRACT.redLine).toBe(CANONICAL_RED_LINE);
    expect(PARITY_CONTRACT.redLine.trim().length).toBeGreaterThan(0);
  });
});

// ─── Property 7 ────────────────────────────────────────────────────────────

// Feature: blueprint-trust-enforcement-model, Property 7: Parity Contract Red Line holds across all nodes — for any node enumerated in the Parity Contract, the node's App-side description SHALL NOT assert or imply the Skill's "agent-can't-touch" guarantee, and the Parity Contract's recorded Red Line string SHALL equal the canonical verbatim Red Line string defined in the Enforcement_Model_Decision_Record.
describe('Feature: blueprint-trust-enforcement-model, Property 7: Parity Contract Red Line holds across all nodes', () => {
  it("no node's App-side description implies the agent-can't-touch guarantee, and redLine equals the ADR canonical string verbatim", () => {
    const adrRedLine = readAdrCanonicalRedLine();

    fc.assert(
      fc.property(
        fc.constantFrom(...PARITY_CONTRACT.nodes),
        fc.constantFrom(...FORBIDDEN_APP_PHRASES),
        (node, forbiddenPhrase) => {
          // The contract's recorded Red Line equals the ADR canonical string,
          // verbatim, every run (the single source of truth holds).
          expect(PARITY_CONTRACT.redLine).toBe(adrRedLine);

          // The App is advisory and its App-side description never asserts the
          // Skill's hard-gate / agent-can't-touch guarantee.
          expect(node.appModel).toBe("advisory");
          expect(appSideDescription(node).includes(forbiddenPhrase)).toBe(
            false,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
