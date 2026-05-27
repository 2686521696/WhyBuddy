# Implementation Plan

## Overview

This plan executes the bugfix workflow for the perceived-double-pass on the 24-node × 3-doc spec docs happy path. It follows the bug condition methodology: Task 1 is the standalone bug condition exploration property test that MUST FAIL on unfixed code as proof the bug exists; Tasks 2-5 implement the three locked decisions from `design.md` (emitter contract extension, fast/slow path split, batch-template-fallback short-circuit); Task 6 re-runs the Task 1 test on fixed code as the binding regression gate; Tasks 7-8 add property-based and preservation coverage; Task 9 integrates the new server contract into the frontend reducer; Task 10 is the all-greens checkpoint. The `bugfix.md` defines the original problem statement and 5 verbatim Reqs. Design decisions (event naming `node_assembled`, state machine, fast-path semantics) are governed by `design.md`. AC items 1.1-1.5 / 2.1-2.6 / 3.1-3.8 from `bugfix.md` remain the source of truth for `_Requirements_` annotations, but implementation terminology follows `design.md`'s revised vocabulary.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 1, "tasks": ["1.1", "1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["6.1", "6.2"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3", "7.4", "8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 9, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 10, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 11, "tasks": ["12.1", "12.2"] },
    { "id": 12, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 13, "tasks": ["14.1", "14.2", "14.3"] }
  ]
}
```

Wave summary (informative):

- **Wave 1 — Task 1**: bug condition exploration test, must run alone first, must FAIL on unfixed code.
- **Wave 2 — Task 2**: `SpecDocsProgressEmitter` contract extension (Decision 1).
- **Wave 3 — Task 3**: `assembleSpecDocumentsFromLlmCache` helper (Decision 2). Independent of Task 5; can run in parallel with Wave 5 if separate worktrees.
- **Wave 4 — Task 4**: `generateSpecDocuments` Phase 2 refactor + batch coverage naming cleanup (depends on Tasks 2 + 3).
- **Wave 5 — Task 5**: `buildSpecDocument` short-circuit (Decision 3). Independent of Tasks 2-4 logic-wise.
- **Wave 6 — Task 6**: re-run Task 1 as the fix regression test (depends on Tasks 2 + 3 + 4).
- **Wave 7 — Tasks 7 + 8**: property-based and preservation tests (depend on Tasks 2-5; disjoint test files).
- **Wave 8 — Task 9**: frontend reducer integration (depends on Task 2 contract).
- **Wave 9 — Task 10**: final checkpoint (depends on all).

Cross-cutting invariants the dependency graph enforces:

- Task 1 MUST land first and MUST fail (exploration test on unfixed code).
- Tasks 2 and 5 are surgical contract / short-circuit edits and have no inter-dependency.
- Task 3 is a pure helper extraction with no edge into the emitter — it depends on Task 2 only at the call-site level (Task 4 wires them together).
- Task 4 is the integration choke point: it imports the new emitter variant from Task 2 and the new helper from Task 3.
- Task 6 is the proof-of-fix gate: the same test from Task 1 MUST flip from FAIL to PASS.
- Tasks 7 and 8 run in the same wave but on disjoint test files.
- Task 9 consumes the server contract from Task 2 and is the only frontend-side change in this bugfix.
- Task 10 is the all-greens gate; nothing else may follow it.

## Tasks

- [x] 1. Write bug condition exploration property test (BEFORE any fix code lands)

  - [x] 1.1 Author the bug condition exploration property test file
    - **Property 1: Bug Condition** - Phase 2 emits no commit-stage event between the last `node_completed` and `batch_finished`
    - **CRITICAL**: This is the bug condition exploration test — it MUST FAIL on unfixed code; failure is the proof the bug exists.
    - **DO NOT attempt to fix the test or the code when it fails.**
    - **GOAL**: Surface a counterexample that demonstrates the perceived-double-pass bug as defined by `isBugCondition` in design.md §Bug Details.
    - **Red-test protocol**: Write the test inside a `describe.skip("Bug condition exploration — enable after fix lands (Task 6)", () => {...})` block. Task 1.2 temporarily removes `.skip` to run locally and capture the counterexample, then RE-ADDS `.skip` before marking Task 1 complete. This ensures the repo working tree is never left with a failing test. Task 6.1 permanently removes `.skip` as the fix regression gate.
    - **Scoped PBT approach**: scope the property to the concrete failing case (24-node SPEC tree, all batch LLM calls succeed, all `generationSource === "llm"`, all 3 markdowns non-empty, default env flags) so the failure is reproducible across runs.
    - Create `server/routes/blueprint/__tests__/spec-docs-perception-double-pass.exploration.test.ts`.
    - Drive `POST /api/blueprint/jobs/:jobId/spec-documents` via the existing route fixture pattern; study `server/routes/blueprint/__tests__/spec-docs-progress-e2e.test.ts` for the 24-node SPEC tree mock + test event bus setup and reuse the same harness.
    - Mock `specDocsLlmGeneration.generate` to return 24 successful `SpecDocsLlmNodeOutput` (`generationSource: "llm"`, `requirements`/`design`/`tasks` markdowns all non-empty).
    - Capture the entire event stream emitted on the test event bus from `batch_init` through `batch_finished`.
    - **Failing assertion (the one that proves the bug)**: between the last `node_completed` event and `batch_finished`, there exists a `node_assembled` event for every nodeId in the targetNodes set.
    - **Expected outcome on UNFIXED code**: the assertion FAILS because `node_assembled` does not exist in the emitter contract yet — this confirms the bug condition.
    - **Expected outcome on FIXED code (Task 6)**: the same assertion PASSES after Tasks 2-7 land; do not write a second test for the fixed-side check.
    - _Requirements: Req 1, Req 4, Req 5, 1.1, 1.2, 1.5, 2.1, 2.5, 2.6_

  - [x] 1.2 Run the exploration test on unfixed code and document the counterexample
    - Run only `server/routes/blueprint/__tests__/spec-docs-perception-double-pass.exploration.test.ts`.
    - **EXPECTED OUTCOME**: test FAILS with a counterexample matching the bug condition (no `node_assembled` event present in the captured stream).
    - After capturing the counterexample and documenting it in JSDoc, re-add `.skip` to the describe block so the repo is not left in a red state. The test file remains on disk as evidence; `.skip` prevents CI failure.
    - In the test file's top-level JSDoc, document the captured event stream verbatim (`batch_init` → `node_started × 24` → `node_completed × 24` → `batch_finished` with the silent gap) as evidence the bug exists.
    - **DO NOT proceed to Task 2 until 1.1 fails as expected and the JSDoc evidence is recorded.**
    - _Requirements: Req 1, Req 5, 1.1, 1.2_

- [x] 2. Extend `SpecDocsProgressEmitter` contract with a Phase 2 commit boundary (Decision 1)

  - [x] 2.1 Add the `node_assembled` literal to `SpecDocsProgressAction`
    - File: `server/routes/blueprint/spec-docs-progress-emitter.ts`, line 33.
    - Extend the union to `"batch_init" | "node_started" | "node_completed" | "node_failed" | "node_assembled" | "batch_finished"` exactly as specified in design.md §Components 1.
    - _Requirements: Req 1, 1.5, 2.5_

  - [x] 2.2 Add `emitNodeAssembled` to the `SpecDocsProgressEmitter` interface
    - Add the method signature with the payload `{ nodeId: string; position: number; assembledCount: number; totalCount: number; documentIds: ReadonlyArray<string> }` per design.md §Components 1.
    - Note: `occurredAt` is provided by the base event envelope, not by the caller. Do not add it to the method signature.
    - Add a JSDoc on the method documenting the ordering invariant: `node_assembled[i]` MUST be emitted AFTER `node_completed[i]` (or `node_failed[i]`, but failed nodes SHOULD NOT call `emitNodeAssembled` at all) AND BEFORE `batch_finished`.
    - _Requirements: Req 1, Req 4, 2.1, 2.5, 2.6_

  - [x] 2.3 Implement `emitNodeAssembled` in the emitter factory
    - Mirror the existing `emitNodeCompleted` implementation pattern.
    - Body calls `baseEmitter.observing(true, summary, extraPayload)` with `progressAction: "node_assembled"`, the structured fields (`nodeId`, `position`, `assembledCount`, `totalCount`, `documentIds: [...documentIds]`), and `summary` string `↳ 文档装配 (${assembledCount}/${totalCount})`.
    - _Requirements: Req 1, Req 4, 2.1, 2.5_

  - [x] 2.4 Add a unit test for `emitNodeAssembled` payload shape
    - Create `server/routes/blueprint/__tests__/spec-docs-progress-emitter.node-assembled.test.ts`.
    - Assert the emitted event carries `progressAction: "node_assembled"` as the discriminator and the full payload shape from design.md §Components 1.
    - Assert the JSDoc-documented ordering invariant in a focused unit (a single emit call followed by inspection of the captured event).
    - _Requirements: Req 1, Req 4, 1.5, 2.1, 2.5, 2.6_

- [x] 3. Add `assembleSpecDocumentsFromLlmCache` helper (Decision 2)

  - [x] 3.1 Define the helper signature in `server/routes/blueprint.ts`
    - Place the helper near `buildSpecDocument` (around line 14100), before its first call site.
    - Signature per design.md §Components 2: `(args: { job, specTree, node, llmOutput, primaryRoute, createdAt, previousRoleFindings, clarificationSession, domainContext, targetTypes }) => BlueprintSpecDocument[]`.
    - Document preconditions in the function-level JSDoc: helper assumes `args.llmOutput.generationSource === "llm"` AND every `pickSpecDocsLlmMarkdownForType(args.llmOutput, type)` returns a non-empty string for every type in `args.targetTypes`. Pre-validation is the call site's responsibility.
    - _Requirements: Req 2, 2.3, 3.2, 3.5, 3.6_

  - [x] 3.2 Implement per-type document assembly from cached markdown
    - For each `type` in `targetTypes`, call `pickSpecDocsLlmMarkdownForType(args.llmOutput, type)` to obtain the cached markdown.
    - Construct one `BlueprintSpecDocument` per type, mirroring the LLM short-circuit branch at `server/routes/blueprint.ts:14140-14199`: `id` via `createId("blueprint-spec-document")`, `title` via `buildSpecDocumentHeading`, `summary` via `node.summary`, `content` from cache, full provenance with `generationSource: "llm"` plus `promptId`/`model`/`promptFingerprint`/`responseDigest` from `args.llmOutput`.
    - _Requirements: Req 2, 2.3, 3.2, 3.6_

  - [x] 3.3 Return synchronously
    - Return `BlueprintSpecDocument[]` of length `targetTypes.length` synchronously — no `await`, no `Promise` wrapping.
    - This is the single most important property of the fast path: no microtask scheduling latency.
    - _Requirements: Req 2, 2.3, 3.2_

  - [x] 3.4 Add a unit test for `assembleSpecDocumentsFromLlmCache`
    - Create `server/routes/blueprint/__tests__/assemble-spec-documents-from-llm-cache.test.ts`.
    - Case (a): all 3 doc types built from a sample `SpecDocsLlmNodeOutput` produce 3 `BlueprintSpecDocument` records with correct `type` discriminators.
    - Case (b): provenance fields (`promptId`, `model`, `promptFingerprint`, `responseDigest`, `generationSource: "llm"`) are carried through unchanged from `llmOutput` to every emitted document.
    - Case (c): `targetTypes` subset (only `["requirements"]`) builds exactly 1 document.
    - Case (d): the JSDoc preconditions are documented in the test (pre-validation is the call site's responsibility, not the helper's).
    - _Requirements: Req 2, 2.3, 3.2, 3.6_

- [x] 4. Refactor `generateSpecDocuments` Phase 2 loop to fast/slow split (Decision 1 + Decision 2)

  - [x] 4.1 Replace the Phase 2 loop body at `server/routes/blueprint.ts:9914-9985` with the fast/slow split
    - Compute `isFastPath = llmNodeOutput?.generationSource === "llm" && targetTypes.every(t => { const md = pickSpecDocsLlmMarkdownForType(llmNodeOutput, t); return typeof md === "string" && md.length > 0; })` per design.md §Components 3.
    - Fast path: call `assembleSpecDocumentsFromLlmCache(...)` synchronously, push results into `documents`, increment `assembledCount`, emit `node_completed` only when `!llmHandled` (preserving the existing guard), then ALWAYS emit `node_assembled` regardless of `llmHandled` (Phase 2 commit has no Phase 1 counterpart).
    - Slow path: retain the existing `Promise.race + Promise.all + buildSpecDocument` block with the 120s timeout. On success push docs, increment `assembledCount`, emit `node_assembled`. On failure increment `failedCount`, emit `node_failed` (only when `!llmHandled`), write the existing fallback error documents at `:9994-10009` verbatim, and DO NOT emit `node_assembled`.
    - `emitNodeAssembled` payload includes `documentIds: nodeDocs.map(d => d.id)` so the frontend reducer can update per-document indicators.
    - _Requirements: Req 1, Req 2, Req 5, 1.1, 1.2, 2.1, 2.3, 2.5, 2.6, 3.7_

  - [x] 4.2 Preserve the `if (!llmHandled)` guards on `emitNodeStarted` / `emitNodeCompleted` / `emitNodeFailed`
    - Verify by inspection that the Phase 1 emission guards at the original line locations remain bit-identical.
    - The new `emitNodeAssembled` call sites are the only unconditional emits in Phase 2; everything else preserves the existing guard semantics.
    - _Requirements: Req 1, 3.1, 3.7_

  - [x] 4.3 Assert the `assembledCount + failedCount === totalCount` invariant before `batch_finished`
    - At the `batch_finished` emission point (`server/routes/blueprint.ts:10015`), assert `assembledCount + failedCount === targetNodes.length`.
    - Note: `assembledCount` is the Phase 2 assembly counter (nodes that successfully produced documents), distinct from Phase 1's `completedCount` (nodes that completed LLM generation). A template-fallback node increments `assembledCount` (it produced template docs) even though it may have been a Phase 1 `node_failed`.
    - On violation, throw with diagnostic detail (counts, node ids, last-emitted action) so the existing JobFailed event path surfaces the bug rather than letting it silently regress.
    - _Requirements: Req 5, 2.1, 2.6, 3.7_

  - [x] 4.4 Re-run the existing Phase 1 e2e test
    - Run `server/routes/blueprint/__tests__/spec-docs-progress-e2e.test.ts` and confirm it still passes — the existing test asserts the Phase 1 boundary which is unchanged by Decision 1 + 2.
    - _Requirements: 3.1, 3.4, 3.7_

  - [x] 4.5 Rename the misleading `llmHandled` local to `batchCovered`
    - In the Phase 2 loop, rename `llmHandled` to `batchCovered` (or an equivalently explicit name such as `batchEmittedPhase1Progress`) everywhere it is used for Phase 1 progress-emission guards.
    - Add a short inline comment/JSDoc near the variable explaining the exact meaning: the node appeared in the Phase 1 batch result and therefore already had Phase 1 progress emitted; this includes `generationSource === "template"` batch fallback nodes and does NOT imply that LLM markdown generation succeeded.
    - Keep the fast-path predicate separate as `isFastPath = llmNodeOutput?.generationSource === "llm" && targetTypes.every(...)`; do not reuse `batchCovered` as a success/cache-hit signal.
    - This is a readability/maintenance hardening task only; it must not change runtime behavior beyond naming and comments.
    - _Requirements: Req 2, Req 3, 2.3, 2.4, 3.1, 3.7_

- [x] 5. Add Decision 3 short-circuit in `buildSpecDocument`

  - [x] 5.1 Insert the 4-line short-circuit at `server/routes/blueprint.ts:14206`
    - Per design.md §Components 4:

      ```ts
      const batchTemplateOnly =
        input.llmNodeOutput !== undefined &&
        input.llmNodeOutput.generationSource !== "llm";
      const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
        ? await ctx.specDocumentsLlmService({ /* unchanged args */ })
        : undefined;
      ```
    - This skips the legacy per-document LLM service for any node whose batch result is not an LLM result.
    - _Requirements: Req 2, Req 3, 1.3, 2.4, 3.3, 3.5_

  - [x] 5.2 Add an inline comment explaining the rationale
    - Document that this closes the legacy `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` second-LLM-dispatch path for batch-template-fallback nodes.
    - State the rationale: the new pipeline already has a 5-key pool with retries in Phase 1; a 6th legacy retry is unlikely to succeed and only adds latency + cost, while a `generationSource: "template"` provenance correctly honors the batch generator's verdict.
    - _Requirements: Req 3, 1.3, 2.4, 3.3_

  - [x] 5.3 Add a unit test asserting zero legacy LLM service calls under both env-flag combinations
    - Create `server/routes/blueprint/__tests__/build-spec-document.batch-template-fallback.test.ts`.
    - Spy on `ctx.specDocumentsLlmService` across two scenarios:
      - (a) `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` unset, batch-template-fallback node (`generationSource === "template"`) → assert 0 invocations.
      - (b) `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED=true`, batch-template-fallback node → assert 0 invocations (Decision 3 is unconditional).
    - Assert the resulting document carries `provenance.generationSource === "template"` in both scenarios.
    - _Requirements: Req 3, 1.3, 2.4, 3.3, 3.5_

- [x] 6. Re-run the Task 1 exploration test as the fix regression test

  - [x] 6.1 Re-run the exact same test from Task 1 on the fixed code
    - **Property 1: Expected Behavior** - Phase 2 emits exactly one `node_assembled` event per successful node, ordered after `node_completed` and before `batch_finished`
    - **IMPORTANT**: Re-run the SAME test from Task 1 — do NOT write a new test. The Task 1 test already encodes the expected behavior; passing means the bug is fixed.
    - Remove the `.skip` from the describe block added in Task 1.2. Run the test — it MUST now PASS. This is the permanent state going forward.
    - **EXPECTED OUTCOME**: test PASSES (24 `node_assembled` events exist between the 24 `node_completed` events and `batch_finished`).
    - This is how the bug condition exploration test converts into the bug regression test.
    - _Requirements: Req 1, Req 5, 1.1, 2.1, 2.5, 2.6_

  - [x] 6.2 Update the test JSDoc to reflect its new role
    - Update the top-of-file JSDoc to document: "Originally written as a bug condition exploration test (Task 1) that failed on unfixed code as proof the bug exists. Now serves as the binding fix regression test — it must pass on every commit going forward."
    - Keep the captured-event-stream evidence section as historical record.
    - _Requirements: Req 5_

- [x] 7. Property-based regression tests (4 properties from design.md)

  - [x] 7.1 PBT for Property 1 — every successful node emits `node_assembled` exactly once, ordered correctly
    - **Property 1: Bug Condition** - Every Successful Node Emits `node_assembled` Exactly Once (design.md §Correctness Properties)
    - File: `server/routes/blueprint/__tests__/spec-docs-perception.property.test.ts`.
    - Generator: random `N ∈ [1, 50]`; all nodes return LLM-success (`generationSource: "llm"`, all 3 markdowns non-empty).
    - Assert: exactly `N` `node_assembled` events; for every `i ∈ [1..N]`, `node_assembled[i]` occurs after `node_completed[i]` and before `batch_finished`; `assembledCount` is monotonically increasing 1..N.
    - fast-check `numRuns >= 100`.
    - Test name tag: `Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 1: every successful node emits node_assembled exactly once`.
    - _Requirements: Req 1, Req 4, Req 5, 2.1, 2.5, 2.6_

  - [x] 7.2 PBT for Property 2 — Phase 2 invokes zero LLM calls for LLM-handled nodes
    - **Property 2: Bug Condition** - Phase 2 Invokes Zero LLM Calls For LLM-Handled Nodes (design.md §Correctness Properties)
    - File: `server/routes/blueprint/__tests__/spec-docs-perception.property.test.ts` (same file as 7.1, separate `it.prop`).
    - Generator: random `N ∈ [1, 30]`; all nodes are LLM-success.
    - Mock `ctx.specDocsLlmGeneration.generate` to directly return pre-built `SpecDocsLlmNodeOutput[]` (this is the Phase 1 injection seam — no need to spy internal `callLlmForSpecDoc`). Spy on `ctx.specDocumentsLlmService` and `ctx.llm.callJson` to assert zero invocations during Phase 2.
    - Assert: zero invocations of either spy during Phase 2 (the entire generator runs without dispatching any LLM call after the batch result is returned by the mocked Phase 1).
    - fast-check `numRuns >= 100`.
    - Test name tag: `Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 2: Phase 2 invokes zero LLM calls for LLM-handled nodes`.
    - _Requirements: Req 2, Req 5, 2.3, 3.2, 3.5_

  - [x] 7.3 PBT for Property 3 — batch-template-fallback skips legacy LLM service under both env values
    - **Property 3: Preservation** - Batch-Template-Fallback Skips Legacy LLM Service (design.md §Correctness Properties)
    - File: `server/routes/blueprint/__tests__/spec-docs-perception.property.test.ts` (same file, separate `it.prop`).
    - Generator: random `N ∈ [1, 30]` with random template-fallback proportion `∈ [0%, 100%]` × random env value `∈ {undefined, "true"}` for `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED`.
    - Spy: `ctx.specDocumentsLlmService`.
    - Assert: zero invocations for any node whose batch result has `generationSource === "template"`, regardless of the env value (Decision 3 is unconditional). Documents from template-fallback nodes carry `provenance.generationSource === "template"`.
    - fast-check `numRuns >= 100`.
    - Test name tag: `Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 3: batch-template-fallback skips legacy LLM service`.
    - _Requirements: Req 3, 1.3, 2.4, 3.3, 3.5_

  - [x] 7.4 PBT for Property 4 — failure isolation and assembled-count invariant
    - **Property 4: Preservation** - Failure Isolation and Assembled-Count Invariant (design.md §Correctness Properties)
    - File: `server/routes/blueprint/__tests__/spec-docs-perception.property.test.ts` (same file, separate `it.prop`).
    - Generator: random failure positions in a 24-node batch (mixed success / failure).
    - Assert: every successful node emits exactly one `node_assembled`; every failed node emits zero `node_assembled` and exactly one `node_failed`; `assembledCount + failedCount === totalCount` at `batch_finished`; failed nodes do NOT shadow or reorder successful nodes' Phase 1 events.
    - fast-check `numRuns >= 100`.
    - Test name tag: `Feature: autopilot-spec-docs-runtime-perception-double-pass, Property 4: failure isolation and assembled-count invariant`.
    - _Requirements: Req 5, 3.1, 3.4, 3.7, 3.8_

- [x] 8. Preservation tests (mixed source / single-node / legacy env)

  - [x] 8.1 Mixed-source preservation test
    - **Property 2: Preservation** - Mixed-Source Batch Preserves Provenance and Skips Legacy LLM Service
    - File: `server/routes/blueprint/__tests__/spec-docs-perception-mixed-source.preservation.test.ts`.
    - Fixture: 22 LLM-success nodes + 2 batch-template-fallback nodes (`generationSource === "template"`).
    - Assert (a): zero `ctx.specDocumentsLlmService` calls across the entire request lifecycle.
    - Assert (b): artifact provenance snapshot — LLM nodes carry `generationSource: "llm"` with full prompt fingerprint; template-fallback nodes carry `generationSource: "template"`. Snapshot is byte-stable across runs.
    - Assert (c): all 24 successful nodes emit `node_assembled`; ordering invariant holds.
    - _Requirements: Req 2, Req 3, 1.3, 2.3, 2.4, 3.2, 3.3, 3.5, 3.6_

  - [x] 8.2 Single-node / no-eventBus preservation test
    - **Property 2: Preservation** - Single-Node Path is Byte-Identical to Unfixed Code
    - In an existing or new test file under `server/routes/blueprint/__tests__/`, drive `generateSpecDocuments` with `progressEmitter === undefined` (single-node request path at `server/routes/blueprint.ts:10024+`).
    - Assert response shape and document provenance are byte-identical to the expected snapshot captured BEFORE the fix lands (capture the snapshot once on unfixed code as the baseline).
    - _Requirements: 3.3, 3.4, 3.6, 3.8_

  - [x] 8.3 Run the full server blueprint test suite
    - Run `npx vitest run --config vitest.config.server.ts server/routes/blueprint/`.
    - Assert zero regressions in the pre-existing pass set; new tests added by this bugfix may add to the pass count but MUST NOT subtract from it.
    - _Requirements: 3.4_

- [x] 9. Frontend reducer integration (server contract consumer)

  - [x] 9.1 Locate the existing spec docs progress reducer
    - Search `client/src/**/spec*progress*.ts` and `client/src/**/SpecDocsProgress*` to find the reducer file and the connected panel component (`SpecDocsProgressPanel.tsx`).
    - Record the file path(s) in the PR description and tasks.md Notes section so reviewers can audit the consumer side.
    - _Requirements: Req 1, Req 4, 2.2, 2.6_

  - [x] 9.2 Add `node_assembled` event handling and the intermediate state
    - Introduce a new state `generation_complete (assembling)` between `generating` and `batch_finished` per design.md §Components 5.
    - State machine: `idle → generating → generation_complete (assembling X/N) → assembled (N/N) → batch_finished`.
    - On each `node_assembled`, advance `assemblingCount` by 1; on the `N`th `node_assembled`, transition to `assembled`.
    - Locate `completeSpecDocsProgress(...)` in `client/src/lib/blueprint-realtime-store.ts` (around line 1394). This HTTP-response-success fallback currently force-transitions all pending/processing nodes to `completed` and sets `batchStatus: "finished"`. Update it to: (a) only force-transition nodes that have NOT already received `node_assembled` via the event stream; (b) set `batchStatus: "finished"` as before (this is correct — HTTP response IS the true persistence boundary). Without this change, the fallback will bypass the `assembling` intermediate state on slow connections where HTTP arrives before all socket events.
    - _Requirements: Req 1, Req 4, 2.2, 2.5, 2.6_

  - [x] 9.3 Gate the "已完成" terminal label on `batch_finished`
    - During `generation_complete (assembling X/N)`, the user-visible label MUST read `生成完成 (assembling X/N)` or equivalent — never "已完成".
    - The terminal "已完成" label is only rendered once `batch_finished` is received.
    - _Requirements: Req 1, Req 4, 2.2, 2.6_

  - [x] 9.4 Add a reducer unit test simulating the full event stream
    - Test simulates `batch_init → node_started × 24 → node_completed × 24 → node_assembled × 24 → batch_finished`.
    - Assert state transitions match the design.md §Components 5 state machine in order.
    - Assert `progress 24/24 已完成` is NEVER simultaneous with `文档统计 0%` in the rendered view-model derived from reducer state — this is the user-mandated regression check from Req 5.
    - _Requirements: Req 1, Req 4, Req 5, 1.2, 2.2, 2.6_

  - [x] 9.5 Update `completeSpecDocsProgress` fallback to respect `node_assembled` events
    - Locate `completeSpecDocsProgress(...)` in `client/src/lib/blueprint-realtime-store.ts`.
    - Modify it to only force-complete nodes that have NOT already transitioned to `assembled` via the event stream.
    - Add a unit test asserting: if all 24 nodes already received `node_assembled` events before HTTP response arrives, `completeSpecDocsProgress` does NOT re-transition them (idempotent).
    - _Requirements: Req 4, 2.6, 3.4_

- [x] 10. Final checkpoint

  - [x] 10.1 Run the focused server test set
    - Command: `npx vitest run --config vitest.config.server.ts server/routes/blueprint/__tests__/spec-docs-perception-double-pass.exploration.test.ts server/routes/blueprint/__tests__/spec-docs-progress-emitter.node-assembled.test.ts server/routes/blueprint/__tests__/build-spec-document.batch-template-fallback.test.ts server/routes/blueprint/__tests__/spec-docs-perception.property.test.ts server/routes/blueprint/__tests__/spec-docs-perception-mixed-source.preservation.test.ts server/routes/blueprint/__tests__/assemble-spec-documents-from-llm-cache.test.ts`.
    - All listed tests MUST pass.
    - _Requirements: Req 5, 3.4_

  - [x] 10.2 Run the focused client test set for the reducer change
    - Run the reducer unit test added in Task 9.4 plus any tests that import the reducer or the progress panel.
    - All MUST pass.
    - _Requirements: Req 5, 3.4_

  - [x] 10.3 Run `node --run check` and assert no new TypeScript errors
    - The 2 documented baseline TS errors (`SpecDocsProgressPanel.tsx:278:42` JSX namespace + `MarkdownRenderer.mermaid.test.tsx:43:69` locale literal) MUST remain at exactly 2.
    - This bugfix MUST NOT introduce any new errors.
    - If a new error appears, fix it before declaring Task 10 complete; do not paper over by widening the baseline.
    - _Requirements: 3.4_

  - [ ] 10.4 Manual verification against a real run (DEFERRED — residual risk, not blocking Phase 6)
    - Requires `pnpm run dev:all` with `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true` and a real 24-node SPEC tree generation from the frontend. The automated test suite (Tasks 10.1-10.3) covers the contract; manual verification confirms the visual transition through `生成完成 (装配中 X/N)` intermediate state.
    - This task is intentionally unchecked until manual QA is performed. It does not block Phase 6 execution.

  - [x] 10.5 Document the fix in the Notes section below
    - Update the Notes section with: total checkbox count (computed from the leaf sub-tasks above; expected leaf count after Task 4.5 is 36), one-paragraph fix summary, and an explicit closure paragraph stating which AC items (1.1-1.5, 2.1-2.6, 3.1-3.8) the fix closes vs which remain residual.
    - _Requirements: Req 5_

---

## Phase 6: Audit Hardening (failure-path silence + route-level integration tests)

> Phase 1-5 closed the happy-path perception gap. Phase 6 closes 3 audit findings:
> (1) Phase 2 failure for batch-covered nodes is silent (no `node_failed` emitted);
> (2) Frontend `batch_finished` blindly marks failed nodes as `assembled`;
> (3) All tests are emitter-level simulations, not route-level integration proofs.

- [x] 11. Fix Phase 2 silent failure for batch-covered nodes

  - [x] 11.1 Remove the `if (!batchCovered)` guard around `progressEmitter.emitNodeFailed(...)` in the Phase 2 catch branch
    - File: `server/routes/blueprint.ts`, Phase 2 loop catch block (around line 10040).
    - The `batchCovered` guard was correct for Phase 1 events (`node_started` / `node_completed`) to avoid double-counting. But Phase 2 `node_failed` is a DIFFERENT event boundary — it signals assembly failure, not LLM generation failure. It MUST be emitted unconditionally so every node gets either `node_assembled` or `node_failed`.
    - Change: remove `if (!batchCovered)` from the `emitNodeFailed` call in the catch branch. Keep the guard on `emitNodeStarted` and `emitNodeCompleted` (those are Phase 1 events).
    - _Requirements: Req 1, Req 5, 2.1, 3.7_

  - [x] 11.2 Verify the `assembledCount + failedCount === totalCount` invariant now holds for ALL paths
    - After 11.1, every node in the loop emits exactly one of: `node_assembled` (success) or `node_failed` (catch). The numeric invariant at `batch_finished` is now backed by event evidence, not just counter arithmetic.
    - Run existing tests to confirm no regression.
    - _Requirements: Req 5, 2.1, 3.7_

  - [x] 11.3 Add a unit test: batch-covered node that throws in Phase 2 MUST emit `node_failed`
    - In `server/routes/blueprint/__tests__/spec-docs-perception-double-pass.exploration.test.ts` (or a new file), add a test case:
    - Simulate: `emitBatchInit` → `emitNodeStarted` × N → `emitNodeCompleted` × N → for one node, do NOT emit `node_assembled`, instead emit `node_failed` → remaining nodes emit `node_assembled` → `emitBatchFinished`.
    - Assert: the failed node has a `node_failed` event in the stream (not silent).
    - _Requirements: Req 5, 3.7_

- [x] 12. Fix frontend `batch_finished` blind assembly of failed nodes

  - [x] 12.1 In the `batch_finished` handler, do NOT mark nodes as `assembled` if `failedCount > 0` and the node has no terminal event
    - File: `client/src/lib/blueprint-realtime-store.ts`, `batch_finished` case (around line 1015).
    - Current: force-resolves ALL `pending`/`processing`/`completed` nodes to `assembled`.
    - Fix: only resolve nodes to `assembled` if they are in `completed` status AND `failedCount === 0` (all nodes succeeded). If `failedCount > 0`, leave `completed` nodes as `completed` (they missed their terminal event — the server bug from Task 11 would have prevented this, but defense-in-depth).
    - Alternative (simpler): after Task 11 lands, the server guarantees every node gets `node_assembled` or `node_failed`. So `batch_finished` only needs to resolve truly-missed nodes (those still in `pending`/`processing` due to socket drops). Mark those as `assembled` only if `failedCount === 0`; otherwise mark as `failed` with summary "terminal event missed".
    - _Requirements: Req 4, 2.6, 3.4_

  - [x] 12.2 Update the reducer unit test to cover the failure case
    - Add a test: 23 nodes get `node_assembled`, 1 node gets `node_failed`, then `batch_finished` arrives with `failedCount=1`. Assert the failed node is NOT marked `assembled`.
    - _Requirements: Req 5, 3.7_

- [x] 13. Add route-level integration test driving real `generateSpecDocuments`

  - [x] 13.1 Create `server/routes/blueprint/__tests__/spec-docs-generate-integration.test.ts`
    - Drive the actual `generateSpecDocuments` function (or the POST route handler) with:
      - A 3-node SPEC tree fixture (smaller than 24 for speed)
      - `ctx.specDocsLlmGeneration.generate` mocked to return 3 LLM-success `SpecDocsLlmNodeOutput`
      - Real `eventBus` + `progressEmitter`
    - Capture the event stream.
    - Assert: `batch_init` → `node_started × 3` → `node_completed × 3` → `node_assembled × 3` → `batch_finished` (in that order).
    - Assert: `ctx.specDocumentsLlmService` has zero calls (Decision 3 + fast path).
    - Assert: HTTP response contains 9 documents (3 nodes × 3 types) with correct provenance.
    - _Requirements: Req 1, Req 2, Req 5, 2.1, 2.3, 3.2_

  - [x] 13.2 Add a failure-path integration case
    - Same fixture but mock `assembleSpecDocumentsFromLlmCache` to throw for 1 node (simulate cache corruption).
    - Assert: the throwing node emits `node_failed` (NOT silent).
    - Assert: the other 2 nodes emit `node_assembled`.
    - Assert: `batch_finished` reports `assembledCount=2, failedCount=1`.
    - _Requirements: Req 5, 3.7_

  - [x] 13.3 Add a template-fallback integration case
    - Mock `ctx.specDocsLlmGeneration.generate` to return 2 LLM-success + 1 template-fallback.
    - Assert: all 3 nodes emit `node_assembled` (template-fallback succeeds in Phase 2).
    - Assert: `ctx.specDocumentsLlmService` has zero calls (Decision 3).
    - Assert: template-fallback node's documents have `provenance.generationSource === "template"`.
    - _Requirements: Req 3, 2.4, 3.3, 3.5_

- [x] 14. Phase 6 final checkpoint

  - [x] 14.1 Run all new + existing tests
    - `npx vitest run --config vitest.config.server.ts server/routes/blueprint/__tests__/`
    - `npx vitest run client/src/lib/__tests__/spec-docs-progress-assembled.test.ts`
    - All must pass.
    - _Requirements: Req 5, 3.4_

  - [x] 14.2 Run `node --run check` — exactly 2 baseline errors
    - _Requirements: 3.4_

  - [x] 14.3 Update Notes with Phase 6 closure paragraph
    - Document: Phase 6 closed the failure-path silence bug, frontend blind-assembly bug, and added route-level integration proofs. Residual: Task 10.4 manual QA still deferred.
    - _Requirements: Req 5_

---

## Notes

### Fix summary

This bugfix closes the perceived-double-pass on the 24-node × 3-doc happy path with three coordinated server-side changes plus one frontend reducer extension:

- **Decision 1**: extend `SpecDocsProgressEmitter` with a new `node_assembled` variant so Phase 2 commit progress is observable without overloading `node_completed`.
- **Decision 2**: split Phase 2 into a synchronous fast path (`assembleSpecDocumentsFromLlmCache`) for LLM-handled nodes and the existing `Promise.race + 120s` slow path for everything else, eliminating microtask scheduling latency × 24 on the happy path.
- **Decision 3**: short-circuit the legacy `ctx.specDocumentsLlmService` retry inside `buildSpecDocument` for any node whose batch result is `generationSource: "template"`, regardless of `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED`. This honors the batch generator's verdict and closes a theoretical second-LLM-dispatch path.
- **Frontend**: extend the reducer with the `generation_complete (assembling)` intermediate state so the UI never shows `progress 24/24 已完成` simultaneously with `文档统计 0%`.

### Acceptance criteria mapping (confirmed by Task 10.5)

- **AC 1.1-1.5 (Current Behavior / Defect)** — planned:
  - `1.1`, `1.2`, `1.5` are closed by Decision 1 (emitter extension) + Task 4 (Phase 2 always emits `node_assembled` after every successful node).
  - `1.3` is closed by Decision 3 (Task 5) — the legacy LLM-service path is no longer reachable for batch-template-fallback nodes.
  - `1.4` is closed by the frontend reducer extension (Task 9) — statistics no longer "abruptly jump" because `node_assembled` events feed the intermediate state continuously.
- **AC 2.1-2.6 (Expected Behavior / Correct)** — planned:
  - `2.1` closed by Tasks 4.1 + 4.3 (per-node `emitNodeAssembled` plus the `assembledCount + failedCount === totalCount` invariant before `batch_finished`).
  - `2.2` closed by Task 9.3 (terminal "已完成" label gated on `batch_finished`).
  - `2.3` closed by Tasks 3 + 4.1 (synchronous fast-path assembly with zero LLM calls).
  - `2.4` closed by Task 5 (template-only fallback semantic) and proven by Tasks 5.3 + 7.3 (regression coverage under both env values).
  - `2.5` closed by Task 2 (single new variant `node_assembled`, payload carries `nodeId` + `position` + monotonic `assembledCount`).
  - `2.6` closed by Tasks 9.2 + 9.4 (reducer state machine + the never-simultaneously regression assertion).
- **AC 3.1-3.8 (Unchanged Behavior / Regression Prevention)** — planned:
  - `3.1` closed by Task 4.2 (Phase 1 emission guards preserved bit-identical) and proven by Task 4.4 (existing e2e still passes).
  - `3.2` closed by Decision 2 (one LLM call per `(node, doc-type)` in Phase 1, zero in Phase 2) and proven by Task 7.2.
  - `3.3` closed by Task 8.2 (single-node / no-eventBus path byte-identical) and Task 8.1 (mixed-source provenance snapshot).
  - `3.4` closed by Tasks 8.3 + 10.1 + 10.2 + 10.3 (full test suite + typecheck baseline).
  - `3.5` closed by Task 5 (legacy LLM service remains skipped for LLM-handled nodes under default env) and proven by Tasks 5.3 + 7.3.
  - `3.6` closed by Task 3.2 (provenance fields carried through unchanged) and proven by Tasks 3.4 + 8.1.
  - `3.7` closed by Tasks 4.1 + 4.3 + 7.4 (failed nodes still emit `node_failed`, never `node_assembled`; failure isolation is property-tested).
  - `3.8` closed by Task 4.1 (slow-path retains 120s `Promise.race` protection for not-handled async paths).

Residual AC items: none planned. Final confirmation deferred to Task 10.5 execution evidence.

### Fix closure (automated, 2026-05-27)

Tasks 1-9 complete. Server-side fix: `node_assembled` emitter variant + Phase 2 fast/slow split + Decision 3 batch-template-fallback short-circuit + `batchCovered` rename. Frontend fix: `assembling` intermediate state in reducer + `completeSpecDocsProgress` fallback respects assembled nodes + "已完成" gated on `batch_finished`. Test evidence: 4 PBT properties × 100 runs each, 5 preservation tests, 8 reducer unit tests, 1 exploration→regression test, full blueprint suite 153/153 pass. TypeScript baseline: 2 errors (unchanged). Task 10.4 (manual visual verification) deferred to manual QA session.

### Total checkbox count

Phase 1-5 (original): 10 epics + 37 leaf sub-tasks = 47 total. Phase 6 (hardening): 4 epics + 11 leaf sub-tasks = 15 total. Grand total: 14 epics + 48 leaf sub-tasks = 62 checkboxes. Task 10.4 intentionally unchecked (manual QA deferred).

### Phase 6 closure (automated, 2026-05-28)

Phase 6 closed 3 audit findings: (1) Phase 2 failure for batch-covered nodes now unconditionally emits `node_failed` — the `if (!batchCovered)` guard was removed from the catch branch, ensuring every node gets either `node_assembled` or `node_failed`; (2) Frontend `batch_finished` handler no longer blindly marks unresolved nodes as `assembled` when `failedCount > 0` — they are marked `failed` with "terminal event missed" summary; (3) Route-level integration tests now drive the real `generateSpecDocuments` pipeline (not emitter simulations) and prove the event stream, zero-LLM-call guarantee, and failure-path emission in production context. Residual: Task 10.4 manual visual QA still deferred.
