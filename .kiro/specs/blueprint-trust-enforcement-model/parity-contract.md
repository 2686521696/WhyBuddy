# Parity Contract — App vs Skill enforcement model

This is the human-readable half of the `Parity_Contract` for the
`blueprint-trust-enforcement-model` spec. The machine-readable half — the typed
`const` the `Parity_Guard_Test` imports — lives at
`server/routes/blueprint/runtime-enablement/parity-contract.ts`
(`PARITY_CONTRACT`).

It maps each enforcement-relevant node of the WhyBuddy v4 closed-loop diagram
(`docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`) to the enforcement
model it uses in the **App** (Track A) vs the **Skill** (Track B), records why
the two diverge, and names the concrete artifacts that implement each node's
enforcement. The two tracks can therefore be compared node-by-node, and
intentional divergence is distinguished from drift.

## The Red Line (holds across all nodes)

The single constraint below holds across **every** node in this contract
(Requirement 3.5). It is copied **verbatim** from the canonical source of truth —
the Enforcement_Model_Decision_Record (ADR),
[`enforcement-model-decision-record.md`](./enforcement-model-decision-record.md)
(`CANONICAL-RED-LINE` block). The `Parity_Guard_Test` reads this exact string as
its literal pass/fail criterion.

> The App must never claim or imply the Skill's "agent-can't-touch" guarantee.

The `PARITY_CONTRACT.redLine` field in `parity-contract.ts` holds this same
string verbatim; the guard test asserts the two are byte-for-byte equal.

## Enforcement model summary

- **App (Track A) — advisory / non-blocking.** A human supervisor watches the
  right-rail `TrustSection` in real time and is the gate. Every node records its
  findings to the checks ledger and surfaces them for human review; it never
  auto-blocks.
- **Skill (Track B) — hard-gate.** The Skill runs in an unattended agent host
  where the agent itself may cheat, so the enforcer lives outside the agent's
  control: a non-zero gate result blocks the step, and the user-run audit cannot
  be modified by the agent.

Every node below uses `appModel = advisory` and `skillModel = hard-gate`, so
every node carries a divergence reason rooted in the supervised-cockpit (App) vs
unattended-agent-host (Skill) distinction.

## Node mapping

| Node | `nodeId` | App model | Skill model | App artifact | Skill artifact |
| --- | --- | --- | --- | --- | --- |
| Checks ledger | `checks-ledger` | advisory | hard-gate | `BLUEPRINT_CHECKS_LEDGER_ENABLED` · `server/routes/blueprint/checks-ledger/service.ts` · `ChecksLedgerPanel.tsx` | `skills/whybuddy/whybuddy/scripts/gate.py` |
| Content-quality check | `content-quality` | advisory | hard-gate | `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED` · `server/routes/blueprint/content-quality/service.ts` | `skills/whybuddy/whybuddy/scripts/check_content_quality.py` |
| Companion critic/grounding | `companion` | advisory | hard-gate | `BLUEPRINT_COMPANION_ENABLED` · `server/routes/blueprint/companion/service.ts` · `CompanionFindingsPanel.tsx` | `skills/whybuddy/whybuddy/scripts/check_companion.py` |
| Traceability matrix | `traceability-matrix` | advisory | hard-gate | `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED` · `server/routes/blueprint/traceability-matrix/service.ts` · `TraceabilityMatrixPanel.tsx` | `skills/whybuddy/whybuddy/scripts/validate_spec_tree.py` |
| Preview/output audit | `preview-audit` | advisory | hard-gate | `BLUEPRINT_PREVIEW_AUDIT_ENABLED` · `server/routes/blueprint/preview-audit/service.ts` | `skills/whybuddy/whybuddy/scripts/check_previews_real.py` |

## Divergence reasons

- **Checks ledger.** App: a human supervisor watches the right-rail
  `ChecksLedgerPanel` in real time and is the gate, so the ledger records
  findings for review and never auto-blocks. Skill: runs unattended where the
  agent may cheat, so `gate.py` writes a tamper-evident ledger entry and a
  non-zero exit hard-blocks the step outside the agent's control.
- **Content-quality check.** App: the supervised cockpit records content-quality
  findings to the checks ledger and surfaces them for the human reviewer rather
  than blocking generation. Skill: the unattended host cannot trust the agent to
  self-police quality, so `check_content_quality.py` hard-fails the step when
  quality thresholds are not met.
- **Companion critic/grounding.** App: companion critic/grounding findings are
  advisory signals shown in the right-rail `CompanionFindingsPanel` for the human
  to weigh; they never auto-block. Skill: with no human watching,
  `check_companion.py` enforces grounding as a hard gate so the agent cannot pass
  off ungrounded output.
- **Traceability matrix.** App: the `TraceabilityMatrixPanel` surfaces coverage
  gaps to the human supervisor as advisory findings rather than halting the
  pipeline. Skill: `validate_spec_tree.py` runs unattended and hard-fails when
  the spec tree / traceability invariants break, because the agent cannot be
  trusted to enforce them on itself.
- **Preview/output audit.** App: preview/output audit findings are recorded and
  surfaced for the human supervisor, who decides whether to regenerate; the
  cockpit never auto-blocks. Skill: the user-run `check_previews_real.py` audit
  lives outside the agent's control so the agent cannot pass placeholder output
  off as a real rendered preview.

## Cross-references

- Enforcement_Model_Decision_Record (canonical Red Line source):
  [`enforcement-model-decision-record.md`](./enforcement-model-decision-record.md)
- Machine-readable contract:
  `server/routes/blueprint/runtime-enablement/parity-contract.ts`
- Trust Gate resolver:
  `server/routes/blueprint/runtime-enablement/resolver.ts`
