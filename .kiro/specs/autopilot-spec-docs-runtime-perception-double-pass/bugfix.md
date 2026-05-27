# Bugfix Requirements Document

## Introduction

### Bug Summary

When a user clicks `全部生成` on the SPEC tree (24 nodes × 3 doc types = 72 documents), the system is perceived as running TWICE: the progress bar reaches `24/24` and shows `已完成`, while the bottom statistics counter and SPEC tree document state stay at `0%` (counters `72/72`, `24/24`, `0%`, `24/0` coexist on screen because they read different truth sources). Then a long silent period follows. Finally the HTTP response arrives and statistics jump to completion. There is no real second LLM pass on the happy path; the perception is caused by **two completion boundaries with no UI distinction between them**.

### Verified Root Cause

`generateSpecDocuments` in `server/routes/blueprint.ts` has TWO sequential phases with DIFFERENT progress emission contracts:

- **Phase 1 — LLM batch generation** (`server/routes/blueprint.ts:9869` calls `specDocsLlmGeneration.generate(...)`): For each node, the batch generator (`server/routes/blueprint/spec-docs-llm-generation.ts:741-745`) concurrently calls `callLlmForSpecDoc` 3 times (requirements / design / tasks). Per-node `started / completed / failed` events fire through the `onNodeProgress` bridge in real time. This is what the user sees on the progress bar.
- **Phase 2 — Per-node assembly loop** (`server/routes/blueprint.ts:9914-9985`): Iterates `targetNodes`, wraps each node in `Promise.race([Promise.all(targetTypes.map(buildSpecDocument)), 120s timeout])` (i.e., 24 node-level races, each containing a 3-doc-type `Promise.all` — NOT 72 `Promise.race`). For each `(node, type)`, `buildSpecDocument` calls `pickSpecDocsLlmMarkdownForType` (line 14131), which short-circuits when `output.generationSource === "llm"` AND markdown is non-empty (line 14140). The `if (!llmHandled)` guard at line 9931, 9979 prevents per-node progress emission for nodes covered by the batch result — including `generationSource === "template"` fallback nodes where `llmHandled` is true but the cache miss falls through to the legacy `ctx.specDocumentsLlmService(...)` (line 14206).

Two completion boundaries:

- **Boundary A**: Phase 1 emits `node_completed` per-node ⇒ user sees `24/24 generated`.
- **Boundary B**: Phase 2 finishes assembly + artifact persistence (`server/routes/blueprint.ts:10084-10108`) and HTTP returns `extractSpecDocuments(updatedJob)` (`server/routes/blueprint.ts:10110-10114`) ⇒ statistics counter / document list become visible.
- Between A and B: silence. The user assumes the system is running again.

The existing emitter (`server/routes/blueprint/spec-docs-progress-emitter.ts:33`) only supports `batch_init | node_started | node_completed | node_failed | batch_finished`. There is no `node_assembled` event for Phase 2 commit progress. Reusing `node_completed` for Phase 2 would cause double-counting in the frontend reducer.

### Critical Correction to Common Misunderstanding

"No double LLM call" is NOT an unconditional fact. It is true ONLY when ALL of the following hold:

1. The node's batch result has `generationSource === "llm"`, AND
2. The cached markdown for that `(node, doc-type)` is non-empty, AND
3. `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` (legacy per-document env flag, separate from `BLUEPRINT_SPEC_DOCS_LLM_ENABLED`) is unset / false.

For batch-fallback nodes (`generationSource === "template"`), `pickSpecDocsLlmMarkdownForType` returns undefined and falls into `ctx.specDocumentsLlmService(...)`. If the legacy env is enabled, this is theoretically a second LLM dispatch. The bugfix MUST address this case explicitly.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type SpecDocsRunInput
    // X = {
    //   specTreeNodeCount        : N >= 1,
    //   batchLlmAllSucceeded     : true,
    //   nodeGenerationSourceLlm  : true for all nodes,
    //   markdownNonEmpty         : true for all (node, docType),
    //   envSpecDocsLlmEnabled    : true,
    //   envSpecDocumentsLlmEnabled : unset
    // }
  OUTPUT: boolean

  // The bug is observed in the happy path: every node's batch LLM
  // result is successful and complete, yet the frontend perceives
  // a "second pass" because Phase 2 emits no commit-stage event.
  RETURN X.batchLlmAllSucceeded
       AND (FOR ALL node IN X.specTreeNodes:
              node.generationSource = "llm"
              AND ALL 3 markdowns non-empty)
       AND (no Phase 2 commit-stage event exists in the emitter contract)
END FUNCTION
```

```pascal
// Property: Fix Checking — perceived double-pass elimination
FOR ALL X WHERE isBugCondition(X) DO
  events ← captureEventStream(POST /api/blueprint/jobs/:jobId/spec-documents, X)
  ASSERT events contains a "node_assembled" event
         for EVERY node, emitted AFTER node_completed
         AND BEFORE batch_finished
  ASSERT batch_finished is emitted AFTER all node_assembled events
  ASSERT no time interval (last node_completed, batch_finished)
         exists during which the frontend has zero events to consume
  ASSERT NO LLM service call (ctx.specDocumentsLlmService OR
         ctx.llm.callJson) is dispatched during Phase 2
         for any node where node.generationSource = "llm"
END FOR
```

```pascal
// Property: Preservation Checking — no regression on non-buggy paths
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
  // i.e., for all inputs that don't match the bug condition (failed
  // batch nodes, mixed generation sources, legacy env enabled, etc.),
  // the fixed pipeline F' produces identical observable behavior to
  // the original pipeline F: same response shape, same artifact
  // provenance, same Phase 1 event sequence, same test pass set.
END FOR
```

### Reproduction Conditions

- Endpoint: `POST /api/blueprint/jobs/:jobId/spec-documents`
- Fixture: SPEC tree with 24 nodes × 3 doc types = 72 documents
- All `callLlmForSpecDoc` calls mocked to return successful 3-doc markdown
- Env: `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true`, `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` unset
- Observed: chronological event stream is `batch_init` → `node_started × 24` → `node_completed × 24` → (silent gap during Phase 2 assembly + persist) → `batch_finished`
- Counterexample: the time gap between the last `node_completed` and `batch_finished` during which the frontend has no event to consume

### User-Mandated Requirements (verbatim, do not paraphrase)

The following 5 Reqs were stated verbatim by the user and are the source of truth for acceptance criteria below.

- **Req 1**: 批量 spec docs 的 progress UI 必须区分三个阶段："LLM generation complete"（Phase 1）、"documents assembled"（Phase 2 内存装配完成）、"batch_finished / response ready"（真正落库 + HTTP 响应）。
- **Req 2**: 对成功 batch LLM 输出，阶段 2 不得调用任何 LLM service。
- **Req 3**: 对 batch fallback 节点，行为必须显式：要么 template-only，要么允许旧 service retry，但测试必须覆盖。
- **Req 4**: HTTP response 完成前，前端不得把整个 spec docs 阶段展示为最终完成，只能展示 generation complete / committing / persisted 这种中间态。
- **Req 5**: 回归测试要证明 24 nodes × 3 docs 的成功 batch 路径不会出现第二轮 LLM 调用，也不会出现进度 24/24 但文档统计仍 0% 的误导状态。

### Preservation Scope

The fix MUST NOT alter:

- Phase 1 LLM batch generation contract in `server/routes/blueprint/spec-docs-llm-generation.ts` (Phase 1 is correct as-is).
- The `extractSpecDocuments(updatedJob)` HTTP response shape.
- Existing artifact provenance fields on `BlueprintSpecDocument`.
- The 5140+ existing-test pass set.
- Single-LLM-call semantics for the happy path under default env flags.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN a user POSTs `/api/blueprint/jobs/:jobId/spec-documents` for a 24-node SPEC tree AND all batch LLM calls succeed THEN the `SpecDocsProgressEmitter` emits `node_completed` for all 24 nodes during Phase 1 but emits no event during Phase 2 assembly and persistence, leaving the frontend with no signal between the last `node_completed` and `batch_finished`.

1.2 WHEN Phase 1 ends with `node_completed × 24` AND Phase 2 begins iterating 24 sequential `Promise.race(120s)` wrappers each containing a 3-document `Promise.all` THEN the frontend reads two desynchronized truth sources and simultaneously displays `progress 24/24 已完成` together with `文档统计 0%` and `SPEC tree state 24/0`, contradicting the user's mental model.

1.3 WHEN a node in the batch result has `generationSource === "template"` AND `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` is set THEN `buildSpecDocument` calls `pickSpecDocsLlmMarkdownForType` which returns `undefined`, and the code falls through to `ctx.specDocumentsLlmService(...)` at `server/routes/blueprint.ts:14206`, executing an unobserved second LLM dispatch path with no regression test coverage.

1.4 WHEN Phase 2 finishes assembly and artifact persistence at `server/routes/blueprint.ts:10084-10108` AND the HTTP response returns `extractSpecDocuments(updatedJob)` at `server/routes/blueprint.ts:10110-10114` THEN the frontend statistics counter abruptly jumps from `0%` to completion, reinforcing the user's perception that the system ran a second time.

1.5 WHEN the `SpecDocsProgressEmitter` event union (`server/routes/blueprint/spec-docs-progress-emitter.ts:33`) is consumed by the frontend reducer THEN there is no `node_assembled` event in the contract to express the Phase 2 commit stage, and reusing `node_completed` would cause double-counting in the reducer.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN a user POSTs `/api/blueprint/jobs/:jobId/spec-documents` for a 24-node SPEC tree AND all batch LLM calls succeed THEN the `SpecDocsProgressEmitter` SHALL emit a `node_assembled` event for every node during Phase 2 as that node's documents enter the documents array, AND `batch_finished` SHALL be emitted only after all `node_assembled` events have been emitted.

2.2 WHEN Phase 1 ends with `node_completed × 24` AND Phase 2 has not yet finished THEN the frontend SHALL display an intermediate state such as `生成完成 (committing)` or `生成完成 (persisting)` AND SHALL NOT display the spec docs phase as final-complete until `batch_finished` is received.

2.3 WHEN every node in the batch result has `generationSource === "llm"` AND all 3 markdowns are non-empty THEN Phase 2 SHALL synchronously construct the `BlueprintSpecDocument` objects from the cached markdown for those nodes AND SHALL NOT invoke any LLM service (neither `callLlmForSpecDoc` nor `ctx.specDocumentsLlmService`) during Phase 2 for those nodes; the 120-second `Promise.race` timeout protection SHALL be retained only for nodes that still require an async path (i.e., the not-handled fallback path).

2.4 WHEN a node has `generationSource === "template"` in the batch result THEN Phase 2 SHALL apply an explicitly chosen fallback semantic — recommended: template-only, with no legacy `ctx.specDocumentsLlmService` retry — AND a regression test SHALL prove that under both env-flag combinations (`BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true` with `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` unset OR set) no second LLM dispatch occurs for these nodes.

2.5 WHEN the `SpecDocsProgressEmitter` event union is extended THEN it SHALL include exactly one new event variant `node_assembled` (consistent across emitter, types, server, and frontend reducer) AND the event payload SHALL carry sufficient identity (at minimum `nodeId` and an ordering field) for the frontend reducer to update the per-node commit state without double-counting.

2.6 WHEN the frontend reducer consumes events for a successful 24-node × 3-doc batch THEN it SHALL transition through a sequence equivalent to `idle → generating (0..24/24) → generation_complete (assembling 0..24/24) → assembled (24/24) → batch_finished` AND SHALL never simultaneously expose `progress 24/24 已完成` together with `文档统计 0%`.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN Phase 1 batch LLM generation runs THEN the system SHALL CONTINUE TO emit `batch_init`, `node_started`, `node_completed`, and `node_failed` in real time through the `onNodeProgress` bridge in `server/routes/blueprint/spec-docs-llm-generation.ts:741-745`, with the same payload shape and ordering guarantees.

3.2 WHEN any `(node, doc-type)` has `generationSource === "llm"` and non-empty markdown in the batch result AND default env flags apply (`BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true`, `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` unset) THEN the system SHALL CONTINUE TO produce exactly one LLM call per `(node, doc-type)` and SHALL NOT introduce any additional LLM dispatch.

3.3 WHEN the spec docs HTTP response is returned THEN the system SHALL CONTINUE TO return the same `extractSpecDocuments(updatedJob)` shape and the same artifact provenance fields on `BlueprintSpecDocument`, with no change to existing API consumers.

3.4 WHEN the existing server, client, and integration test suites run THEN every test that passes today SHALL CONTINUE TO pass; the bugfix SHALL NOT regress the established test baseline.

3.5 WHEN `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=true` and `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` is unset THEN the system SHALL CONTINUE TO route all LLM-handled nodes through the new batch pipeline and SHALL NOT invoke the legacy per-document `ctx.specDocumentsLlmService` for those nodes.

3.6 WHEN any node in the batch result has `generationSource === "llm"` and complete markdown THEN the artifact persistence at `server/routes/blueprint.ts:10084-10108` SHALL CONTINUE TO write the same provenance, hashes, and timestamps for the document set as before the fix.

3.7 WHEN Phase 1 fails for a node (`node_failed`) THEN the system SHALL CONTINUE TO surface that failure on the existing event contract without being shadowed or reordered by the new `node_assembled` event.

3.8 WHEN a fallback path is required (mixed `generationSource === "template"` nodes, or batch generator unavailable) THEN the existing `Promise.race([Promise.all(...), 120s timeout])` protection SHALL CONTINUE TO apply for the not-handled async path so that a stuck node cannot block the whole request.
