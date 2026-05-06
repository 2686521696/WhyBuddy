# Implementation Plan: Docker Live Preview Workstation

## Tasks

- [x] 1. Define preview session contract
  - [x] 1.1 Add preview session type and lifecycle states
  - [x] 1.2 Add job payload field for `livePreview`
  - [x] 1.3 Ensure sessions are project/mission scoped
  - _Requirements: 1_

- [x] 2. Add screenshot stream MVP
  - [x] 2.1 Add screenshot interval option to browser jobs
  - [x] 2.2 Emit or store latest screenshot frames
  - [x] 2.3 Add cleanup for screenshot stream on job final state
  - [x] 2.4 Add tests for stream start/stop lifecycle
  - _Requirements: 2, 5_

- [x] 3. Add terminal/log live panel
  - [x] 3.1 Reuse executor `job.log` events for live terminal view
  - [x] 3.2 Add fallback to stored `executor.log`
  - [x] 3.3 Ensure credential scrubbing applies before display
  - _Requirements: 3_

- [x] 4. Add frontend preview panel
  - [x] 4.1 Add project-scoped live preview panel in autopilot/task detail
  - [x] 4.2 Show browser latest frame when available
  - [x] 4.3 Show terminal/log stream when available
  - [x] 4.4 Add closed/unavailable/fallback states
  - _Requirements: 1, 2, 3_

- [x] 5. Add replay artifacts
  - [x] 5.1 Persist selected screenshots or key frames as artifacts
  - [x] 5.2 Persist terminal/log stream segments
  - [x] 5.3 Expose replay artifacts under mission detail
  - _Requirements: 4_

- [ ] 6. Evaluate noVNC slice
  - [ ] 6.1 Prototype Xvfb + VNC + noVNC inside strong image
  - [x] 6.2 Design server proxy and authorization model
  - [x] 6.3 Add explicit go/no-go note before implementing production noVNC
  - _Requirements: 2, 5_

- [x] 7. Security and resource guardrails
  - [x] 7.1 Enforce preview session timeout
  - [x] 7.2 Prevent direct public container port exposure
  - [x] 7.3 Log preview lifecycle audit events
  - [x] 7.4 Add cancellation cleanup tests
  - _Requirements: 5_
