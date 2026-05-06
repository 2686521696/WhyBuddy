# Implementation Plan: Docker Executor Capabilities Contract

## Tasks

- [x] 1. Define shared capability vocabulary
  - [x] 1.1 Add canonical executor capability constants and types in `shared/executor/contracts.ts`
  - [x] 1.2 Add tests that reject duplicate capability names and keep names lowercase/dot-delimited
  - [x] 1.3 Document initial capability vocabulary in this spec
  - _Requirements: 2_

- [x] 2. Add executor capability response types
  - [x] 2.1 Extend `services/lobster-executor/src/types.ts` with `ExecutorCapabilitiesResponse`
  - [x] 2.2 Include mode, docker lifecycle, image, artifact types, preview types, limits, and warnings
  - _Requirements: 1, 5_

- [x] 3. Implement capability resolver
  - [x] 3.1 Create `services/lobster-executor/src/capabilities.ts`
  - [x] 3.2 Resolve conservative capabilities for mock mode
  - [x] 3.3 Resolve conservative capabilities for native mode
  - [x] 3.4 Resolve Docker baseline capabilities for real mode
  - [x] 3.5 Include warning when Docker mode falls back to native
  - _Requirements: 1, 2_

- [x] 4. Add capabilities endpoint
  - [x] 4.1 Add `GET /api/executor/capabilities` to `services/lobster-executor/src/app.ts`
  - [x] 4.2 Add `capabilitiesSummary` to `/health` without removing existing fields
  - [x] 4.3 Ensure response never exposes secrets or raw host-only credential paths
  - _Requirements: 1, 5_

- [x] 5. Validate `payload.requiredCapabilities`
  - [x] 5.1 Parse optional `payload.requiredCapabilities` in request schema
  - [x] 5.2 Reject unknown capability names with `EXECUTOR_CAPABILITY_UNKNOWN`
  - [x] 5.3 Reject unsupported required capabilities with `EXECUTOR_CAPABILITY_UNSUPPORTED`
  - [x] 5.4 Keep existing jobs compatible when the field is omitted
  - _Requirements: 2, 3_

- [x] 6. Extend ExecutorClient
  - [x] 6.1 Add `getCapabilities()` to `server/core/executor-client.ts`
  - [x] 6.2 Add optional pre-dispatch capability validation helper
  - [x] 6.3 Add tests for reachable, unavailable, and malformed capability responses
  - _Requirements: 4_

- [x] 7. Surface capability mismatch to mission runtime
  - [x] 7.1 Map unsupported capability errors into mission blocked/failed detail
  - [x] 7.2 Preserve executor rejection details for task center and autopilot UI
  - _Requirements: 4, 5_

- [x] 8. Verification
  - [x] 8.1 Add mode-specific tests for mock/native/real capability documents
  - [x] 8.2 Run targeted lobster-executor capability/app/health tests
  - [x] 8.3 Run executor integration tests that create jobs without `requiredCapabilities`
  - [x] 8.4 Update current Docker architecture SVG or companion docs if capability endpoint lands
  - _Requirements: 5_
