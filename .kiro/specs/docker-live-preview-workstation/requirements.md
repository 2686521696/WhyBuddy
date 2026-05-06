# Requirements Document: Docker Live Preview Workstation

## Introduction

Playwright 截图和 artifact 预览可以证明 Agent 真实执行，但用户如果要“看到 Agent 正在操作”，还需要 live preview 工作舱。本 spec 定义 Docker Live Preview Workstation：容器内浏览器或终端可以实时回显，前端按 mission/session 展示预览，执行过程可被记录和回放。

这是 Docker V2 的 P3 阶段，复杂度高，应在能力契约、强镜像、浏览器 artifact 闭环和 skill-aware sandbox 稳定后执行。

## Requirements

### Requirement 1: Preview Session Model

**User Story:** 作为自动驾驶用户，我需要知道当前执行 session 是否支持实时预览。

#### Acceptance Criteria

1. THE executor SHALL create a preview session only for jobs that request live preview.
2. THE session SHALL have id, missionId, jobId, status, startedAt, stoppedAt, and preview type.
3. THE session SHALL be scoped to the current project and mission.
4. THE session SHALL expire when the job completes, fails, cancels, or times out.

### Requirement 2: Browser Live Preview

**User Story:** 作为用户，我希望看到 Agent 在容器里打开浏览器执行任务。

#### Acceptance Criteria

1. THE image/runtime SHALL support Xvfb or an equivalent virtual display.
2. THE runtime SHALL expose browser visual output through a controlled preview channel.
3. THE preview SHALL not expose arbitrary container ports to the public network.
4. THE user SHALL be able to open and close preview without interrupting the job.

### Requirement 3: Terminal Live Preview

**User Story:** 作为高级用户，我希望看到执行日志和终端输出的实时流。

#### Acceptance Criteria

1. THE executor SHALL provide a terminal/log stream for live jobs.
2. THE stream SHALL include stdout, stderr, and lifecycle messages.
3. THE stream SHALL redact known secrets.
4. THE stream SHALL degrade gracefully to stored logs when live stream is unavailable.

### Requirement 4: Session Replay

**User Story:** 作为复盘用户，我希望任务结束后仍能查看执行过程的关键片段。

#### Acceptance Criteria

1. THE runtime SHALL save periodic screenshots or key frames for browser sessions.
2. THE runtime SHALL save terminal/log stream segments.
3. THE server SHALL expose replay artifacts under the mission.
4. THE replay SHALL respect project ownership and access boundaries.

### Requirement 5: Resource and Security Controls

**User Story:** 作为运维者，我需要 live preview 不破坏沙箱安全和资源稳定性。

#### Acceptance Criteria

1. THE executor SHALL enforce timeout, memory, CPU, and port restrictions for preview sessions.
2. THE preview channel SHALL require server-side authorization.
3. THE preview session SHALL be closed during job cancellation and cleanup.
4. THE runtime SHALL log preview lifecycle events for audit.

