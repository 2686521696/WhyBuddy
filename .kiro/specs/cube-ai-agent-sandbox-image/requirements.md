# Requirements Document: Cube AI Agent Sandbox Image

## Introduction

当前 AI 镜像 `cube-ai-sandbox:latest` 基于 `node:20-slim`，已包含 Python、pip、git、curl、jq、build-essential、OpenAI/LangChain SDK 和 AI bridge。它适合基础脚本与 LLM 任务，但不足以支撑 AI Agent 工作站场景。

本 spec 定义新的强镜像 `cube-ai-agent-sandbox:latest`。目标是让 Docker 层具备真实高价值工作能力：浏览器自动化、截图、HTML/PDF 产物、文档转换、图片/视频处理、中文字体、能力自检。

## Requirements

### Requirement 1: Strong Agent Sandbox Image

**User Story:** 作为任务自动驾驶平台，我需要一个预装常用工具的强沙箱镜像，让 Agent 可以在容器里完成真实工作。

#### Acceptance Criteria

1. THE repository SHALL provide `services/lobster-executor/Dockerfile.agent`.
2. THE image name SHALL be `cube-ai-agent-sandbox:latest`.
3. THE image SHALL include Node.js, pnpm, tsx, Python, pip, uv, git, curl, wget, jq, and build-essential.
4. THE image SHALL preserve existing AI bridge behavior from `Dockerfile.ai`.
5. THE image SHALL create `/workspace` and `/workspace/artifacts`.

### Requirement 2: Browser Capability

**User Story:** 作为自动驾驶用户，我需要 Agent 可以打开网页、执行浏览器任务并截图回流。

#### Acceptance Criteria

1. THE image SHALL include Playwright and Chromium.
2. THE image SHALL be able to run a headless Chromium smoke script.
3. THE smoke script SHALL create a PNG screenshot under `/workspace/artifacts`.
4. THE image SHALL expose capability names `browser.playwright` and `browser.chromium` through its manifest or self-check.

### Requirement 3: Document and Media Tools

**User Story:** 作为项目用户，我需要 Agent 可以生成或转换常见文档和媒体产物。

#### Acceptance Criteria

1. THE image SHALL include LibreOffice or a documented compatible office conversion tool.
2. THE image SHALL include Pandoc.
3. THE image SHALL include ffmpeg.
4. THE image SHALL include ImageMagick or a documented compatible image processing tool.
5. THE image SHALL include basic Chinese fonts suitable for screenshots and PDF rendering.

### Requirement 4: Capability Self-check

**User Story:** 作为 executor，我需要镜像能自报工具是否可用，以免上层误判能力。

#### Acceptance Criteria

1. THE image SHALL include a self-check script.
2. THE self-check script SHALL verify Node, Python, Playwright, Chromium, LibreOffice/Pandoc, ffmpeg, and ImageMagick.
3. THE self-check script SHALL write a JSON report with capabilities and tool versions.
4. THE executor SHALL be able to consume this report in the capabilities contract spec.

### Requirement 5: Build and Smoke Scripts

**User Story:** 作为开发者，我需要简单命令构建和验证强镜像。

#### Acceptance Criteria

1. THE repository SHALL provide a script or package command to build `cube-ai-agent-sandbox:latest`.
2. THE repository SHALL provide a smoke script that runs the image and verifies core tools.
3. IF Docker is unavailable, THE smoke script SHALL fail with a clear Docker unavailable message.
4. Existing `Dockerfile.ai` behavior SHALL remain available for backward compatibility.

