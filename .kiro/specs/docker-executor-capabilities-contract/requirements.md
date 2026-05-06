# Requirements Document: Docker Executor Capabilities Contract

## Introduction

当前 `lobster-executor` 已具备 `mock / native / real` 执行模式、DockerRunner 容器生命周期、安全沙箱、日志与 artifact 回流。但上层 route planner 和自动驾驶页还不知道 executor “会什么”，只能把它当作命令执行器使用。

本 spec 定义 Docker Executor V2 的能力声明与调度契约：executor 必须暴露自身运行模式、镜像、工具能力、artifact 类型、预览能力和资源限制；任务可以声明 `requiredCapabilities`；当能力不满足时，系统应拒绝或降级任务，并给出清晰原因。

## Requirements

### Requirement 1: Capabilities Endpoint

**User Story:** 作为任务调度系统，我需要查询 executor 当前可用能力，以便在派发任务前判断是否能执行。

#### Acceptance Criteria

1. WHEN server requests `GET /api/executor/capabilities` from lobster-executor THEN the executor SHALL return a structured capability document.
2. THE capability document SHALL include executor name, contract version, execution mode, docker status, selected image, capabilities, artifact types, preview types, and limits.
3. THE endpoint SHALL work in `mock`, `native`, and `real` modes.
4. IF Docker is unavailable and the executor has fallen back to `native`, THEN the capability document SHALL explicitly mark `dockerLifecycle=false`.
5. THE existing `/health` endpoint SHALL include a compact `capabilitiesSummary` without breaking existing consumers.

### Requirement 2: Capability Vocabulary

**User Story:** 作为开发者，我需要一套稳定能力命名规范，以免每个模块使用不同的字符串。

#### Acceptance Criteria

1. THE shared executor contract SHALL define canonical capability names for runtime, language, browser, document, media, artifact, preview, security, and AI features.
2. THE vocabulary SHALL include at least `runtime.docker`, `runtime.native`, `node`, `python`, `ai.llm`, `browser.playwright`, `browser.chromium`, `artifact.html`, `artifact.pdf`, `artifact.image`, `preview.html`, `preview.pdf`, and `preview.image`.
3. THE executor SHALL ignore unknown optional capabilities but SHALL reject unknown required capabilities with a clear error.
4. THE vocabulary SHALL be documented in this spec and exported for server-side tests.

### Requirement 3: Required Capabilities In Job Payload

**User Story:** 作为任务创建者，我需要声明一个 job 需要哪些能力，以便 executor 不会接下自己无法完成的任务。

#### Acceptance Criteria

1. THE `ExecutionPlanJob.payload.requiredCapabilities` field SHALL accept an array of canonical capability names.
2. WHEN `requiredCapabilities` is omitted, existing jobs SHALL continue to run with current behavior.
3. WHEN a job declares required capabilities and executor supports all of them, THE executor SHALL accept the job.
4. WHEN a job declares unsupported required capabilities, THE executor SHALL reject the job before execution.
5. THE rejection response SHALL include an error code, unsupported capability list, supported capability list, and remediation hint.

### Requirement 4: Server Dispatch Awareness

**User Story:** 作为自动驾驶调度层，我需要在下发前判断 executor 能力，减少运行时失败。

#### Acceptance Criteria

1. THE server-side `ExecutorClient` SHALL be able to fetch and cache executor capabilities.
2. THE dispatch path SHALL optionally validate `requiredCapabilities` before calling `POST /api/executor/jobs`.
3. IF validation fails before dispatch, THE mission SHALL be marked blocked or failed with a user-readable reason.
4. THE task center and autopilot surfaces SHALL be able to display executor capability mismatch in a compact form.

### Requirement 5: Observability and Compatibility

**User Story:** 作为运维者，我需要知道当前 executor 处于什么能力状态，同时不能破坏现有任务。

#### Acceptance Criteria

1. Existing smoke tests for executor job creation and callback SHALL continue to pass.
2. Capability endpoint responses SHALL avoid leaking secrets or host-only paths.
3. Capability responses SHALL include a timestamp and source image so users can identify stale executor state.
4. The implementation SHALL add tests for real, native, and mock mode capability documents.

