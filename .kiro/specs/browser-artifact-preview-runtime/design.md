# Design Document: Browser Artifact Preview Runtime

## Overview

This spec connects Docker execution to visible evidence. It builds on:

- `docker-executor-capabilities-contract`
- `cube-ai-agent-sandbox-image`
- existing mission artifact routes
- existing executor callback events

Minimal closed loop:

```text
Autopilot command
  -> browser job payload
  -> requiredCapabilities
  -> cube-ai-agent-sandbox Playwright script
  -> screenshot/html/log artifacts
  -> artifact manifest
  -> server preview route
  -> task/autopilot UI preview
```

## Browser Payload

Example:

```json
{
  "requiredCapabilities": ["browser.playwright", "browser.chromium", "artifact.image", "artifact.html"],
  "browserTask": {
    "url": "http://localhost:3000/projects",
    "viewport": { "width": 1440, "height": 900 },
    "waitUntil": "networkidle",
    "timeoutMs": 30000,
    "capture": {
      "screenshot": true,
      "html": true,
      "console": true,
      "metrics": true
    }
  }
}
```

## Artifact Manifest

```json
{
  "version": "2026-05-04",
  "artifacts": [
    {
      "id": "page-screenshot",
      "kind": "image",
      "name": "page-screenshot.png",
      "path": "artifacts/page-screenshot.png",
      "mimeType": "image/png",
      "previewType": "image",
      "description": "Full page browser screenshot"
    },
    {
      "id": "page-html",
      "kind": "file",
      "name": "page.html",
      "path": "artifacts/page.html",
      "mimeType": "text/html",
      "previewType": "html"
    }
  ]
}
```

## Executor Changes

- Browser jobs may run through the AI bridge or a deterministic browser runner script.
- Prefer deterministic script for MVP so screenshots are reliable.
- DockerRunner should collect manifest metadata when present.
- Callback events may include a compact artifact summary.

## Server Preview Strategy

Existing artifact routes already support basic download and preview behavior. Extend carefully:

- Text/JSON/log: return safe text preview with truncation.
- Image: return file with correct content type.
- HTML: serve in sandboxed preview route or return sanitized/safe iframe URL.
- PDF: serve with content type and inline disposition where safe.

## UI Strategy

Default task detail UI:

- Artifact list grouped by type.
- Screenshot preview first for browser jobs.
- Logs remain available but are not the primary evidence.
- Artifact preview stays scoped by mission/project.

## Risks

- HTML previews can introduce security issues; use safe headers and avoid executing untrusted scripts in main app context.
- Browser jobs against localhost require correct network routing from container to host.
- Screenshot results can vary due to font and viewport differences.
- Large artifacts need preview size limits.

