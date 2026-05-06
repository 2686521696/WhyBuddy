# Design Document: Skill-aware Agent Sandbox

## Overview

This design introduces skills as portable execution units for the Docker Agent Sandbox.

```text
Skill manifest
  -> registry
  -> planner capability matching
  -> job payload skillRef
  -> executor injects skill
  -> container runs skill
  -> artifacts/logs/evidence flow back
```

## Skill Manifest Shape

```json
{
  "name": "browser-research",
  "version": "0.1.0",
  "description": "Open pages, capture screenshots, and produce a browser evidence report.",
  "capabilities": ["browser.playwright", "artifact.html", "artifact.image"],
  "runtime": "node",
  "entrypoint": "run.js",
  "inputs": {
    "schema": "input.schema.json"
  },
  "outputs": {
    "artifacts": ["screenshot.png", "page.html", "report.json"]
  },
  "security": {
    "network": "required",
    "filesystem": "workspace",
    "credentials": []
  }
}
```

## Registry

Initial registry can be local-only:

```text
skills/
  browser-research/
    skill.json
    run.js
  document-render/
    skill.json
    run.js
```

Server loads manifests, validates them, and builds:

- by name
- by capability
- by runtime
- by enabled/disabled state

## Job Payload

```json
{
  "requiredCapabilities": ["browser.playwright", "artifact.image"],
  "skillRef": {
    "name": "browser-research",
    "version": "0.1.0"
  },
  "skillInput": {
    "url": "https://example.com"
  }
}
```

## Executor Injection

MVP options:

1. Copy skill directory into job workspace before container start.
2. Bind mount a read-only skill directory into `/opt/cube-skills/<name>`.
3. Run `node /opt/cube-skills/<name>/run.js /workspace/skill-input.json`.

Prefer read-only mount for skill code and writable `/workspace/artifacts` for outputs.

## Governance

Skill manifest security hints should be compared against:

- executor security level
- required capabilities
- network policy
- credential injection policy

## Risks

- Skill execution is arbitrary code; treat manifests as declarations, not guarantees.
- Registry should not execute code during discovery.
- Versioning and updates can become complex; MVP should keep local static skills.

