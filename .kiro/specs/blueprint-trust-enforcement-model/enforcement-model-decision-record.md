# ADR: App=Advisory / Skill=Hard-Gate Enforcement Model

- **Status:** Accepted
- **Spec:** `blueprint-trust-enforcement-model`
- **Scope:** The WhyBuddy v4 closed-loop trust architecture, realized by two parallel tracks — the in-app TypeScript "blueprint" pipeline (Track A, "the App") and the portable Claude Skill under `skills/whybuddy/**` (Track B, "the Skill").

## Context

The v4 closed-loop diagram (`docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`) is implemented twice:

- **Track A — the App:** the blueprint pipeline mounted at `/api/blueprint`, the `shared/blueprint/**` contracts, and the autopilot right-rail `TrustSection` (`ChecksLedgerPanel` / `TraceabilityMatrixPanel` / `CompanionFindingsPanel`). It runs as a **supervised cockpit** — a human watches the right-rail in real time.
- **Track B — the Skill:** Python scripts with `gate.py` hard gates and a user-run `check_previews_real.py` audit. It runs in an **unattended agent host** where the agent itself may cheat.

A re-verified gap analysis between the v4 diagram and the codebase concluded that the two tracks enforce the same trust loop using **different enforcement models**, and that this difference is deliberate. This record captures that decision so the divergence is understood as intentional design rather than mistaken for an App defect to be "fixed."

## Decision

The two tracks intentionally use **different** enforcement models:

- **The App uses advisory / non-blocking enforcement.** Each of the five v4 trust gates records its findings to the checks ledger and surfaces them for human review. It **never auto-blocks** execution.
- **The Skill uses hard-gate enforcement.** `gate.py` wraps a check; a non-zero exit code blocks the step, and the user-run `check_previews_real.py` audit cannot be modified by the agent.

**This fork is intentional and correct.** The App's advisory model is **not a defect to be remediated**, and the App **must not** be aligned to the Skill's hard-gate model. App = "I show you, you decide" (a human is the gate). Skill = "I won't let it pass" (a hard gate the agent can't touch).

## Rationale

### App rationale — supervised cockpit (advisory / non-blocking)

The App runs as a supervised cockpit: a human watches the right-rail `TrustSection` in real time, and **that human is the gate**. Because a human is present to inspect every finding and make the call, the right behavior is to **record findings to the checks ledger and surface them for human review** rather than to auto-block. Auto-blocking inside a supervised, interactive cockpit would remove the human's authority and add no safety the human supervisor does not already provide. The App therefore stays advisory by design.

### Skill rationale — unattended agent host (hard-gate)

The Skill runs in an **unattended agent host** where no human is watching each step and **the agent itself may cheat** — for example, skipping the "actually render a preview" step or passing off placeholder output as real. Because the agent cannot be trusted to police itself, the enforcer must live **outside the agent's control**: `gate.py` records a tamper-evident ledger entry and a non-zero exit code hard-blocks the step, and the user-run `check_previews_real.py` audit is run by the user and cannot be modified by the agent. The Skill therefore uses hard gates by design.

## The Red Line

The single constraint that holds across every node of both tracks, and that the `Parity_Guard_Test` consumes **unchanged** as its literal pass/fail criterion, is the canonical string in the uniquely delimited block below. It is the single source of truth: the Parity Contract copies it verbatim, and the guard test reads it verbatim. Do not edit, paraphrase, reformat, or translate the line inside the block.

<!-- CANONICAL-RED-LINE:BEGIN — single source of truth; do not edit, paraphrase, or reformat the line inside this block -->
```canonical-red-line
The App must never claim or imply the Skill's "agent-can't-touch" guarantee.
```
<!-- CANONICAL-RED-LINE:END -->

The App may state that its gates are advisory and that a human supervisor is the gate. The App must never describe its own gates as a hard gate, as tamper-proof, or as a guarantee the agent cannot touch or bypass — that guarantee belongs to the Skill alone.

## Consequences

- The intentional advisory-vs-hard-gate fork is now a discoverable, checkable record rather than tribal memory.
- The canonical Red Line flows from this ADR → the `Parity_Contract` → the `Parity_Guard_Test`, so the constraint is enforced by CI rather than by convention.
- This record changes no runtime behavior. It does not turn any gate on or off, does not build trust UI, and does not convert any advisory App gate into a blocking gate.

## Cross-references

- Resolver module doc-comment: `server/routes/blueprint/runtime-enablement/resolver.ts` references this ADR.
- The `Parity_Contract` links to this ADR and copies the canonical Red Line verbatim.
