# Requirements Document

## Introduction

The WhyBuddy closed-loop architecture diagram (`docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`, hereafter "the v4 Diagram") is realized by **two parallel implementations**:

- **Track A — the App**: the in-app TypeScript "blueprint" pipeline (`server/routes/blueprint.ts` mounted at `/api/blueprint`, `shared/blueprint/**` contracts, and the autopilot right-rail `TrustSection` with `ChecksLedgerPanel` / `TraceabilityMatrixPanel` / `CompanionFindingsPanel`). The App runs as a **supervised cockpit**: a human watches the right-rail in real time. Its five v4 trust gates are **advisory / non-blocking** — they record findings to the checks ledger and surface them for human review, and **never auto-block**.
- **Track B — the Skill**: the portable Claude Skill (`skills/whybuddy/**`) — Python scripts with `gate.py` hard gates and a user-run `check_previews_real.py` audit. The Skill runs in an **unattended agent host** where the agent itself may cheat, so its enforcer lives **outside the agent's control** (hard gate + user-run audit the agent cannot modify).

A re-verified gap analysis between the v4 Diagram and the codebase established the premises below. This spec treats them as **fixed**, not open questions:

- **The App/Skill enforcement divergence is intentional and correct.** App = "I show you, you decide" (a human is the gate). Skill = "I won't let it pass" (a hard gate the agent can't touch). The App **must NOT** be aligned to the Skill's hard-gate model.
- **The 5 v4 trust gates are already ON by default** (via `scripts/dev-all.mjs` `resolveV4AlignmentGates()` and `.env.example`). This spec does **not** turn gates on.
- **The trust UI is already mounted** in `AutopilotRightRail` via `TrustSection`. This spec does **not** build trust UI.

This spec addresses exactly three concerns: (1) a latent deployment hazard in how the 5 trust-gate defaults resolve; (2) capturing the advisory-vs-hard-gate decision as a discoverable, checkable record; and (3) a documented parity contract plus an automated guard test that fails if the App/Skill enforcement mapping drifts or if the App starts claiming the Skill's guarantee.

**The Red Line (applies to all requirements):** the App must never claim or imply the Skill's "agent-can't-touch" guarantee.

## Glossary

- **App / Track A**: The in-app TypeScript blueprint pipeline mounted at `/api/blueprint`, with the right-rail `TrustSection` trust UI. A supervised, interactive cockpit.
- **Skill / Track B**: The portable Claude Skill under `skills/whybuddy/**`, enforced by `gate.py` hard gates and a user-run `check_previews_real.py` audit. An unattended agent host.
- **v4 Diagram**: `docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`, the closed-loop architecture diagram both tracks implement.
- **5 Trust Gates**: The five App environment flags `BLUEPRINT_CHECKS_LEDGER_ENABLED`, `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED`, `BLUEPRINT_COMPANION_ENABLED`, `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED`, `BLUEPRINT_PREVIEW_AUDIT_ENABLED`.
- **Master Switch**: The `AUTOPILOT_REAL_RUNTIME` environment variable that drives the opt-out default for the 6 capability bridges.
- **Advisory / Non-blocking Enforcement**: The App's enforcement model — record a finding to the checks ledger and surface it for human review; never auto-block execution.
- **Hard-gate Enforcement**: The Skill's enforcement model — `gate.py` wraps a check and a non-zero exit code blocks the step; the user-run audit cannot be modified by the agent.
- **The Red Line**: The constraint that the App must never claim or imply the Skill's "agent-can't-touch" guarantee.
- **Trust_Gate_Resolver**: The proposed single central default-resolution path (analogous to the existing `resolveAllBridgeEnablement` in `server/routes/blueprint/runtime-enablement/resolver.ts`) that resolves the 5 Trust Gate defaults.
- **Enforcement_Model_Decision_Record**: The architecture decision record (ADR) document that captures the advisory-vs-hard-gate fork, its rationale, and the Red Line.
- **Parity_Contract**: The document mapping each enforcement-relevant v4 Diagram node to the enforcement model it uses in the App vs the Skill, and why.
- **Parity_Guard_Test**: The automated test that fails when the App/Skill node-model mapping drifts from the Parity_Contract or when the App asserts the Skill's hard-gate / agent-can't-touch guarantee.
- **Explicit Per-flag Value**: A value a developer or operator sets directly for one of the 5 Trust Gates (e.g. in `.env` or a shell), as opposed to a resolved default.
- **Test Build Target**: A process environment where `BUILD_TARGET` equals `"test"`.

## Requirements

### Requirement 1: Central, master-switch-consistent default resolution for the 5 Trust Gates

**User Story:** As an operator deploying the App outside the `dev:all` launch path, I want the 5 Trust Gates to resolve their enable/disable default consistently with the `AUTOPILOT_REAL_RUNTIME` master switch, so that a production launch that runs the 6 capability bridges as real does not silently leave the trust loop off.

**Context (latent hazard, verified-real gap #3):** Today the 5 Trust Gate defaults come **only** from `scripts/dev-all.mjs` `resolveV4AlignmentGates()`. They are absent from `BRIDGE_ENABLEMENT_KEYS` in `server/routes/blueprint/runtime-enablement/resolver.ts` and do not honor the Master Switch at the resolver level. A launch that sets `AUTOPILOT_REAL_RUNTIME=true` but bypasses `dev-all.mjs` and does not set the 5 flags explicitly runs the 6 capability bridges as real while the trust loop stays silently off.

#### Acceptance Criteria

1. THE Trust_Gate_Resolver SHALL resolve a value within the set `{"true", "false"}` for each of the 5 Trust Gates within a single central default-resolution path, and SHALL include all 5 Trust Gates in its result.
2. WHILE `BUILD_TARGET` does not equal `"test"`, WHEN an Explicit Per-flag Value is set for a Trust Gate (present and non-empty after trimming whitespace), THE Trust_Gate_Resolver SHALL return that explicit value unchanged for that gate, overriding the Master Switch.
3. WHILE no Explicit Per-flag Value is set for a Trust Gate AND `AUTOPILOT_REAL_RUNTIME` equals exactly (case-sensitive) `"true"`, THE Trust_Gate_Resolver SHALL resolve that Trust Gate's default to `"true"`.
4. WHILE no Explicit Per-flag Value is set for a Trust Gate AND `AUTOPILOT_REAL_RUNTIME` holds any value other than exactly (case-sensitive) `"true"` — including unset, empty, or non-canonical values — THE Trust_Gate_Resolver SHALL resolve that Trust Gate's default to `"false"`.
5. IF `BUILD_TARGET` equals `"test"` AND no Explicit Per-flag Value of `"true"` is set for a Trust Gate, THEN THE Trust_Gate_Resolver SHALL resolve that Trust Gate to `"false"`; this test-lock SHALL take precedence over the Master Switch.
6. WHEN `BUILD_TARGET` equals `"test"` AND an Explicit Per-flag Value of `"true"` is set for a Trust Gate, THE Trust_Gate_Resolver SHALL resolve that Trust Gate to `"true"`.
7. WHEN the Trust_Gate_Resolver runs twice against the same environment input, THE Trust_Gate_Resolver SHALL produce identical resolved values on both runs and SHALL perform no further environment write-backs after the first run.
8. THE Trust_Gate_Resolver SHALL preserve the existing `dev:all` startup behavior such that all 5 Trust Gates resolve to `"true"` by default when the App is launched through `scripts/dev-all.mjs`.
9. THE Trust_Gate_Resolver SHALL resolve only the enable/disable default of each Trust Gate AND SHALL NOT change the advisory / non-blocking nature of any Trust Gate AND SHALL NOT introduce auto-blocking behavior.

### Requirement 2: Capture the advisory-vs-hard-gate enforcement-model decision as a discoverable, checkable record

**User Story:** As a developer or reviewer reading the codebase, I want the intentional App=advisory / Skill=hard-gate fork to be written down with its rationale, so that the divergence is understood as a deliberate design decision rather than mistaken for an App defect to be "fixed."

#### Acceptance Criteria

1. THE Enforcement_Model_Decision_Record SHALL state that the App uses advisory / non-blocking enforcement and the Skill uses hard-gate enforcement, that this fork is intentional, and that the App's advisory model is not a defect to be remediated.
2. THE Enforcement_Model_Decision_Record SHALL document the supervised-cockpit rationale for the App enforcement model: a human watches the right-rail in real time and is the gate, so findings are recorded to the checks ledger and surfaced for human review rather than auto-blocked.
3. THE Enforcement_Model_Decision_Record SHALL document the unattended-agent-host rationale for the Skill enforcement model: the enforcer lives outside the agent's control because the agent itself may cheat.
4. THE Enforcement_Model_Decision_Record SHALL state the Red Line: the App must never claim or imply the Skill's "agent-can't-touch" guarantee.
5. THE Enforcement_Model_Decision_Record SHALL express the Red Line as a single canonical, verbatim statement that the Parity_Guard_Test consumes unchanged as its literal pass/fail criterion.
6. THE Enforcement_Model_Decision_Record SHALL be a single version-controlled document committed to the repository.
7. THE Enforcement_Model_Decision_Record SHALL be reachable from at least one fixed version-controlled entry point via an explicit cross-reference.

### Requirement 3: Documented parity contract mapping each v4 node to its App vs Skill enforcement model

**User Story:** As a maintainer of either track, I want a written contract mapping each enforcement-relevant v4 Diagram node to the enforcement model it uses in the App vs the Skill and why, so that the two implementations can be compared node-by-node and intentional divergences are distinguished from drift.

#### Acceptance Criteria

1. THE Parity_Contract SHALL enumerate each enforcement-relevant node of the v4 Diagram (including the checks ledger, content-quality check, companion critic/grounding, traceability matrix, and preview/output audit nodes).
2. FOR each enumerated node, THE Parity_Contract SHALL record the enforcement model used by the App and the enforcement model used by the Skill.
3. FOR each enumerated node whose App and Skill enforcement models differ, THE Parity_Contract SHALL record the reason for the divergence.
4. THE Parity_Contract SHALL identify, for each enumerated node, the App artifact (env flag, route, or component) and the Skill artifact (script) that implement that node's enforcement.
5. THE Parity_Contract SHALL record the Red Line as a property that holds across all enumerated nodes.

### Requirement 4: Automated parity-check guard test

**User Story:** As a maintainer, I want an automated test that fails when the App/Skill enforcement mapping drifts from the Parity_Contract or when the App begins asserting the Skill's hard-gate / agent-can't-touch guarantee, so that the intentional divergence and the Red Line are protected by CI rather than by memory.

#### Acceptance Criteria

1. WHEN the App/Skill node-to-enforcement-model mapping in the codebase diverges from the Parity_Contract, THE Parity_Guard_Test SHALL fail.
2. WHEN the App source or its trust-surface text asserts or implies the Skill's hard-gate or "agent-can't-touch" guarantee, THE Parity_Guard_Test SHALL fail.
3. WHILE the codebase enforcement mapping matches the Parity_Contract AND the App does not assert the Skill's guarantee, THE Parity_Guard_Test SHALL pass.
4. IF the Parity_Guard_Test fails, THEN THE Parity_Guard_Test SHALL report which node mapping drifted or which Red Line assertion was detected.
5. THE Parity_Guard_Test SHALL be executable within the repository's existing test runner.

## Out of Scope

The following are explicitly **not** addressed by this spec:

- **Deep GitHub ingestion / symbol & interface-contract extraction / grounding evidence-node citations.** This corresponds to verified-real gap #4 and is reserved for a separate future spec (Spec B).
- **Turning the 5 Trust Gates on.** They are already ON by default; this spec only fixes how their *default* is resolved (Requirement 1).
- **Building trust UI.** The `TrustSection` right-rail UI is already mounted.
- **Converting the App's advisory gates into blocking gates.** The advisory/non-blocking model is intentional and correct (Requirement 2); Requirement 1 explicitly must not change it.
