# Implementation Plan: Skill-aware Agent Sandbox

## Tasks

- [x] 1. Define skill manifest schema
  - [x] 1.1 Add JSON schema or TypeScript schema for `skill.json`
  - [x] 1.2 Validate name, version, runtime, entrypoint, capabilities, outputs, and security hints
  - [x] 1.3 Add fixtures for valid and invalid manifests
  - _Requirements: 1_

- [x] 2. Implement local skill registry
  - [x] 2.1 Create server-side registry loader
  - [x] 2.2 Load manifests from configured local skill directory
  - [x] 2.3 Build capability index
  - [x] 2.4 Add APIs or internal methods for list/detail/search
  - [x] 2.5 Add tests that registry discovery never executes skill code
  - _Requirements: 2_

- [x] 3. Add planner matching
  - [x] 3.1 Map `requiredCapabilities` to candidate skills
  - [x] 3.2 Rank candidates by coverage and safety hints
  - [x] 3.3 Surface missing-skill reason when no skill matches
  - [x] 3.4 Add manual override hook for advanced mode
  - _Requirements: 4_

- [x] 4. Add skill job payload support
  - [x] 4.1 Define `payload.skillRef` and `payload.skillInput`
  - [x] 4.2 Validate referenced skill exists and supports required capabilities
  - [x] 4.3 Preserve existing command and browser payload behavior
  - _Requirements: 3, 4_

- [x] 5. Inject skill into sandbox
  - [x] 5.1 Copy or mount skill code into controlled container path
  - [x] 5.2 Write structured skill input file into workspace
  - [x] 5.3 Run skill entrypoint in container
  - [x] 5.4 Collect skill artifacts and logs
  - _Requirements: 3_

- [x] 6. Add governance checks
  - [x] 6.1 Compare skill security hints with executor security level
  - [x] 6.2 Reject unsafe network/filesystem/credential needs by default
  - [x] 6.3 Include skill name/version in executor events and audit logs
  - _Requirements: 5_

- [x] 7. Seed first local skills
  - [x] 7.1 Add `browser-research` skill using Playwright
  - [x] 7.2 Add `document-render` skill using Pandoc/LibreOffice
  - [x] 7.3 Add smoke tests for both skills when strong image is available
  - _Requirements: 1, 3, 4_
