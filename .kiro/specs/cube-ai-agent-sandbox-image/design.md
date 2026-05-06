# Design Document: Cube AI Agent Sandbox Image

## Overview

This spec creates a stronger Docker image for real AI Agent workloads. The new image complements the existing `Dockerfile.ai`; it should not remove the existing image until downstream jobs have migrated.

```text
Dockerfile.ai
  -> baseline AI bridge image

Dockerfile.agent
  -> AI bridge
  -> browser automation
  -> document conversion
  -> media/image tools
  -> capability self-check
```

## Proposed Image Contents

Base:

```text
node:20-bookworm-slim or node:20-slim
```

Core packages:

```text
python3 python3-pip python3-venv
curl wget git jq ca-certificates
build-essential
fontconfig fonts-noto-cjk
```

Node tools:

```text
pnpm
tsx
openai
@langchain/core
langchain
playwright
```

Document/media tools:

```text
chromium or Playwright-managed Chromium
libreoffice
pandoc
ffmpeg
imagemagick
```

Python tools:

```text
uv
requests
pandas
beautifulsoup4
```

## Capability Manifest

The image should ship:

```text
/opt/cube-agent/capabilities.json
/opt/cube-agent/self-check.js
/opt/cube-agent/self-check.py
```

Example:

```json
{
  "image": "cube-ai-agent-sandbox:latest",
  "capabilities": [
    "node",
    "python",
    "ai.llm",
    "browser.playwright",
    "browser.chromium",
    "document.libreoffice",
    "document.pandoc",
    "media.ffmpeg",
    "image.imagemagick",
    "artifact.html",
    "artifact.pdf",
    "artifact.image",
    "preview.html",
    "preview.pdf",
    "preview.image"
  ]
}
```

## Build Strategy

Recommended commands:

```powershell
docker build -f services/lobster-executor/Dockerfile.agent -t cube-ai-agent-sandbox:latest services/lobster-executor
```

The build context should remain small. The Dockerfile should copy only `ai-bridge/` and image self-check assets, not the entire repository.

## Smoke Strategy

The smoke should run the image and verify:

1. `node --version`
2. `python --version`
3. `pnpm --version`
4. Playwright can launch Chromium headlessly.
5. Screenshot artifact is created.
6. Pandoc or LibreOffice command is available.
7. `ffmpeg -version` works.
8. ImageMagick command is available.

## Risks

- Image size may grow quickly; keep this as one strong image first, then split later if needed.
- Playwright browser dependencies can be fragile across base images.
- Some packages may require mirrors in mainland China; build scripts should be explicit and retry-friendly.
- LibreOffice in slim images may need fonts and extra libraries for correct Chinese rendering.

