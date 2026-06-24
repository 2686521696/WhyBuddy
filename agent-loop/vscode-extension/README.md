<p align="center">
  <img src="media/sliderule-brand.png" alt="SlideRule.ai 计算规则" width="720" />
</p>

# AgentLoop Dashboard

AgentLoop Dashboard is the VS Code control panel for SlideRule migration work. It shows the active task queue, run status, gate evidence, review rounds, diff evidence, and queue landing status in one workspace-native view.

## What It Shows

- Current AgentLoop task queue and attention lanes.
- Active run details, including gate output, latest agent output, and run events.
- Reviewed queue changes that are ready to preview and land back to `main`.

## Usage

Open the AgentLoop activity bar entry in a workspace that contains `agent-loop/package.json`, then use **Run Queue** or **Open Dashboard** from the view title commands.

## Settings Operator Runbook

Non-secret workspace settings (configured under `agentLoop.*` keys via VS Code settings UI or .vscode/settings.json) vs SecretStorage keys:

- Non-secret workspace settings include pollIntervalMs, queuePath, openDashboardOnRun, fixAgent, reviewAgent, fixModel, reviewModel, workerMaxTurns, workerMaxRetries, worktreeScope, baseUrl, injectKeysToWorker, activeProfile. These control CLI worker selection, queue defaults, profile activation, and related behavior.
- LLM keys (grokApiKey, openaiApiKey, anthropicApiKey) and any key-like fields are stored exclusively through SecretStorage. Code paths (sanitizeSettingsForSave and callers) exclude them from workspace configuration and never persist raw values to files or queue documents.

Provider health checks, CLI checks, and diagnostics export:

- Provider health (testProviderHealth) returns status 'skipped' and reason 'missing key' when no secret is present for the provider; otherwise runs a models endpoint probe (honoring baseUrl override when set) and reports status, durationMs, and a sanitized reason. No key material is included in results or logs.
- CLI checks (testWorkerCliHealth) attempt to spawn the worker command (grok or codex, platform default binary) with --version under a short timeout and return status (ok/failed/skipped/timeout), durationMs, and redacted reason (secrets and long output fragments are sanitized).
- Diagnostics export (triggered by getDiagnostics) assembles effectiveConfig (merged from package defaults and workspace via getEffectiveConfig), configSources, keys (status only: 'configured' or ''), queuePath, repoRoot, last run state, providerHealth cache, and warnings. The payload is redacted before being sent to the webview.

Queue defaults preview/apply protects task arrays and secrets:

- previewQueueDefaults performs a read-only dry-run: it returns before/after/diff for only supported queue default keys; workerEnv and unknown keys are rejected (redacted error); the queue file is never written.
- applyQueueDefaults applies the same supported-key and secret-like value rejection. When writing it updates only the defaults object, always preserves the original tasks array (explicit copy before update + mandatory pre-write and post-write validation that tasks array is unchanged), and rolls back by restoring the original file content on any JSON parse, write, or validation failure.
- This ensures task arrays and any embedded non-defaults (including secrets sections) are left intact unless explicitly outside the supported defaults surface.

CLI workers are configured via non-secret keys (fixAgent, reviewAgent) or queue defaults / active profiles (non-secret profile fields only).

Safe export (createSettingsExport) emits schemaVersion, activeProfile, a copy of nonSensitive settings, and a keys status map only. Safe import (validateAndPrepareSettingsImport) requires matching schemaVersion and rejects any secret-looking raw values or keys.
