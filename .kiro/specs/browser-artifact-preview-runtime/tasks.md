# Implementation Plan: Browser Artifact Preview Runtime

## Tasks

- [x] 1. Define browser job payload
  - [x] 1.1 Add browser task payload type documentation and test fixtures
  - [x] 1.2 Ensure browser jobs declare `requiredCapabilities`
  - [x] 1.3 Keep command-based payload behavior unchanged
  - _Requirements: 1_

- [x] 2. Add deterministic Playwright runner script
  - [x] 2.1 Add `agent-image/browser-runner.js` or equivalent script
  - [x] 2.2 Implement URL open, viewport, timeout, and wait strategy
  - [x] 2.3 Capture screenshot, HTML snapshot, console logs, and metrics
  - [x] 2.4 Write all outputs under `/workspace/artifacts`
  - _Requirements: 2_

- [x] 3. Add artifact manifest support
  - [x] 3.1 Define `artifact-manifest.json` schema
  - [x] 3.2 Make DockerRunner collect manifest metadata when present
  - [x] 3.3 Preserve fallback collection when manifest is absent
  - [x] 3.4 Add tests for manifest and fallback artifacts
  - _Requirements: 3_

- [x] 4. Extend server artifact previews
  - [x] 4.1 Audit existing artifact preview routes
  - [x] 4.2 Add or harden image preview support
  - [x] 4.3 Add or harden HTML preview support with safe headers
  - [x] 4.4 Add PDF inline preview support where safe
  - [x] 4.5 Add tests for missing, oversized, and unsafe artifacts
  - _Requirements: 4_

- [x] 5. Add frontend artifact preview UI
  - [x] 5.1 Add artifact preview card states for image, text, JSON, HTML, PDF, and log
  - [x] 5.2 Show browser screenshot as primary evidence for browser jobs
  - [x] 5.3 Ensure task center filters artifacts by current project/mission
  - [x] 5.4 Add focused tests for project-scoped artifact visibility
  - _Requirements: 5_

- [x] 6. End-to-end smoke
  - [x] 6.1 Build or require `cube-ai-agent-sandbox:latest`
  - [x] 6.2 Dispatch a browser screenshot job through lobster-executor
  - [x] 6.3 Verify screenshot, HTML, console log, and manifest artifacts
  - [x] 6.4 Verify UI preview can open at least image and text artifacts
  - _Requirements: 1, 2, 3, 4, 5_
