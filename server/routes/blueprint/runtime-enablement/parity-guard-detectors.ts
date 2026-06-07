/**
 * Parity Guard detectors — the pure scanning core of the `Parity_Guard_Test`
 * (blueprint-trust-enforcement-model, Task 6.1, Requirements 4.1–4.4).
 *
 * Two detectors live here, both pure functions of `(repoRoot, contract)`:
 *
 * 1. {@link detectMappingDrift} (Requirement 4.1) — for each node in the
 *    Parity Contract, assert the codebase reality matches the recorded mapping:
 *    the App env flag is a real member of `TRUST_GATE_ENABLEMENT_KEYS`, the App
 *    route / component exists on disk, and the Skill script exists under
 *    `skills/whybuddy/whybuddy/scripts/**`. Any mismatch is reported as a
 *    {@link DriftFinding} naming the drifted node id and unresolved artifact.
 *
 * 2. {@link detectRedLineViolations} (Requirement 4.2) — scan the App
 *    trust-surface sources (the 5 gate services named by the contract, plus the
 *    right-rail trust panels and `TrustSection.tsx`) for any phrase that asserts
 *    or implies the Skill's hard-gate / "agent-can't-touch" guarantee, using a
 *    denylist derived from the ADR's canonical concepts
 *    ({@link FORBIDDEN_APP_PHRASES}). Each match is reported as a
 *    {@link RedLineFinding} naming the file, phrase, line, and excerpt.
 *
 * The denylist is intentionally derived from the ADR (`The App must never
 * describe its own gates as a hard gate, as tamper-proof, or as a guarantee the
 * agent cannot touch or bypass`) and deliberately EXCLUDES the bare words
 * "block" and "never", so the App's legitimate advisory wording — e.g. "records
 * findings for human review and never auto-blocks" — is NOT flagged.
 *
 * This module is data/IO-read only. It changes no runtime behavior, turns no
 * gate on or off, and never converts an advisory App gate into a blocking gate.
 *
 * @see .kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md
 * @see ./parity-contract.ts — the contract these detectors compare against
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  PARITY_CONTRACT,
  type ParityContract,
  type ParityNode,
} from "./parity-contract.js";
import { TRUST_GATE_ENABLEMENT_KEYS } from "./resolver.js";

/** Repo-relative path to the Enforcement_Model_Decision_Record (ADR). */
export const ADR_RELATIVE_PATH =
  ".kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md";

/**
 * Required prefix for every Skill artifact script path (Requirement 3.4 / the
 * Task 6.1 mapping-drift contract: "Skill script file exists under
 * `skills/whybuddy/whybuddy/scripts/**`").
 */
export const SKILL_SCRIPT_PREFIX = "skills/whybuddy/whybuddy/scripts/";

/**
 * The App trust-surface component that is always scanned in addition to the
 * routes / components named by the contract (Requirement 4.2).
 */
export const TRUST_SECTION_COMPONENT =
  "client/src/pages/autopilot/right-rail/TrustSection.tsx";

/**
 * A single node-mapping drift between the Parity Contract and codebase reality.
 */
export interface DriftFinding {
  /** The drifted node's stable id (Requirement 4.4). */
  nodeId: string;
  /** Which artifact slot drifted: env flag / route / component / skill script. */
  artifactKind: "envFlag" | "route" | "component" | "skillScript";
  /** The unresolved artifact value as recorded in the contract. */
  artifact: string;
  /** Human-readable reason the artifact failed to resolve. */
  detail: string;
}

/**
 * A single detected Red Line assertion in an App trust-surface source.
 */
export interface RedLineFinding {
  /** Repo-relative path of the offending file (Requirement 4.4). */
  file: string;
  /** The matched forbidden phrase (Requirement 4.4). */
  phrase: string;
  /** 1-based line number of the match. */
  line: number;
  /** The trimmed source line containing the match. */
  excerpt: string;
}

/**
 * Phrases that would assert or imply the Skill's "agent-can't-touch" guarantee.
 *
 * Derived from the ADR's canonical concepts: the App must never describe its own
 * gates as a hard gate, as tamper-proof / tamper-evident, or as a guarantee the
 * agent cannot touch / modify / bypass, nor as living "outside the agent's
 * control", nor as something that "won't let it pass".
 *
 * Deliberately EXCLUDES the bare words "block" and "never" so the App's correct
 * advisory stance ("never auto-blocks") is not flagged. Kept consistent with
 * the `FORBIDDEN_APP_PHRASES` denylist in `parity-contract.test.ts`.
 */
export const FORBIDDEN_APP_PHRASES = [
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

/**
 * Reads the single canonical Red Line out of the ADR's uniquely delimited
 * `CANONICAL-RED-LINE:BEGIN / END` region and its fenced `canonical-red-line`
 * block. Returns the trimmed verbatim line. Throws if the ADR or the block is
 * missing — a correct, intended failure, since the record is required.
 */
export const readAdrCanonicalRedLine = (repoRoot: string): string => {
  const adrPath = path.join(repoRoot, ADR_RELATIVE_PATH);
  if (!existsSync(adrPath)) {
    throw new Error(
      `Enforcement_Model_Decision_Record not found at ${ADR_RELATIVE_PATH}`,
    );
  }
  const adr = readFileSync(adrPath, "utf8");
  const beginIdx = adr.indexOf("CANONICAL-RED-LINE:BEGIN");
  const endIdx = adr.indexOf("CANONICAL-RED-LINE:END");
  if (beginIdx < 0 || endIdx <= beginIdx) {
    throw new Error(
      "ADR is missing the CANONICAL-RED-LINE:BEGIN / END delimited region",
    );
  }
  const region = adr.slice(beginIdx, endIdx);
  const fence = region.match(/```canonical-red-line\s*\n([\s\S]*?)\n```/);
  if (fence === null) {
    throw new Error("ADR must contain a fenced canonical-red-line block");
  }
  return fence[1].trim();
};

/**
 * Detects any drift between the Parity Contract's recorded mapping and codebase
 * reality (Requirement 4.1). Returns one {@link DriftFinding} per unresolved
 * artifact; an empty array means the mapping matches.
 */
export const detectMappingDrift = (
  repoRoot: string,
  contract: ParityContract = PARITY_CONTRACT,
): DriftFinding[] => {
  const findings: DriftFinding[] = [];
  const knownFlags = new Set<string>(TRUST_GATE_ENABLEMENT_KEYS);

  for (const node of contract.nodes) {
    const { envFlag, route, component } = node.appArtifact;

    // App env flag must be a real Trust Gate key.
    if (envFlag !== undefined && !knownFlags.has(envFlag)) {
      findings.push({
        nodeId: node.nodeId,
        artifactKind: "envFlag",
        artifact: envFlag,
        detail: `env flag is not a member of TRUST_GATE_ENABLEMENT_KEYS`,
      });
    }

    // App route module must exist on disk.
    if (route !== undefined && !existsSync(path.join(repoRoot, route))) {
      findings.push({
        nodeId: node.nodeId,
        artifactKind: "route",
        artifact: route,
        detail: "App route/service module does not exist on disk",
      });
    }

    // App right-rail component must exist on disk.
    if (component !== undefined && !existsSync(path.join(repoRoot, component))) {
      findings.push({
        nodeId: node.nodeId,
        artifactKind: "component",
        artifact: component,
        detail: "App right-rail component does not exist on disk",
      });
    }

    // Skill script must live under skills/whybuddy/whybuddy/scripts/** and exist.
    const script = node.skillArtifact.script;
    if (!script.startsWith(SKILL_SCRIPT_PREFIX)) {
      findings.push({
        nodeId: node.nodeId,
        artifactKind: "skillScript",
        artifact: script,
        detail: `Skill script is not under ${SKILL_SCRIPT_PREFIX}`,
      });
    } else if (!existsSync(path.join(repoRoot, script))) {
      findings.push({
        nodeId: node.nodeId,
        artifactKind: "skillScript",
        artifact: script,
        detail: "Skill script does not exist on disk",
      });
    }
  }

  return findings;
};

/**
 * Resolves the de-duplicated set of repo-relative App trust-surface source
 * files to scan for Red Line assertions (Requirement 4.2): the contract's App
 * routes (the 5 gate services) and components plus the always-scanned
 * {@link TRUST_SECTION_COMPONENT}. Only files that exist on disk are returned;
 * missing files are mapping drift and are caught by {@link detectMappingDrift}.
 */
export const listScannedAppSources = (
  repoRoot: string,
  contract: ParityContract = PARITY_CONTRACT,
): string[] => {
  const sources = new Set<string>([TRUST_SECTION_COMPONENT]);
  for (const node of contract.nodes) {
    if (node.appArtifact.route) sources.add(node.appArtifact.route);
    if (node.appArtifact.component) sources.add(node.appArtifact.component);
  }
  return [...sources].filter((rel) => existsSync(path.join(repoRoot, rel)));
};

/**
 * Scans the App trust-surface sources for any forbidden phrase that asserts or
 * implies the Skill's hard-gate / "agent-can't-touch" guarantee (Requirement
 * 4.2). Returns one {@link RedLineFinding} per match; an empty array means the
 * App does not assert the Skill's guarantee.
 *
 * Matching is case-insensitive and line-based so the report can name the exact
 * file, phrase, and line (Requirement 4.4). The denylist excludes bare "block"
 * / "never", so legitimate advisory wording is never flagged.
 */
export const detectRedLineViolations = (
  repoRoot: string,
  contract: ParityContract = PARITY_CONTRACT,
): RedLineFinding[] => {
  const findings: RedLineFinding[] = [];

  for (const rel of listScannedAppSources(repoRoot, contract)) {
    const content = readFileSync(path.join(repoRoot, rel), "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((rawLine, idx) => {
      const haystack = rawLine.toLowerCase();
      for (const phrase of FORBIDDEN_APP_PHRASES) {
        if (haystack.includes(phrase)) {
          findings.push({
            file: rel,
            phrase,
            line: idx + 1,
            excerpt: rawLine.trim(),
          });
        }
      }
    });
  }

  return findings;
};

/** Formats drift findings into a human-readable diagnostic (Requirement 4.4). */
export const formatDriftFindings = (findings: DriftFinding[]): string =>
  findings
    .map(
      (f) =>
        `  - node "${f.nodeId}" [${f.artifactKind}] ${f.artifact}: ${f.detail}`,
    )
    .join("\n");

/** Formats Red Line findings into a human-readable diagnostic (Requirement 4.4). */
export const formatRedLineFindings = (findings: RedLineFinding[]): string =>
  findings
    .map(
      (f) =>
        `  - ${f.file}:${f.line} matched forbidden phrase "${f.phrase}" → ${f.excerpt}`,
    )
    .join("\n");

export type { ParityContract, ParityNode };
