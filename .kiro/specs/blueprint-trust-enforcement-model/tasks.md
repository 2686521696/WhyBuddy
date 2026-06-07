# Implementation Plan: Blueprint Trust Enforcement Model

## Overview

This plan implements three compatibility-first additions to the existing blueprint trust loop,
with **no change to any gate's runtime semantics**:

1. A pure `Trust_Gate_Resolver` added alongside the existing bridge resolver in
   `server/routes/blueprint/runtime-enablement/resolver.ts`, plus a thin startup wiring hook in
   `server/index.ts` adjacent to the existing `resolveAllBridgeEnablement(process.env)` call.
   (Requirement 1.)
2. An `Enforcement_Model_Decision_Record` ADR markdown capturing the intentional App=advisory /
   Skill=hard-gate fork and a single canonical, verbatim Red Line string. (Requirement 2.)
3. A `Parity_Contract` (typed `const` + markdown) and an automated `Parity_Guard_Test` (Vitest) that
   fail on mapping drift or Red Line violation. (Requirements 3 and 4.)

Implementation language: **TypeScript** (matching the design and the existing resolver module).
The work reuses the proven `resolveBridgeEnablement` / `resolveAllBridgeEnablement` algorithm verbatim,
adds no new branch for Trust Gates, and never touches the advisory/non-blocking nature of any gate.

## Tasks

- [x] 1. Implement the pure Trust Gate resolver core in `resolver.ts`
  - [x] 1.1 Add `TRUST_GATE_ENABLEMENT_KEYS`, resolver types, and `resolveTrustGateEnablement`
    - In `server/routes/blueprint/runtime-enablement/resolver.ts`, add the `TRUST_GATE_ENABLEMENT_KEYS`
      const (the 5 flags `BLUEPRINT_CHECKS_LEDGER_ENABLED`, `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED`,
      `BLUEPRINT_COMPANION_ENABLED`, `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED`,
      `BLUEPRINT_PREVIEW_AUDIT_ENABLED`), and the `TrustGateEnablementKey`, `ResolvedTrustGateValue`
      (`"true" | "false"`), and `ResolveTrustGateInput` types per design §C1 / Data Models
    - Implement `resolveTrustGateEnablement(input)` as a pure function (no `process.env` reads, no side
      effects) using the verbatim 4-step ladder: test hard-lock → explicit-wins (with whitespace trim)
      → master-switch (`=== "true"` case-sensitive) → default `"false"`
    - Collapse the bridge resolver's Step 3+4 into a single rule so the output is always within
      `{"true","false"}`; treat whitespace-only explicit values as "not set"
    - Add a module doc-comment cross-referencing the Enforcement_Model_Decision_Record (supports 2.7)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9_

  - [x]* 1.2 Write property tests for `resolveTrustGateEnablement` and the aggregate
    - Add a shared "env-value vocabulary" fast-check arbitrary mixing `"true"`, `"false"`, `""`,
      whitespace-only, `"TRUE"`, `"True"`, `"1"`, `"yes"`, `"on"`, random strings, and `undefined`
    - **Property 1: Resolution is total and well-typed** — **Validates: Requirements 1.1**
    - **Property 2: Explicit per-flag value wins (outside test build)** — **Validates: Requirements 1.2**
    - **Property 3: Master-switch default resolves true iff exactly "true"** — **Validates: Requirements 1.3, 1.4**
    - **Property 4: Test build-target hard-lock precedence** — **Validates: Requirements 1.5, 1.6**
    - Configure `numRuns: 100` minimum; tag each test
      `// Feature: blueprint-trust-enforcement-model, Property {n}: {property_text}`
    - Place in `server/routes/blueprint/runtime-enablement/trust-gate-resolver.property.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.3 Add `ResolvedTrustGates` type and `resolveAllTrustGateEnablement` aggregate with idempotent write-back
    - In the same `resolver.ts`, add the `ResolvedTrustGates` interface (`checksLedger`, `contentQuality`,
      `companion`, `traceabilityMatrix`, `previewAudit`) and `resolveAllTrustGateEnablement(env)` per design §C2
    - Resolve all 5 gates in one pass; write back `env[key] = resolved` only when `env[key] !== resolved`
      (idempotency); return the post-write-back aggregate view (mirror `readResolvedValue` coercion)
    - _Requirements: 1.1, 1.7_

  - [x]* 1.4 Write property test for `resolveAllTrustGateEnablement` idempotency
    - **Property 5: Idempotency and no further write-back** — assert two runs produce identical results
      and the env object after the second run is byte-for-byte equal to after the first — **Validates: Requirements 1.7**
    - Configure `numRuns: 100` minimum; tag with the property comment format
    - _Requirements: 1.7_

  - [x]* 1.5 Write example-based unit tests for resolver branches and the defaults-only structural guarantee
    - Concrete cases for each ladder branch (test opt-in `"true"`, test lock `"false"`, explicit-wins
      outside test, master-on default, non-canonical master → `"false"`) as readable precedence docs
    - Structural assertion (Requirement 1.9): the new resolver API exposes only pure resolution returning
      the `ResolvedTrustGateValue` union — no blocking/throwing API, confirming defaults-only resolution
    - Place alongside the existing bridge resolver tests in
      `server/routes/blueprint/runtime-enablement/resolver.test.ts`
    - _Requirements: 1.9_

- [x] 2. Wire the resolver into server startup (the latent-hazard fix)
  - [x] 2.1 Add and invoke the startup wiring hook adjacent to bridge enablement
    - Add a thin exported helper (e.g. `applyTrustGateDefaults()` or reuse `resolveAllTrustGateEnablement`)
      and call it once in `server/index.ts` immediately after the existing
      `resolveAllBridgeEnablement(process.env)` call (around the blueprint router mount), so resolved
      defaults are written before `buildBlueprintServiceContext` reads `process.env.BLUEPRINT_*_ENABLED`
    - Do not modify any gate service or the `=== "true"` checks in `context.ts` — they observe the new
      defaults unchanged
    - _Requirements: 1.3, 1.8, 1.9_

  - [x]* 2.2 Write startup-wiring and dev:all integration smoke tests
    - Startup smoke: with `AUTOPILOT_REAL_RUNTIME="true"`, `BUILD_TARGET` not `"test"`, and the 5 flags
      unset, invoke the hook and assert all 5 `process.env` flags become `"true"` before context build
    - **Property 6: dev:all defaults-to-true preservation** — for any operator env where each of the 5
      flags is unset or already `"true"`, master is `"true"`, and `BUILD_TARGET` not `"test"`, all 5
      resolve to `"true"` — **Validates: Requirements 1.8** (`numRuns: 100`, tagged)
    - dev:all parity smoke: assert applying the resolver to `resolveV4AlignmentGates()` output yields all-`"true"`
    - _Requirements: 1.3, 1.8_

- [x] 3. Checkpoint - resolver and wiring
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Author the Enforcement_Model_Decision_Record (ADR)
  - [x] 4.1 Create the ADR markdown with the canonical Red Line
    - Create `.kiro/specs/blueprint-trust-enforcement-model/enforcement-model-decision-record.md`
    - Decision: App = advisory/non-blocking; Skill = hard-gate; the fork is intentional; the App's
      advisory model is not a defect to be remediated (2.1)
    - App rationale (supervised cockpit) (2.2); Skill rationale (unattended agent host, enforcer outside
      agent control) (2.3)
    - State the Red Line (2.4) as a single canonical, verbatim line inside a uniquely delimited fenced
      block so the guard reads it unchanged as its literal pass/fail criterion (2.5). Canonical string:
      `The App must never claim or imply the Skill's "agent-can't-touch" guarantee.`
    - Commit as one version-controlled file (2.6)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 4.2 Add fixed cross-reference entry points to the ADR
    - Reference the ADR from the `resolver.ts` module doc-comment and from the Parity Contract document,
      providing the explicit version-controlled entry points (2.7)
    - _Requirements: 2.7_

  - [x]* 4.3 Write ADR content example tests
    - Assert the ADR file exists as a single committed document; contains the decision statement, both
      rationales, and the Red Line; contains exactly one canonical Red Line block; and is cross-referenced
      from a fixed entry point
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 5. Author the Parity Contract (machine-readable table + document)
  - [x] 5.1 Create the typed `ParityContract` const and the markdown contract
    - Create a typed `const` table (e.g. `server/routes/blueprint/runtime-enablement/parity-contract.ts`)
      with `EnforcementModel`, `ParityNode`, `ParityContract` types per design Data Models, plus a
      companion markdown document
    - Enumerate the 5 enforcement-relevant v4 nodes (checks ledger, content-quality, companion
      critic/grounding, traceability matrix, preview/output audit) (3.1)
    - For each node record `appModel`/`skillModel` (3.2), a non-empty `divergenceReason` for every
      diverging node (3.3), and the App artifact (env flag / route / component) + Skill artifact
      script path under `skills/whybuddy/whybuddy/scripts/**` (3.4)
    - Set `redLine` to the ADR's verbatim string asserted to hold across all nodes (3.5); link to the ADR
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 5.2 Write Parity Contract structure tests and Red Line property test
    - Structure tests: all 5 nodes enumerated; each has `appModel`, `skillModel`, `appArtifact`,
      `skillArtifact`; each diverging node has a non-empty `divergenceReason`; each referenced artifact
      resolves in the codebase
    - **Property 7: Parity Contract Red Line holds across all nodes** — no node's App-side description
      implies the "agent-can't-touch" guarantee, and the contract `redLine` equals the ADR canonical
      string verbatim — **Validates: Requirements 3.5, 2.5** (`numRuns: 100`, tagged)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Implement the Parity Guard Test
  - [x] 6.1 Implement the drift + Red Line detectors and the Vitest guard
    - Create the guard test (e.g. `server/routes/blueprint/runtime-enablement/parity-guard.test.ts`),
      runnable by the existing Vitest runner (4.5)
    - Mapping-drift check (4.1): for each contract node, assert the codebase reality matches — App env
      flag present in `TRUST_GATE_ENABLEMENT_KEYS`, route/component exists; Skill script file exists
      under `skills/whybuddy/whybuddy/scripts/**`
    - Red Line check (4.2): scan App trust-surface sources (the 5 gate services and the `right-rail`
      trust panel text incl. `TrustSection.tsx`) using a denylist derived from the ADR canonical concepts
    - Pass condition (4.3): mapping matches and no Red Line assertion found
    - Diagnostic reporting (4.4): on failure report the drifted node id or the matched file + phrase
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x]* 6.2 Write property test for the guard detectors
    - **Property 8: Parity Guard detects drift and Red Line violations and reports them** — the guard
      fails iff at least one node mapping differs or a Red Line assertion is present, and on failure the
      report names the drifted node id or the matched phrase — **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - `numRuns: 100` minimum; tagged with the property comment format
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. Final checkpoint - full suite
  - Ensure all tests pass (including the new Parity Guard Test under the existing runner), ask the user
    if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but the
  resolver and guard properties are the core correctness guarantees of this spec.
- Each task references specific requirement sub-clauses for traceability.
- Compatibility-first: the resolver mirrors the existing bridge resolver one-to-one, adds no new
  branch, and never changes gate semantics. No `mission`/`workflow`/`runtime` renames are introduced.
- The Red Line is enforced as data (one canonical string flowing ADR → Parity Contract → Guard Test),
  not by convention.
- Property tests use fast-check + Vitest with a minimum of 100 iterations and the required design
  property tag comments.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.1", "4.2", "4.3", "5.2"] },
    { "id": 4, "tasks": ["2.2", "6.1"] },
    { "id": 5, "tasks": ["6.2"] }
  ]
}
```
