# Design Document: Docker Live Preview Workstation

## Overview

Live Preview Workstation makes Docker execution observable while the job is running.

Possible preview modes:

```text
browser screenshot stream
browser VNC/noVNC
terminal/log stream
session replay
```

MVP should start with screenshot stream and terminal/log stream. noVNC can follow once security and lifecycle cleanup are stable.

## Architecture

```text
job requests livePreview
  -> executor creates preview session
  -> container starts browser/terminal with preview adapter
  -> preview events or stream go to server
  -> frontend opens project-scoped preview panel
  -> completion stores replay artifacts
```

## Preview Session

```ts
interface PreviewSession {
  id: string;
  projectId?: string;
  missionId: string;
  jobId: string;
  type: "browser-screenshot-stream" | "browser-vnc" | "terminal-stream";
  status: "starting" | "running" | "stopped" | "failed";
  startedAt: string;
  stoppedAt?: string;
  url?: string;
  artifacts?: string[];
}
```

## Transport Options

### Screenshot Stream

- Container periodically writes screenshots.
- Executor emits `job.screenshot` events or stores image artifacts.
- Frontend shows latest frame.
- Lowest complexity and safest first step.

### Terminal Stream

- Existing log batcher already emits `job.log`.
- Add optional live terminal panel using existing socket/event path.
- Use stored `executor.log` as fallback.

### noVNC

- Requires Xvfb, VNC server, noVNC/websockify.
- Requires controlled port exposure and server proxy.
- Should be P2 inside this spec, not the first slice.

## noVNC Go/No-Go Note

Current MVP decision: **no-go for production noVNC in this slice**.

The accepted slice is screenshot stream plus terminal/log stream because it keeps the
preview channel inside the existing executor callback/socket/artifact path and does
not expose container ports. Production noVNC should move to a follow-up slice after
these prerequisites are designed and tested:

- The strong sandbox image includes Xvfb, a VNC server, noVNC, and websockify.
- The server owns a mission-scoped preview proxy with authorization checks.
- The executor never publishes arbitrary container ports directly to the host or public network.
- The proxy has explicit session timeout, close, cancellation, and cleanup behavior.
- Replay artifacts and terminal logs continue to work when the VNC channel is unavailable.

Recommended next action: prototype Xvfb + VNC + noVNC inside the strong image only
after the Live Preview MVP is stable under Docker real-mode smoke and UI fallback
tests.

## Cleanup

Preview sessions must close when:

- job completed
- job failed
- job cancelled
- timeout
- container cleanup fails
- user explicitly closes session

## Security

- No direct public container port exposure.
- Preview URL should be server-proxied and mission-scoped.
- Secrets must be scrubbed from terminal streams.
- Preview artifacts should inherit project/mission access control.

## Risks

- noVNC adds substantial complexity and attack surface.
- Streaming screenshots can create high storage or bandwidth use.
- Windows Docker networking may need separate handling.
