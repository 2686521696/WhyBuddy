# Implementation Plan: Spec Docs Generation Progress Feedback

## Overview

This plan implements real-time per-node progress feedback for batch spec document generation. The implementation extends the existing `BlueprintEventBus` → `BlueprintSocketRelay` → `useBlueprintRealtimeStore` pipeline with a server-side `SpecDocsProgressEmitter` and a client-side `specDocsProgress` store slice + `SpecDocsProgressPanel` component.

Key integration decisions (from audit findings):
- **Integration point**: `generateSpecDocuments()` in `server/routes/blueprint.ts`, NOT inside `spec-docs-llm-generation.ts`. This ensures progress works for template-only, LLM-only, and mixed paths.
- **Batch vs single-node**: Determined by `request.nodeId == null` (batch) vs `request.nodeId != null` (single-node, no progress events).
- **Event emission**: Uses `StageProgressEmitter.observing()` with extended `extraPayload` parameter — no `as never` casts, no bypassing the typed event bus.
- **No-op strategy**: Caller-side `isBatchRequest && ctx?.eventBus ? create... : undefined` with optional chaining. Factory always requires valid eventBus.
- **Counter semantics**: `completedCount` = success only; `processedCount` = completed + failed; invariant at batch end: `completedCount + failedCount === totalCount`.

## Tasks

- [x] 1. Server-side emitter and types
  - [x] 1.1 Extend `StageProgressEmitter.observing()` to accept extra payload
    - Modify `server/routes/blueprint/stage-progress-emitter.ts`
    - Add optional third parameter `extraPayload?: Record<string, unknown>` to `observing()` method
    - Merge `extraPayload` into the event's `payload` field alongside existing `iteration`, `roleId`, `stageId`
    - Verify existing callers (intake, route_generation, spec_tree) continue to work unchanged (backward-compatible)
    - Update `StageProgressEmitter` interface to include the new optional parameter
    - _Requirements: 4.1, 4.4_

  - [x] 1.2 Create `SpecDocsProgressEmitter` module
    - Create `server/routes/blueprint/spec-docs-progress-emitter.ts`
    - Define `SpecDocsProgressAction` type union (`batch_init | node_started | node_completed | node_failed | batch_finished`)
    - Define `SpecDocsProgressEmitter` interface with 5 methods
    - Implement `createSpecDocsProgressEmitter(eventBus, jobId)` factory function (eventBus is required, NOT optional)
    - Delegate all event emission to `baseEmitter.observing(success, summary, extraPayload)` — no direct `eventBus.emit()` calls
    - Truncate `nodeTitle` to 200 chars and `errorSummary` to 400 chars
    - `emitNodeFailed` carries `processedCount` (not `completedCount`) to avoid confusion
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.4_

  - [x]* 1.3 Write property test: Emitter event payload correctness with truncation
    - **Property 1: Emitter event payload correctness with truncation**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
    - Create `server/routes/blueprint/__tests__/spec-docs-progress-emitter.property.test.ts`
    - Use `fc.string()` for titles/errors with arbitrary lengths, verify truncation bounds
    - Verify `payload.progressAction` matches the call type for all 5 methods
    - Verify all required fields present per action type
    - Verify `emitNodeFailed` payload contains `processedCount` field

  - [x]* 1.4 Write property test: Caller-side no-op via optional chaining
    - **Property 9: No-op when eventBus is absent (caller-side optional chaining)**
    - **Validates: Requirements 7.2**
    - Create test in `server/routes/blueprint/__tests__/spec-docs-progress-emitter.property.test.ts`
    - Verify that `undefined?.emitBatchInit(...)` etc. complete without throwing
    - Verify that `createSpecDocsProgressEmitter` is NOT called when eventBus is undefined
    - Test the conditional pattern: `ctx?.eventBus ? createSpecDocsProgressEmitter(...) : undefined`

  - [x]* 1.5 Write unit tests for emitter edge cases
    - Create `server/routes/blueprint/__tests__/spec-docs-progress-emitter.test.ts`
    - Test zero-node edge case: only `batch_finished` emitted with zeros (Req 1.6)
    - Test eventBus.emit throwing internally does not propagate (StageProgressEmitter already has try/catch)
    - Test that `observing()` is called with correct `extraPayload` structure for each action type
    - _Requirements: 1.6, 7.2_

- [x] 2. Batch generation loop integration
  - [x] 2.1 Integrate emitter into `generateSpecDocuments()` in `server/routes/blueprint.ts`
    - Modify `server/routes/blueprint.ts` — the `generateSpecDocuments()` function
    - Compute `isBatchRequest = request.nodeId == null` at the top of the function
    - Conditionally create emitter: `isBatchRequest && ctx?.eventBus ? createSpecDocsProgressEmitter(ctx.eventBus, job.id) : undefined`
    - Add zero-node early exit with `progressEmitter?.emitBatchFinished(0, 0, 0)` when `targetNodes.length === 0` and `isBatchRequest`
    - Emit `batch_init` before any generation starts (before LLM factory call and before Promise.all)
    - Replace `Promise.all(targetNodes.flatMap(...))` with sequential per-node loop ONLY when `progressEmitter` is defined
    - Emit `node_started` at beginning of each iteration with nodeId, title, 1-indexed position
    - Wrap each node's `buildSpecDocument` calls in try/catch: emit `node_completed` on success, `node_failed` on error
    - Add `Promise.race` with 120s timeout per node, treat timeout as failure with "节点生成超时 (120s)" message
    - Emit `batch_finished` after loop with completedCount, failedCount, elapsedMs
    - Preserve existing `Promise.all` path for single-node requests (no progress, no sequential overhead)
    - Ensure LLM factory (`specDocsLlmGeneration.generate()`) is still called BEFORE the per-node loop if enabled, producing `llmNodeOutputById` for use in `buildSpecDocument`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3, 5.4, 6.1, 6.4, 6.5_

  - [x]* 2.2 Write property test: Batch continues after node failure
    - **Property 8: Batch continues after node failure**
    - **Validates: Requirements 6.1, 6.4**
    - Create `server/routes/blueprint/__tests__/spec-docs-batch-resilience.property.test.ts`
    - Generate batches of N nodes where K are configured to fail
    - Verify all N nodes are processed (N `node_started` events emitted)
    - Verify exactly N terminal events (`node_completed` or `node_failed`)
    - Verify exactly one `batch_finished` event with `completedCount + failedCount === N`

  - [x]* 2.3 Write unit tests for batch loop error handling
    - Create `server/routes/blueprint/__tests__/spec-docs-batch-resilience.test.ts`
    - Test all-nodes-fail scenario: `batch_finished` with `completedCount=0`, `failedCount=N` (Req 6.4)
    - Create `server/routes/blueprint/__tests__/spec-docs-batch-timeout.test.ts`
    - Test 120s timeout triggers `node_failed` with timeout error summary (Req 6.5)
    - Test single-node request (`request.nodeId` set) emits zero progress events (Req 5.1)
    - Test batch with 1 node (`request.nodeId == null`, 1 node in tree) still emits progress events
    - _Requirements: 5.1, 6.1, 6.4, 6.5_

- [x] 3. Checkpoint — Ensure server-side tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Client-side store slice
  - [x] 4.1 Implement `specDocsProgress` slice in realtime store
    - Extend `client/src/lib/blueprint-realtime-store.ts`
    - Define types: `SpecDocsNodeStatus`, `SpecDocsNodeEntry`, `SpecDocsBatchSummary`, `SpecDocsProgressState`
    - Include `dismissed: boolean` field in `SpecDocsProgressState` (Req 3.7)
    - Define `INITIAL_SPEC_DOCS_PROGRESS` constant with `dismissed: false`
    - Implement `VALID_TRANSITIONS` map and `isValidTransition()` helper
    - Add `specDocsProgress` field to store state initialized to `INITIAL_SPEC_DOCS_PROGRESS`
    - Add `dismissSpecDocsProgress` action that sets `dismissed: true`
    - Implement `handleSpecDocsProgressEvent()` dispatch function
    - Handle `batch_init`: reset entire slice (including `dismissed: false`), create pending nodes, cap totalCount at 200
    - Handle `node_started`: validate transition from pending, update to processing
    - Handle `node_completed`: validate transition from processing, increment `completedCount` and `processedCount`
    - Handle `node_failed`: validate transition from processing, store truncated errorSummary (500 chars), increment `processedCount` only (NOT `completedCount`)
    - Handle `batch_finished`: set batchStatus to finished, store summary
    - Ignore events for unknown nodeIds or invalid transitions
    - Wire `handleSpecDocsProgressEvent` into existing `dispatchEvent` handler
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.7, 4.3_

  - [x]* 4.2 Write property test: Store initialization and reset from batch_init
    - **Property 2: Store initialization and reset from batch_init**
    - **Validates: Requirements 2.1, 2.6**
    - Create `client/src/lib/__tests__/spec-docs-progress-store.property.test.ts`
    - Generate lists of 1–200 node IDs, verify store state after batch_init
    - Verify reset behavior when dispatching batch_init on existing state (including `dismissed` reset)

  - [x]* 4.3 Write property test: Valid state transitions update status and counters correctly
    - **Property 3: Valid state transitions update status and counters correctly**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - Add to `client/src/lib/__tests__/spec-docs-progress-store.property.test.ts`
    - Verify pending → processing, processing → completed, processing → failed transitions
    - Verify `completedCount` only increments on success, `processedCount` increments on both success and failure
    - Verify invariant: `processedCount === completedCount + failedNodeCount` at all times

  - [x]* 4.4 Write property test: Invalid transitions and unknown nodes are rejected
    - **Property 4: Invalid transitions and unknown nodes are rejected**
    - **Validates: Requirements 2.7, 2.8**
    - Add to `client/src/lib/__tests__/spec-docs-progress-store.property.test.ts`
    - Generate invalid transition sequences and unknown node IDs
    - Verify store state remains unchanged

  - [x]* 4.5 Write property test: Node display order preservation
    - **Property 6: Node display order preservation**
    - **Validates: Requirements 3.6**
    - Add to `client/src/lib/__tests__/spec-docs-progress-store.property.test.ts`
    - Verify `nodeOrder` array preserves exact ordering from batch_init throughout lifecycle

  - [x]* 4.6 Write property test: Non-interference with other stage events
    - **Property 7: Non-interference with other stage events**
    - **Validates: Requirements 4.3**
    - Add to `client/src/lib/__tests__/spec-docs-progress-store.property.test.ts`
    - Interleave spec_docs events with other stage events
    - Verify other store slices remain unmodified

- [x] 5. Progress panel UI components
  - [x] 5.1 Create `SpecDocsProgressPanel` component
    - Create `client/src/pages/autopilot/right-rail/spec-docs-progress/SpecDocsProgressPanel.tsx`
    - Implement `SpecDocsProgressPanel`: return null when `batchStatus === "idle"` OR `dismissed === true`
    - Implement dismiss button (visible only when `batchStatus === "finished"`) that calls `dismissSpecDocsProgress()`
    - Implement `CompletionCounter`: display `processed/total 已完成`
    - Implement `NodeProgressList`: render nodes in `nodeOrder` order
    - Implement `NodeProgressItem` with status-based styling (pending/processing/completed/failed)
    - Implement `StatusIndicator`: spinner for processing, checkmark for completed, error icon for failed
    - Implement `ErrorTooltip`: show truncated error summary (200 chars) on hover
    - Implement `BatchSummaryLine`: show completed/failed counts and formatted elapsed time
    - Implement `formatElapsedTime(ms)`: MM:SS or HH:MM:SS format
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 6.2, 6.3_

  - [x]* 5.2 Write property test: Elapsed time formatting
    - **Property 5: Elapsed time formatting**
    - **Validates: Requirements 3.5**
    - Create `client/src/pages/autopilot/right-rail/spec-docs-progress/__tests__/format-elapsed-time.property.test.ts`
    - Generate non-negative integers for milliseconds
    - Verify MM:SS format when < 60 minutes, HH:MM:SS when >= 60 minutes
    - Verify zero-padding of minutes and seconds

  - [x]* 5.3 Write unit tests for Progress Panel rendering
    - Create `client/src/pages/autopilot/right-rail/spec-docs-progress/__tests__/SpecDocsProgressPanel.test.tsx`
    - Test panel not rendered when batchStatus is idle (Req 5.2)
    - Test panel not rendered when dismissed is true (Req 3.7)
    - Test panel renders with completion counter during batch
    - Test processing node shows animated indicator (Req 3.2)
    - Test completed node shows success indicator (Req 3.3)
    - Test failed node shows error indicator and tooltip (Req 3.4)
    - Test summary line displays on batch finish (Req 3.5)
    - Test dismiss button appears only when batch is finished
    - Test dismiss button click hides panel
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 5.2, 6.2, 6.3_

- [x] 6. Checkpoint — Ensure all client-side tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integration and wiring
  - [x] 7.1 Wire SpecDocsProgressPanel into Autopilot workbench
    - Import and render `SpecDocsProgressPanel` in the appropriate right-rail container
    - Ensure panel appears during batch generation and hides when idle or dismissed
    - Verify panel remains visible after batch finishes until dismiss button clicked or navigated away
    - Ensure panel does NOT overlap or interfere with MarkdownRenderer content area (progress panel is in workbench chrome/status area, not document body)
    - _Requirements: 3.1, 3.7_

  - [x]* 7.2 Write integration tests for end-to-end event flow
    - Create `server/routes/blueprint/__tests__/spec-docs-progress-e2e.test.ts`
    - Test full pipeline: Emitter → EventBus → mock SocketRelay → Store state
    - Verify events flow correctly from server emission to client store update
    - Verify `StageProgressEmitter.observing()` with `extraPayload` produces correct event structure
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 7.3 Write integration tests for response format preservation
    - Create `server/routes/blueprint/__tests__/spec-docs-response-format.test.ts`
    - Verify HTTP response shape (`job`, `specTree`, `documents`) unchanged after feature addition
    - Verify no progress-related fields in HTTP response body
    - Verify `GenerateBlueprintSpecDocumentsResult` discriminated union shape preserved
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]* 7.4 Write integration tests for test mode compatibility
    - Create `server/routes/blueprint/__tests__/spec-docs-test-mode.test.ts`
    - Verify `BUILD_TARGET=test` produces same output without eventBus
    - Verify `vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_ENABLED", "true")` activates LLM path
    - Verify backend completes generation regardless of frontend subscription state
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout (server: Express + Socket.IO, client: React + Zustand)
- All property tests use `fast-check` with minimum 100 iterations per property
- The existing `BlueprintEventBus` → `BlueprintSocketRelay` pipeline is reused; no new socket channels needed
- **Critical**: Integration point is `generateSpecDocuments()` in `blueprint.ts`, NOT `spec-docs-llm-generation.ts`
- **Critical**: `isBatchRequest = request.nodeId == null` is the ONLY reliable signal for batch vs single-node

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] }
  ]
}
```
