# AgentLoop Integration Inventory (SlideRule Wave 108)

## Purpose
Document the exact current AgentLoop and SlideRule Python boundaries before merging product ownership.

The 108 wave merges AgentLoop into `tws-ai-slide-rule-python` using a Python control plane and the existing Node AgentLoop runner as an internal worker bridge. This inventory prevents blind migration by cataloguing the source system and target seams.

**This wave only inventories.** No runtime code moved, no queue execution logic edited, Python does not own AgentLoop execution yet.

## Explicit Worker-Owned for This Wave
- `agent-loop/src/runQueue.js` — remains worker-owned (queue resolution, gate command templating including pythonExe, queue runner support).
- `agent-loop/src/loopEngine.js` — remains worker-owned (core execution engine, state transitions, agent fix/review orchestration, budget, gate loop).

Python control plane will treat the Node runner/queue/engine as an internal worker bridge in future waves. These two modules stay under Node for this wave.

## Current Boundaries Inventory

### Node Runner
- **Current location**: `agent-loop/src/loop.js` (main entry + artifact setup), `agent-loop/src/loopEngine.js` (runLoop), `agent-loop/src/index.js`, `agent-loop/src/loopArgs.js`, `agent-loop/src/commands.js`.
- **Responsibilities**: CLI orchestration, worktree + state init, gate-before/after, Grok/Codex spawn coordination via connectors, diff capture, progress, report generation.
- **Target Python modules (control-plane concern ownership)**: `services/agent_loop_runtime.py`, `services/task_lifecycle_runtime.py`, `services/workflow_runtime.py` (future Python-driven loop head and orchestration entrypoints); `sliderule_llm/` components for planning/LLM parts of control.

### Queue Config
- **Current location**: `agent-loop/scripts/migration-queue.json` (defaults incl. pythonExe, gates arrays, per-set gates), `agent-loop/scripts/run-queue.mjs` (queue driver), `agent-loop/src/runQueue.js` (defaultPythonExe, resolveQueueGate, resolveQueueGates, queue outcomes helpers), `agent-loop/scripts/loop-apply.mjs`.
- **Features**: worktree scoping, autoFix, guardTests, maxIterations, lang, timeout, workerEnv, real*Gates sets for different slices.
- **Target Python modules**: `services/queue_runtime.py` (Python queue coordinator), `config/settings.py` (extend for queue/loop config + python exe resolution), `services/task_scheduler_runtime_takeover.py` patterns.

### Run State
- **Current location**: `agent-loop/src/stateMachine.js`, `agent-loop/src/runSummary.js`, `agent-loop/src/runQueueProgress.js`, `agent-loop/src/loopProgress.js`, `agent-loop/src/list-runs.js`, `agent-loop/src/listRuns*.js`.
- **Artifacts**: `.agent-loop/runs/<runId>/state.json` (every transition), `latest/state.json`, runId (UTC), summary records.
- **Target Python modules**: `models/agent_loop_state.py` (new or extend `models/v5_state.py`, `models/blueprint_state.py`), `services/state_store.py`, `services/persistence.py`, `services/task_lifecycle_runtime.py`.

### Artifacts
- **Current location**: Written in `agent-loop/src/loop.js` (writeArtifact/append both runDir + latest), `agent-loop/src/loopReport.js`, `agent-loop/src/report.js`, `agent-loop/src/diff.js`, `agent-loop/src/loopApply.js`.
- **Types**: grok-request.*.md, grok-output.*.json, codex-*.json, diff.*.patch, final-report.md, verification.*.log, state.json, raw stdout/stderr per gate.
- **Target Python modules**: `services/artifact_memory.py` (pattern from `services/blueprint_artifact_memory.py`), `services/audit_sink.py`, `services/telemetry.py`.

### Logs
- **Current location**: `agent-loop/src/runProcess.js` (spawn + capture stdout/stderr/exitCode), `agent-loop/src/gates.js` (evaluateGate, record raw + structured), `agent-loop/src/agentFailure.js`, probes/, vscode activeLog.
- **Target Python modules**: `services/telemetry.py`, `services/telemetry_runtime.py`, `services/audit_sink.py`, `services/mission_event_replay.py`, `services/audit_retention_export.py`.

### Settings
- **Current location**: `agent-loop/src/loopArgs.js`, `agent-loop/src/indexArgs.js`, `agent-loop/src/agentRoles.js` (fix/review/skip roles), `agent-loop/scripts/migration-queue.json` defaults, `agent-loop/vscode-extension/src/settingsConfig.ts`, `agent-loop/vscode-extension/src/settingsMessages.ts`, described `agent-loop.config.json`.
- **Target Python modules**: `config/settings.py` (primary, see existing CONFIG keys + extend), `services/runtime_config_boundary.py` patterns, `services/permission_*` for future authz on controls.

### Dashboard
- **Current location**: `agent-loop/vscode-extension/src/` (dashboardPanel.ts, runController.ts, stateMonitor.ts, stateReader.ts, gateSummary.ts, runSummary.ts, treeProviders.ts), `src/dashboard-react/`, media/, out/ compiled JS.
- **Provides**: run tree view, gate progress, active logs, phase labels, settings UI, final report rendering.
- **Target Python modules**: `services/agent_loop_dashboard.py` (future headless data provider), routes under `routes/` (e.g. `routes/agent_loop.py` or extend `routes/sliderule.py`), exposed for dashboard clients or Python-native UI. Dashboard rendering currently stays in VS Code extension.

### VS Code-only Pieces
- **Current location**: Entire `agent-loop/vscode-extension/` (extension.ts, package.json, *.vsix files, src/*.ts, dashboard UI bundle).
- **Scope**: Tree data providers, panel webviews, VS Code commands, agent probing, local paths, no involvement in core CLI loop execution.
- **Target Python modules**: None (these are purely client/VS Code shell). Python control plane will be callable from extension (via process spawn of Python scripts or future HTTP/MCP endpoints from `app.py` / services). Keep VS Code layer separate from Python control ownership.

## Additional Cross-Cutting (Node side, bridge targets)
- Worktree lifecycle / isolation: `agent-loop/src/worktree.js` (create, checkpoint, restore, cleanup).
- Gate runner + progress: `agent-loop/src/gates.js`, `agent-loop/src/gateProgress.js`, `agent-loop/src/diffGuard.js`.
- Agent connectors + parsers: `agent-loop/src/agentProcess.js`, `agent-loop/src/resolveAgents.js`, `agent-loop/src/reviewParser.js`, `agent-loop/src/grokPrompt.js`.
- Smoke / probe helpers and queue outcomes: `agent-loop/scripts/smoke-*.mjs`, `agent-loop/src/queueOutcomes.js`.

Future Python control plane concerns (orchestration, queue driving, state projection, artifact mgmt, settings resolution for runs) will be owned in `tws-ai-slide-rule-python/services/` + supporting `config/`, `models/`, and `sliderule_llm/` where LLM control intersects. Node `runQueue.js` + `loopEngine.js` + runner CLI remain the execution worker bridge.

## References
- `agent-loop/agent_loop_v1.md`
- `agent-loop/tasks/sliderule-agentloop-integration-inventory-108.md`
- `tws-ai-slide-rule-python/tests/test_agent_loop_integration_inventory.py`
- Python patterns: `services/task_lifecycle_runtime.py`, `services/slide_rule_orchestrator.py`, `config/settings.py`, `services/persistence.py`

Wave 108 scope: inventory + marker test only. Ownership transfer and bridge wiring are later waves.
