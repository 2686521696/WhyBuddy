# Implementation Plan: Early Intake Clarification Brainstorm

## Overview

Implement a complete early-stage multi-agent brainstorm flow for input and clarification, including backend decision/synthesis, persisted artifacts, Socket.IO event flow, and 3D graph visualization in the default blueprint page.

All backend early modules go in `server/routes/blueprint/brainstorm/`.
Frontend graph wiring reuses `client/src/lib/brainstorm-graph-store.ts` and `client/src/components/three/scene-fusion/BrainstormWallGraph.tsx`.

## Tasks

- [ ] 1. Implement early brainstorm config
  - [ ] 1.1 Create `server/routes/blueprint/brainstorm/early-stage-config.ts`
    - Resolve `BLUEPRINT_EARLY_BRAINSTORM_ENABLED`
    - Resolve `BLUEPRINT_EARLY_BRAINSTORM_INPUT_ENABLED`
    - Resolve `BLUEPRINT_EARLY_BRAINSTORM_CLARIFICATION_ENABLED`
    - Disable by default when `BUILD_TARGET === "test"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ] 1.2 Add config tests
    - Master off disables all early behavior
    - Per-stage off disables only that early stage
    - Truthy-but-not-exactly-true values remain disabled
    - Test build target disables by default
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Define early brainstorm contracts
  - [ ] 2.1 Add shared/server-local types for early decisions, questions, synthesis, sufficiency, and artifacts
    - `EarlyIntakeDecision`
    - `EarlyClarificationQuestion`
    - `EarlyClarificationSynthesis`
    - `EarlySufficiencyResult`
    - `EarlyBrainstormArtifact`
    - `EarlyRouteContextPackage`
    - _Requirements: 2.2, 4.2, 5.3, 6.2_

  - [ ] 2.2 Add type guard / parser tests
    - Valid payloads parse
    - Invalid payloads degrade safely
    - Missing optional default assumptions are accepted
    - _Requirements: 4.2, 6.2, 10.2_

- [ ] 3. Implement Intake Decision Gate
  - [ ] 3.1 Create `early-intake-decision-gate.ts`
    - Build prompt from raw intake and optional context
    - Return one of `proceed_to_route_generation`, `ask_clarification`, `narrow_scope`, `fetch_context`
    - Include reason, missingInformation, confidence
    - Bias to fallback when confidence is low
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.2 Add tests for gate outputs and degradation
    - Clear request proceeds
    - Ambiguous request asks clarification
    - Over-broad request requests scope narrowing
    - LLM failure falls back
    - _Requirements: 2.1, 2.2, 2.5_

- [ ] 4. Implement early multi-agent session orchestration
  - [ ] 4.1 Create `early-session-orchestrator.ts`
    - Reuse existing BrainstormOrchestrator where possible
    - Configure early roles: product strategist, system architect, risk auditor, delivery planner, UX interviewer
    - Enforce timeout
    - Emit `brainstorm.*` events through BlueprintEventBus
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 4.2 Add orchestration tests
    - Session started emits event
    - Role nodes are created
    - Completion emits event
    - Timeout emits degraded event
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 10.2_

- [ ] 5. Implement clarification synthesizer
  - [ ] 5.1 Create `early-clarification-synthesizer.ts`
    - Merge role notes
    - Deduplicate questions
    - Cap user-facing high-value questions to default 5
    - Convert low-priority ambiguity to assumptions/risk notes
    - Produce recommended next action
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 5.2 Add synthesizer tests
    - Duplicate questions merge
    - Priority cap is enforced
    - Low-priority items become assumptions/risk notes
    - No questions means proceed
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [ ] 6. Implement sufficiency check
  - [ ] 6.1 Create `early-sufficiency-check.ts`
    - Evaluate original intake, questions, answers, assumptions, risk notes
    - Return `sufficient`, `needs_followup`, or `narrow_scope_required`
    - Build route context package when sufficient
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 6.2 Add sufficiency tests
    - Complete answers produce route context
    - Missing critical answer produces follow-up
    - Over-broad answers require narrowing
    - Failure degrades to existing flow
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 10.2_

- [ ] 7. Persist early brainstorm artifacts
  - [ ] 7.1 Create `early-brainstorm-artifact.ts`
    - Build `early_brainstorm` artifact
    - Attach artifact to job or intake-linked job
    - Preserve existing artifacts
    - Include session ID and all synthesis fields
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 7.2 Add replay retrieval support
    - Reuse existing brainstorm memory store if compatible
    - Expose replay by job/session ID
    - _Requirements: 6.5_

  - [ ] 7.3 Add artifact tests
    - Artifact persists after session completion
    - Existing artifacts remain
    - Replay returns stored session
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [ ] 8. Wire input route
  - [ ] 8.1 Update intake/job creation flow
    - Run input decision gate before route generation when enabled
    - Start early session when clarification is needed
    - Persist understanding package when proceeding
    - Fall back when disabled or degraded
    - _Requirements: 2.1, 2.5, 6.4, 10.1, 10.2_

  - [ ] 8.2 Add input integration tests
    - Disabled path identical to existing behavior
    - Enabled clear input proceeds
    - Enabled ambiguous input creates early session and questions
    - Degraded path falls back
    - _Requirements: 1.5, 2.1, 2.5, 10.1, 10.2_

- [ ] 9. Wire clarification answers route
  - [ ] 9.1 Update clarification answer handling
    - Run sufficiency check when enabled
    - Persist route context package when sufficient
    - Ask follow-up when needed
    - Preserve existing answer route compatibility
    - _Requirements: 5.1, 5.4, 5.5, 9.4, 10.1_

  - [ ] 9.2 Add clarification integration tests
    - Sufficient answers proceed
    - Follow-up questions appear
    - Narrow scope state appears
    - Disabled path remains unchanged
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 10.1_

- [ ] 10. Pass early context into route generation
  - [ ] 10.1 Update route generation context assembly
    - Read latest early brainstorm artifact/context package
    - Include understanding summary, assumptions, and risk notes in route generation prompt/context
    - Ignore malformed early context safely
    - _Requirements: 6.4, 10.2_

  - [ ] 10.2 Add route context tests
    - Route generation receives early context when present
    - Route generation ignores malformed early context
    - Existing route generation unchanged without early context
    - _Requirements: 6.4, 10.1, 10.2_

- [ ] 11. Wire frontend brainstorm event store
  - [ ] 11.1 Route `brainstorm.*` events into `useBrainstormGraphStore`
    - Subscribe through existing realtime/socket layer
    - Handle session started
    - Handle node created
    - Handle node updated
    - Handle session completed/degraded
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 11.2 Add frontend store tests
    - Duplicate events are idempotent
    - Out-of-order node update is tolerated
    - Degraded session reaches terminal state
    - _Requirements: 8.5, 8.6, 10.3_

- [ ] 12. Mount 3D brainstorm wall graph
  - [ ] 12.1 Add `BrainstormWallGraphConnected` to the default blueprint 3D scene
    - Mount in `BlueprintRuntimeAgents` or the owning scene-fusion layer
    - Render only when session status is not idle
    - Ensure graph is visible in input / clarification flow
    - Avoid overlap with runtime pets and stage UI
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 12.2 Add rendering tests / visual checks
    - Component is present when session is active
    - Component is absent when idle
    - Canvas/texture renders nonblank graph content
    - Desktop and mobile framing remains readable
    - _Requirements: 7.1, 7.3, 7.4, 7.5_

- [ ] 13. Wire clarification UI
  - [ ] 13.1 Display synthesized questions in the normal clarification panel
    - Show question text
    - Show priority and optional reason/impact stage
    - Support accepting default assumption
    - Show fallback questions on degradation
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [ ] 13.2 Add UI tests
    - Generated questions render
    - Default assumption action works
    - Fallback questions render when degraded
    - Answers submit through compatible route
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

- [ ] 14. Diagnostics and observability
  - [ ] 14.1 Extend diagnostics with early brainstorm entry
    - Enabled/disabled state
    - Active early sessions
    - Completed early sessions
    - Degradation count
    - Per-stage input/clarification config
    - _Requirements: 1.1, 1.2, 1.3, 10.2_

  - [ ] 14.2 Add diagnostics tests
    - Disabled state is zeroed
    - Enabled state includes counters
    - Config reflects env values
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 15. Final verification
  - [ ] 15.1 Run targeted backend tests
  - [ ] 15.2 Run targeted frontend graph/store tests
  - [ ] 15.3 Run typecheck or document unrelated existing failures
  - [ ] 15.4 Manually verify page-visible 3D graph in input / clarification flow

## Notes

- This spec intentionally includes 3D graph page integration in v1.
- Early brainstorm is default-off and must degrade to the existing input / clarification flow.
- The existing 6-stage brainstorm pipeline wrapper remains out of scope except for consuming early route context.
