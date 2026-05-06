# Requirements Document: Browser Artifact Preview Runtime

## Introduction

Docker 执行层如果只能返回日志和下载文件，用户仍然会觉得自动驾驶不够真实。本 spec 定义浏览器执行与产物预览闭环：任务声明浏览器能力，强沙箱用 Playwright/Chromium 打开页面、截图、保存 HTML 和日志，server 将 artifacts 归档，前端可直接预览 HTML、PNG、PDF、JSON 和日志。

## Requirements

### Requirement 1: Browser Job Payload

**User Story:** 作为自动驾驶用户，我需要输入一个页面检查任务后，系统能在 Docker 中打开页面并收集证据。

#### Acceptance Criteria

1. THE job payload SHALL support a browser task shape with URL, actions, viewport, screenshot options, and artifact rules.
2. Browser jobs SHALL declare `requiredCapabilities` including `browser.playwright` and `browser.chromium`.
3. IF required browser capabilities are unavailable, THE job SHALL not run and SHALL surface a capability mismatch.
4. Existing command-based jobs SHALL remain supported.

### Requirement 2: Playwright Execution

**User Story:** 作为执行系统，我需要一个稳定的 Playwright 执行入口来完成页面访问、截图和快照。

#### Acceptance Criteria

1. THE agent sandbox SHALL run a Playwright script for browser jobs.
2. THE script SHALL support opening a URL, waiting for network idle or a configured timeout, and capturing screenshot.
3. THE script SHALL capture page title, final URL, console errors, and basic timing metrics.
4. THE script SHALL write outputs under `/workspace/artifacts`.

### Requirement 3: Artifact Manifest

**User Story:** 作为前端，我需要结构化 artifact manifest，以便知道哪些文件可以预览。

#### Acceptance Criteria

1. THE executor SHALL collect an `artifact-manifest.json` when present.
2. THE manifest SHALL include artifact id, name, kind, mime type, relative path, preview type, size, and description.
3. THE server SHALL preserve manifest metadata in mission artifacts.
4. IF manifest is missing, existing artifact collection SHALL still work.

### Requirement 4: Server Preview Routes

**User Story:** 作为用户，我需要在任务中心和自动驾驶页直接预览产物，而不只是下载。

#### Acceptance Criteria

1. THE server SHALL expose preview routes for text, JSON, HTML, PDF, and image artifacts.
2. Text previews SHALL be size-limited and mark truncation.
3. HTML previews SHALL be sandboxed or served with safe headers.
4. Missing or unsafe artifacts SHALL return clear errors.

### Requirement 5: Frontend Preview UI

**User Story:** 作为项目用户，我需要在任务详情里看到截图、HTML 快照、日志和报告。

#### Acceptance Criteria

1. THE task detail surface SHALL show artifact cards with preview actions.
2. Image artifacts SHALL render inline.
3. Text/JSON/log artifacts SHALL show readable previews.
4. HTML/PDF artifacts SHALL open in a controlled preview area or new route.
5. Preview UI SHALL remain project-scoped and not show artifacts from other projects.

