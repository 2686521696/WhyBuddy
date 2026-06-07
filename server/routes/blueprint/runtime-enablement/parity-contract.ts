/**
 * Parity Contract — App (Track A) vs Skill (Track B) enforcement-model mapping.
 *
 * This is the machine-readable half of the `Parity_Contract` for the
 * `blueprint-trust-enforcement-model` spec. It maps each enforcement-relevant
 * node of the WhyBuddy v4 closed-loop diagram
 * (`docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`) to the enforcement
 * model it uses in the App vs the Skill, the reason the two diverge, and the
 * concrete App / Skill artifacts that implement that node's enforcement.
 *
 * The companion human-readable document lives at
 * `.kiro/specs/blueprint-trust-enforcement-model/parity-contract.md`.
 *
 * ## The Red Line is data, not prose
 *
 * The {@link PARITY_CONTRACT}.`redLine` field below holds the single canonical,
 * verbatim Red Line string copied **unchanged** from the
 * Enforcement_Model_Decision_Record (ADR):
 * `.kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md`
 * (see the `CANONICAL-RED-LINE` block in that file). The `Parity_Guard_Test`
 * reads this exact string as its literal pass/fail criterion, so the constraint
 * flows ADR → Parity Contract → Guard Test and is enforced by CI rather than by
 * memory.
 *
 * This module is **data only**: it describes the intentional App=advisory /
 * Skill=hard-gate fork. It changes no runtime behavior, turns no gate on or off,
 * and never converts any advisory App gate into a blocking gate.
 *
 * @see design.md "Data Models" — `EnforcementModel`, `ParityNode`, `ParityContract`
 * @see .kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md
 */

import type { TrustGateEnablementKey } from "./resolver.js";

/**
 * The enforcement model a track uses for a given node.
 *
 * - `"advisory"` — record a finding and surface it for human review; never
 *   auto-block. This is always the App's (Track A) model.
 * - `"hard-gate"` — a check whose non-zero result blocks the step, living
 *   outside the agent's control. This is the Skill's (Track B) model for every
 *   enforced node.
 */
export type EnforcementModel = "advisory" | "hard-gate";

/**
 * One enforcement-relevant v4 node mapped across both tracks.
 *
 * `divergenceReason` is required whenever `appModel !== skillModel`
 * (Requirement 3.3); every node in this contract diverges, so every node
 * carries a non-empty reason.
 */
export interface ParityNode {
  /** Stable id, e.g. `"checks-ledger"`. */
  nodeId: string;
  /** Human label of the v4 diagram node. */
  label: string;
  /** App (Track A) enforcement model — always `"advisory"`. */
  appModel: EnforcementModel;
  /** Skill (Track B) enforcement model — `"hard-gate"` for enforced nodes. */
  skillModel: EnforcementModel;
  /**
   * Reason the App and Skill models differ (Requirement 3.3). Required and
   * non-empty for every node whose `appModel !== skillModel`.
   */
  divergenceReason?: string;
  /**
   * App artifact that implements this node's enforcement (Requirement 3.4):
   * the env flag (a member of `TRUST_GATE_ENABLEMENT_KEYS`), the server route /
   * service module path, and/or the right-rail component path.
   */
  appArtifact: {
    envFlag?: TrustGateEnablementKey;
    /** Repo-relative path to the server route / service module. */
    route?: string;
    /** Repo-relative path to the right-rail trust component. */
    component?: string;
  };
  /**
   * Skill artifact (Requirement 3.4): repo-relative path to the Python script
   * under `skills/whybuddy/whybuddy/scripts/**` that enforces this node.
   */
  skillArtifact: { script: string };
}

/**
 * The Parity Contract: the canonical Red Line plus the per-node enforcement
 * mapping. `redLine` is asserted to hold across **all** nodes (Requirement 3.5).
 */
export interface ParityContract {
  /**
   * The canonical Red Line, copied **verbatim** from the ADR's
   * `CANONICAL-RED-LINE` block (Requirements 3.5, 2.5). Do not edit,
   * paraphrase, reformat, or translate.
   */
  redLine: string;
  nodes: ParityNode[];
}

/**
 * The canonical Red Line string. Copied verbatim from the ADR
 * (`enforcement-model-decision-record.md`, `CANONICAL-RED-LINE` block).
 * The `Parity_Guard_Test` compares this against the ADR's string for exact
 * equality, so it MUST remain byte-for-byte identical to the ADR.
 */
export const CANONICAL_RED_LINE =
  "The App must never claim or imply the Skill's \"agent-can't-touch\" guarantee.";

/**
 * The five enforcement-relevant v4 nodes (Requirement 3.1):
 * checks ledger, content-quality check, companion critic/grounding,
 * traceability matrix, and preview/output audit.
 *
 * Every node uses `appModel: "advisory"` and `skillModel: "hard-gate"`
 * (Requirement 3.2) and therefore carries a `divergenceReason` rooted in the
 * supervised-cockpit (App) vs unattended-agent-host (Skill) distinction
 * (Requirement 3.3). Each node names its App artifact (env flag / route /
 * component) and its Skill script under `skills/whybuddy/whybuddy/scripts/**`
 * (Requirement 3.4).
 */
export const PARITY_CONTRACT: ParityContract = {
  redLine: CANONICAL_RED_LINE,
  nodes: [
    {
      nodeId: "checks-ledger",
      label: "Checks ledger",
      appModel: "advisory",
      skillModel: "hard-gate",
      divergenceReason:
        "App: a human supervisor watches the right-rail ChecksLedgerPanel in real time and is the gate, so the ledger records findings for review and never auto-blocks. Skill: runs unattended where the agent may cheat, so gate.py writes a tamper-evident ledger entry and a non-zero exit hard-blocks the step outside the agent's control.",
      appArtifact: {
        envFlag: "BLUEPRINT_CHECKS_LEDGER_ENABLED",
        route: "server/routes/blueprint/checks-ledger/service.ts",
        component:
          "client/src/pages/autopilot/right-rail/panels/ChecksLedgerPanel.tsx",
      },
      skillArtifact: { script: "skills/whybuddy/whybuddy/scripts/gate.py" },
    },
    {
      nodeId: "content-quality",
      label: "Content-quality check",
      appModel: "advisory",
      skillModel: "hard-gate",
      divergenceReason:
        "App: the supervised cockpit records content-quality findings to the checks ledger and surfaces them for the human reviewer rather than blocking generation. Skill: the unattended host cannot trust the agent to self-police quality, so check_content_quality.py hard-fails the step when quality thresholds are not met.",
      appArtifact: {
        envFlag: "BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED",
        route: "server/routes/blueprint/content-quality/service.ts",
      },
      skillArtifact: {
        script: "skills/whybuddy/whybuddy/scripts/check_content_quality.py",
      },
    },
    {
      nodeId: "companion",
      label: "Companion critic/grounding",
      appModel: "advisory",
      skillModel: "hard-gate",
      divergenceReason:
        "App: companion critic/grounding findings are advisory signals shown in the right-rail CompanionFindingsPanel for the human to weigh; they never auto-block. Skill: with no human watching, check_companion.py enforces grounding as a hard gate so the agent cannot pass off ungrounded output.",
      appArtifact: {
        envFlag: "BLUEPRINT_COMPANION_ENABLED",
        route: "server/routes/blueprint/companion/service.ts",
        component:
          "client/src/pages/autopilot/right-rail/panels/CompanionFindingsPanel.tsx",
      },
      skillArtifact: {
        script: "skills/whybuddy/whybuddy/scripts/check_companion.py",
      },
    },
    {
      nodeId: "traceability-matrix",
      label: "Traceability matrix",
      appModel: "advisory",
      skillModel: "hard-gate",
      divergenceReason:
        "App: the TraceabilityMatrixPanel surfaces coverage gaps to the human supervisor as advisory findings rather than halting the pipeline. Skill: validate_spec_tree.py runs unattended and hard-fails when the spec tree / traceability invariants break, because the agent cannot be trusted to enforce them on itself.",
      appArtifact: {
        envFlag: "BLUEPRINT_TRACEABILITY_MATRIX_ENABLED",
        route: "server/routes/blueprint/traceability-matrix/service.ts",
        component:
          "client/src/pages/autopilot/right-rail/panels/TraceabilityMatrixPanel.tsx",
      },
      skillArtifact: {
        script: "skills/whybuddy/whybuddy/scripts/validate_spec_tree.py",
      },
    },
    {
      nodeId: "preview-audit",
      label: "Preview/output audit",
      appModel: "advisory",
      skillModel: "hard-gate",
      divergenceReason:
        "App: preview/output audit findings are recorded and surfaced for the human supervisor, who decides whether to regenerate; the cockpit never auto-blocks. Skill: the user-run check_previews_real.py audit lives outside the agent's control so the agent cannot pass placeholder output off as a real rendered preview.",
      appArtifact: {
        envFlag: "BLUEPRINT_PREVIEW_AUDIT_ENABLED",
        route: "server/routes/blueprint/preview-audit/service.ts",
      },
      skillArtifact: {
        script: "skills/whybuddy/whybuddy/scripts/check_previews_real.py",
      },
    },
  ],
};
