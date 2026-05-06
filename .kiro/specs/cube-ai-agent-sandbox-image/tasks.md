# Implementation Plan: Cube AI Agent Sandbox Image

## Tasks

- [x] 1. Prepare image assets
  - [x] 1.1 Create `services/lobster-executor/agent-image/` for self-check scripts and manifest
  - [x] 1.2 Add `capabilities.json` with conservative initial capability names
  - [x] 1.3 Add `self-check.js` to verify Node, Playwright, Chromium, and artifact write access
  - [x] 1.4 Add `self-check.py` or extend JS self-check for Python, Pandoc, LibreOffice, ffmpeg, and ImageMagick
  - _Requirements: 4_

- [x] 2. Add Dockerfile.agent
  - [x] 2.1 Create `services/lobster-executor/Dockerfile.agent`
  - [x] 2.2 Install Node/Python/core shell tooling
  - [x] 2.3 Install AI bridge dependencies
  - [x] 2.4 Copy existing `ai-bridge/` into `/opt/ai-bridge/`
  - [x] 2.5 Copy self-check assets into `/opt/cube-agent/`
  - _Requirements: 1_

- [x] 3. Add browser tooling
  - [x] 3.1 Install Playwright
  - [x] 3.2 Install or bundle Chromium
  - [x] 3.3 Ensure headless Chromium runs as the configured non-root container user where possible
  - [x] 3.4 Generate a screenshot in `/workspace/artifacts` during self-check
  - _Requirements: 2_

- [x] 4. Add document and media tooling
  - [x] 4.1 Install LibreOffice or document a compatible alternative
  - [x] 4.2 Install Pandoc
  - [x] 4.3 Install ffmpeg
  - [x] 4.4 Install ImageMagick
  - [x] 4.5 Install basic Chinese fonts and validate font discovery
  - _Requirements: 3_

- [x] 5. Add build and smoke commands
  - [x] 5.1 Add a package script or standalone script for image build
  - [x] 5.2 Add a smoke script for `cube-ai-agent-sandbox:latest`
  - [x] 5.3 Make Docker unavailable errors clear on Windows and Linux
  - [x] 5.4 Keep `Dockerfile.ai` untouched and documented as legacy/baseline image
  - _Requirements: 5_

- [x] 6. Integrate with executor config
  - [x] 6.1 Add optional `LOBSTER_AGENT_IMAGE` or document `LOBSTER_AI_IMAGE=cube-ai-agent-sandbox:latest`
  - [x] 6.2 Ensure `aiEnabled` jobs can use the new image without payload overrides
  - [x] 6.3 Ensure capability contract can reference image manifest
  - _Requirements: 1, 4_

- [x] 7. Verification
  - [x] 7.1 Build image locally
  - [x] 7.2 Run image self-check
  - [x] 7.3 Run a browser screenshot smoke job through lobster-executor real mode
  - [x] 7.4 Record image size and build time notes in docs
  - _Requirements: 2, 3, 5_
