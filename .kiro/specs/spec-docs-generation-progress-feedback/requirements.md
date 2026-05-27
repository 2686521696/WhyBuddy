# Requirements Document

## Introduction

This feature adds real-time progress feedback to the spec document generation process in the Autopilot workbench. When users trigger "全部生成" (Generate All) to produce spec documents (requirements.md, design.md, tasks.md) for multiple SPEC tree nodes, the system currently provides no per-node progress indication — users see only a disabled "生成中..." button for 30-60 seconds with no visibility into which node is being processed, how many have completed, or estimated time remaining.

This feature extends the existing `BlueprintEventBus` → `BlueprintSocketRelay` → `useBlueprintRealtimeStore` real-time pipeline (already used for intake, route_generation, and spec_tree stages) to emit and display per-node progress events during spec document generation. The frontend will render a streaming progress panel showing node-level status transitions, completion counts, and error attribution.

## Glossary

- **Spec_Docs_Progress_Emitter**: The server-side component that emits per-node progress events through `BlueprintEventBus` during batch spec document generation, using the `spec_docs` stage identifier.
- **Progress_Panel**: The frontend UI component that displays real-time spec document generation progress, including per-node status, completion count, and error details.
- **Node_Progress_Event**: A structured event emitted via `BlueprintEventBus` representing a state transition for a single SPEC tree node during document generation (e.g., pending → processing → completed/failed).
- **Batch_Generation**: The process of generating spec documents for multiple SPEC tree nodes in a single "全部生成" operation.
- **Completion_Counter**: A UI element displaying the ratio of completed nodes to total nodes (e.g., "3/8 已完成").
- **Node_Status**: The generation state of a single SPEC tree node within a batch: `pending`, `processing`, `completed`, or `failed`.
- **Realtime_Store**: The `useBlueprintRealtimeStore` Zustand store that receives and manages real-time events from the backend via Socket.IO.
- **Stage_Progress_Emitter**: The existing `createStageProgressEmitter` utility that provides structured progress emission through `BlueprintEventBus` for a given stage.

## Requirements

### Requirement 1: Per-Node Progress Event Emission

**User Story:** As a user generating spec documents for multiple nodes, I want the system to emit progress events as each node begins and completes processing, so that the frontend can display real-time status updates.

#### Acceptance Criteria

1. WHEN batch spec document generation begins, THE Spec_Docs_Progress_Emitter SHALL emit an initialization event through BlueprintEventBus containing the job identifier, the total node count, and the ordered list of node identifiers.
2. WHEN a specific node begins spec document generation, THE Spec_Docs_Progress_Emitter SHALL emit a node-started event containing the node identifier, node title (truncated to 200 characters maximum), and its position in the queue (1-indexed).
3. WHEN a specific node completes spec document generation successfully, THE Spec_Docs_Progress_Emitter SHALL emit a node-completed event containing the node identifier and the updated completed count.
4. IF a specific node fails during spec document generation, THEN THE Spec_Docs_Progress_Emitter SHALL emit a node-failed event containing the node identifier, a human-readable error summary truncated to a maximum of 400 characters, and the updated completed count.
5. WHEN all nodes in the batch have been processed (completed or failed), THE Spec_Docs_Progress_Emitter SHALL emit a batch-finished event containing the total completed count, total failed count, and total elapsed time in milliseconds.
6. IF batch spec document generation is initiated with zero nodes, THEN THE Spec_Docs_Progress_Emitter SHALL emit a batch-finished event with total completed count of 0, total failed count of 0, and elapsed time of 0 milliseconds without emitting an initialization event.

### Requirement 2: Frontend Progress State Management

**User Story:** As a user viewing the Autopilot workbench, I want the realtime store to track per-node generation status, so that UI components can reactively display progress.

#### Acceptance Criteria

1. WHEN a batch initialization event is received, THE Realtime_Store SHALL create a spec_docs progress slice containing the total node count (maximum 200 nodes) and initialize all nodes to `pending` status with a completed counter of 0 and a processed counter of 0.
2. WHEN a node-started event is received for a node currently in `pending` status, THE Realtime_Store SHALL update that node's status to `processing`.
3. WHEN a node-completed event is received for a node currently in `processing` status, THE Realtime_Store SHALL update that node's status to `completed` and increment both the completed counter and the processed counter.
4. WHEN a node-failed event is received for a node currently in `processing` status, THE Realtime_Store SHALL update that node's status to `failed`, store the error summary (truncated to 500 characters maximum), and increment the processed counter.
5. WHEN a batch-finished event is received, THE Realtime_Store SHALL mark the overall batch status as `finished` and store the final summary containing the completed count, failed count, and elapsed time in milliseconds.
6. WHEN a new batch generation is initiated for the same job, THE Realtime_Store SHALL reset the spec_docs progress slice to its initial state (no nodes, all counters at 0, overall batch status cleared) before processing new events.
7. IF a node-started, node-completed, or node-failed event is received referencing a node whose current status does not match the expected source status for that transition, THEN THE Realtime_Store SHALL ignore the event and leave the node's status unchanged.
8. IF a batch initialization event, node-started, node-completed, or node-failed event is received referencing an unknown node ID not present in the current progress slice, THEN THE Realtime_Store SHALL ignore the event without modifying the slice state.

### Requirement 3: Progress Panel UI Display

**User Story:** As a user waiting for spec documents to generate, I want to see a progress panel showing which node is currently being processed and how many are complete, so that I can estimate remaining wait time and identify failures.

#### Acceptance Criteria

1. WHEN batch spec document generation starts, THE Progress_Panel SHALL automatically appear and display the Completion_Counter showing the ratio of processed nodes to total nodes (e.g., "3/8 已完成"), updating within 1 second of each node status change.
2. WHILE batch spec document generation is in progress, THE Progress_Panel SHALL highlight the currently processing node with an animated visual indicator (e.g., spinner or pulsing animation) that is visually differentiated from idle and completed node states.
3. WHEN a node transitions to `completed` status, THE Progress_Panel SHALL display a success indicator next to the node title within 1 second of the status transition.
4. WHEN a node transitions to `failed` status, THE Progress_Panel SHALL display an error indicator next to the node title and make the error summary (truncated to a maximum of 200 characters) accessible via tooltip or expandable detail.
5. WHEN batch generation finishes, THE Progress_Panel SHALL display a summary line showing total completed, total failed, and elapsed time formatted as MM:SS (or HH:MM:SS if elapsed time exceeds 59 minutes).
6. THE Progress_Panel SHALL display node entries in the same order as the generation queue, preserving the original SPEC tree ordering.
7. WHEN batch generation finishes and the summary line is displayed, THE Progress_Panel SHALL remain visible until the user explicitly dismisses it or navigates away from the current view.

### Requirement 4: Progress Integration with Existing Stage Pipeline

**User Story:** As a developer maintaining the Autopilot system, I want spec document progress events to use the same event bus and socket relay infrastructure as other stages, so that the implementation is consistent and maintainable.

#### Acceptance Criteria

1. THE Spec_Docs_Progress_Emitter SHALL use the existing `createStageProgressEmitter` utility with stage identifier `spec_docs` and role identifier `generator`.
2. THE Spec_Docs_Progress_Emitter SHALL emit events through the existing `BlueprintEventBus` → `BlueprintSocketRelay` pipeline without requiring new socket event channels.
3. WHEN the Realtime_Store receives progress events from other stages (intake, route_generation, spec_tree), THE Realtime_Store SHALL process those events without interference from spec_docs progress events.
4. THE Spec_Docs_Progress_Emitter SHALL encode per-node progress data within the existing `AgentReasoningEntry` structure using the `observing` event type and structured metadata fields.

### Requirement 5: Single-Node Generation Compatibility

**User Story:** As a user generating spec documents for a single node, I want the existing single-node flow to remain unchanged, so that the progress feature does not add unnecessary overhead to simple operations.

#### Acceptance Criteria

1. WHEN the user generates spec documents for a single node (by providing a specific `nodeId` in the request rather than triggering "全部生成"), THE system SHALL execute the existing single-node generation flow without emitting any Node_Progress_Event (no initialization, node-started, node-completed, or batch-finished events) through BlueprintEventBus.
2. WHILE a single-node generation is in progress, THE Progress_Panel SHALL NOT render the batch progress UI elements (no Completion_Counter, no node status list, no batch summary line).
3. WHEN a single-node generation completes, THE system SHALL return the same `BlueprintSpecDocumentsResponse` payload structure as the current behavior, with no additional progress-related fields appended to the response body.
4. WHEN a single-node generation fails, THE system SHALL return the same error response format as the current behavior without emitting a batch-finished event or node-failed event through BlueprintEventBus.

### Requirement 6: Error Resilience and Continuation

**User Story:** As a user generating spec documents for multiple nodes, I want the system to continue processing remaining nodes when one fails, so that a single failure does not block the entire batch.

#### Acceptance Criteria

1. IF a node fails during batch spec document generation, THEN THE Spec_Docs_Progress_Emitter SHALL catch the error, emit a node-failed event for that node, and continue processing the next node in the queue without interrupting the batch loop.
2. IF a node fails during batch spec document generation, THEN THE Progress_Panel SHALL display the failed node with its error indicator (as defined in Requirement 3 criterion 4) while continuing to show progress updates for subsequent nodes in real time.
3. WHEN batch generation completes with partial failures, THE Progress_Panel SHALL display the final summary with separate counts for completed nodes and failed nodes (e.g., "5 成功, 3 失败"), using visually distinct status indicators (success vs error) for each node entry in the list.
4. IF all nodes in the batch fail, THEN THE Spec_Docs_Progress_Emitter SHALL still emit a batch-finished event with total completed count equal to 0, total failed count equal to the total node count, and total elapsed time covering the entire batch duration in milliseconds.
5. IF a single node's spec document generation does not complete within 120 seconds, THEN THE Spec_Docs_Progress_Emitter SHALL treat that node as failed with a timeout error summary and proceed to the next node in the queue.

### Requirement 7: Test Mode Compatibility

**User Story:** As a developer running tests, I want the progress feature to work in fallback/simulated mode without requiring real event bus connectivity, so that existing tests remain stable.

#### Acceptance Criteria

1. WHILE `BUILD_TARGET=test`, THE system SHALL continue to run spec document generation in fallback/simulated mode without requiring real BlueprintEventBus connectivity, and SHALL produce the same spec document output (requirements, design, tasks markdown) as when the event bus is available.
2. WHILE `BUILD_TARGET=test`, IF the event bus dependency is not injected or is unavailable, THEN THE Spec_Docs_Progress_Emitter SHALL skip all event emission calls as a no-op without throwing errors and without blocking or delaying the generation pipeline.
3. WHEN the frontend is not subscribed to the job's realtime events (e.g., page navigated away), THE system SHALL complete spec document generation on the backend and persist all generated artifacts to the job store regardless of frontend subscription state.
4. WHILE `BUILD_TARGET=test`, IF a test explicitly opts in via `vi.stubEnv("BLUEPRINT_SPEC_DOCS_LLM_ENABLED", "true")`, THEN THE system SHALL allow the LLM generation path to activate without being blocked by the test-mode gate.

### Requirement 8: Response Format Preservation

**User Story:** As a developer consuming the spec documents API, I want the HTTP response format to remain unchanged, so that existing integrations and auto-advance logic continue to work.

#### Acceptance Criteria

1. WHEN batch spec document generation completes (all nodes processed), THE system SHALL return a `BlueprintSpecDocumentsResponse` payload containing the same three top-level fields (`job`, `specTree`, `documents`) with identical types and semantics as the current behavior, and the `documents` array SHALL preserve the same element ordering (node × type cartesian product order) as the existing implementation.
2. THE system SHALL NOT add, remove, or rename any fields in the existing `POST /api/blueprint/jobs/:jobId/spec-documents` response JSON body; progress metadata (e.g., per-node completion counts, percentage, or in-flight status) SHALL be delivered exclusively through a separate channel (such as WebSocket events) and SHALL NOT appear in this HTTP response.
3. WHEN the auto-advance hook (`useAutoAdvance`) triggers spec document generation via `forceAdvance`, THE system SHALL continue to resolve the returned promise as `GenerateBlueprintSpecDocumentsResult` (discriminated union of `{ ok: true; data: BlueprintSpecDocumentsResponse }` or `{ ok: false; error: ApiRequestError }`), with no change to the union shape or its member types.
4. IF a caller destructures the `BlueprintSpecDocumentsResponse` using only the fields defined in the current `shared/blueprint/contracts.ts` interface (`job`, `specTree`, `documents`), THEN THE system SHALL guarantee that destructuring continues to compile and produce the same runtime values without requiring caller-side code changes.
