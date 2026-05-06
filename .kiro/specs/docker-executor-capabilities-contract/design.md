# Design Document: Docker Executor Capabilities Contract

## Overview

This design turns `lobster-executor` from a generic command runner into a capability-aware executor. It does not replace `DockerRunner`, `NativeRunner`, or `MockRunner`; it adds a capability contract around them.

Current runtime baseline:

- `LOBSTER_EXECUTION_MODE=real` uses DockerRunner when Docker is available.
- `real` falls back to NativeRunner when Docker daemon is unavailable.
- `mock` uses MockRunner for tests and demos.
- `/health` already exposes queue, docker status, and a small feature matrix.

New runtime contract:

```text
server route planner
  -> ExecutorClient.getCapabilities()
  -> compare job.requiredCapabilities
  -> dispatch job only when supported
  -> surface mismatch to mission/autopilot UI
```

## Capability Document

The executor returns:

```ts
interface ExecutorCapabilitiesResponse {
  ok: true;
  executor: "lobster";
  service: string;
  version: string;
  timestamp: string;
  mode: "mock" | "native" | "real";
  docker: {
    status: "connected" | "disconnected";
    lifecycle: boolean;
    host?: string;
  };
  image: {
    defaultImage: string;
    aiImage: string;
    activeImage?: string;
  };
  capabilities: string[];
  artifactTypes: string[];
  previewTypes: string[];
  limits: {
    memory: string;
    cpus: string;
    pids: number;
    timeoutMs: number;
    maxConcurrentJobs: number;
  };
  warnings: string[];
}
```

## Capability Vocabulary

Initial canonical names:

```text
runtime.docker
runtime.native
runtime.mock
executor.cancel
executor.pause
executor.resume
executor.callback.hmac
security.readonly-rootfs
security.no-new-privileges
security.resource-limits
node
python
ai.llm
artifact.file
artifact.log
artifact.json
artifact.html
artifact.pdf
artifact.image
preview.text
preview.json
preview.html
preview.pdf
preview.image
browser.playwright
browser.chromium
document.libreoffice
document.pandoc
media.ffmpeg
image.imagemagick
```

Only a subset is supported at first. Unsupported future capabilities should be visible in tests and in rejection errors.

## Integration Points

- `shared/executor/contracts.ts`: add type constants for capability names and optional `requiredCapabilities` helper types.
- `services/lobster-executor/src/types.ts`: add capability response types.
- `services/lobster-executor/src/app.ts`: add `GET /api/executor/capabilities`; enrich `/health`.
- `services/lobster-executor/src/service.ts`: expose runner mode and queue limits.
- `server/core/executor-client.ts`: add `getCapabilities()` and optional validation helper.
- UI surfaces may consume server-projected capability mismatch later; this spec only requires compact status plumbing.

## Capability Resolution Rules

`mock` mode:

- Supports `runtime.mock`, basic executor lifecycle events, text/log/json artifacts.
- Does not support Docker-only features.

`native` mode:

- Supports `runtime.native`, `node` if current process is Node, basic command execution, text/log/json artifacts.
- Does not claim container isolation.

`real` mode with Docker connected:

- Supports `runtime.docker`, Docker lifecycle, security resource limits, log/json/file artifacts.
- Browser/document/media capabilities are only claimed when the active image manifest or built-in probe confirms them.

## Rejection Shape

When unsupported capabilities are required:

```json
{
  "ok": false,
  "error": "Executor does not support required capabilities: browser.playwright",
  "code": "EXECUTOR_CAPABILITY_UNSUPPORTED",
  "unsupportedCapabilities": ["browser.playwright"],
  "supportedCapabilities": ["runtime.docker", "node", "python"],
  "hint": "Use cube-ai-agent-sandbox image or remove browser requirements."
}
```

## Risks

- Overclaiming capabilities is worse than underclaiming; default to conservative support.
- Capability names should remain stable once used by route planner.
- Docker network whitelist and seccomp support should be described as configured capabilities, not assumed full enforcement unless verified.

