# AgentLoop Release Runbook (SlideRule 109)

**Status**: Bridge rescue phase (109). This is the operator runbook for the merged SlideRule + AgentLoop bridge after the 108 Grok 403 halt.

**Important**: 109 is a bridge rescue phase. The Node runner remains present and is still the execution owner for queue and worker processes. Python provides the control plane (APIs, settings, run inspection). Do not assume Node runner removal or full production cutover.

## Startup

Start the SlideRule Python backend (control plane):

```bash
cd tws-ai-slide-rule-python
python -m uvicorn app:app --port 9700 --reload
```

Or without reload:
```bash
python -m uvicorn app:app --port 9700
```

- Port defaults to 9700 (configurable via PORT or settings).
- Node side typically points via PYTHON_SLIDE_RULE_BASE_URL=http://localhost:9700 (plus internal key).
- Health check: GET /health (root) or /api/agent-loop/health

The Node AgentLoop runner (scripts/run-queue.mjs, src/loop.js) is started via the bridge or directly for execution. It continues to own the worker loop.

## API Routes (Control Plane)

Base: /api/agent-loop (mounted on the Python FastAPI app)

- `GET /api/agent-loop/health` - returns status, backend: "sliderule-python", mode: "bridge"
- `GET /api/agent-loop/capabilities` - lists features; marks "workerExecution": "bridged", "controlPlane": "python"
- `GET /api/agent-loop/provider-health` - provider + CLI health (grok/openai/anthropic ready/missing/skipped; grok/codex CLI path+version). Redacted, no keys.
- `GET /api/agent-loop/runs/overview` - list run summaries (newest first). Returns [] for empty/missing.
- `GET /api/agent-loop/runs/{run_id}` - run detail (state, artifacts, bounded logs/reports). 404 if missing.
- `GET /api/agent-loop/runs/{run_id}/events/stream` - SSE stream of normalized event snapshots (finite snapshot for bridge).
- `GET /api/agent-loop/runs` - alias to overview.
- `GET /api/agent-loop/settings` - effective non-secret settings + secret configured status only (keys redacted; never raw values).
- `POST /api/agent-loop/settings` - save non-secrets only. Rejects secret-like keys and invalid enums.
- `POST /api/agent-loop/queue/run` - start queue run (or --only task). Supports dryRun. Validates task/queue paths.
- `POST /api/agent-loop/task/run` - single task run (uses loop.js directly).
- `POST /api/agent-loop/rerun` - rerun a task (bridge maps to queue-style).
- `POST /api/agent-loop/cancel` - placeholder "queued-cancel" (no process kill in bridge).
- `GET /api/agent-loop/dashboard` - serves python-owned dashboard shell (static from static/agent-loop/).
- `GET /api/agent-loop/agent-loop-dashboard.js` - companion JS (fetches overview).

Also available (from full SlideRule):
- `/api/sliderule/*` for V5 sessions, orchestrate-plan, execute-capability, drive-full, etc.
- `GET /health`

All routes use redaction for sensitive data. Never return raw env or secrets.

## Queue Execution

Python bridge constructs commands for the existing Node runner:

- Queue mode (default): uses `agent-loop/scripts/run-queue.mjs [--only <task>]`
- Single task: uses `agent-loop/src/loop.js --task <task> --timeout-ms ... --cwd ...`
- Bridge settings in config/settings.py (AGENT_LOOP_*): AGENT_LOOP_ROOT, AGENT_LOOP_RUN_QUEUE, AGENT_LOOP_LOOP_SCRIPT, AGENT_LOOP_NODE_COMMAND, AGENT_LOOP_DEFAULT_TIMEOUT_MS, AGENT_LOOP_BRIDGE_DRY_RUN.
- Dry-run supported at API level: returns the redacted command without spawning.
- Real execution uses subprocess in Node context; Node remains the owner of queue scheduling, worker spawn, worktree mutation, and gate execution.
- Env overrides passed safely (redacted in receipts).
- Task ids accept .md task files or identifiers (validated, no path traversal).

Example via curl (dry-run):
```bash
curl -X POST http://localhost:9700/api/agent-loop/queue/run \
  -H "Content-Type: application/json" \
  -d '{"task": "agent-loop/tasks/example.md", "mode": "queue", "dryRun": true}'
```

Run receipts are redacted (command shown sanitized, no secrets).

## Settings

- Managed via `/api/agent-loop/settings`.
- Non-secret only: fixAgent, reviewAgent, workerMaxTurns, workerMaxRetries, queuePath, worktreeScope, baseUrl, injectKeysToWorker, activeProfile, etc.
- Stored in data/agent-loop-settings.json (or AGENT_LOOP_SETTINGS_FILE override).
- Defaults defined in services/agent_loop_settings.py.
- Secrets (API keys, tokens): never written by this API. Use env or secure store only. /settings reports only "configured" status.
- Validation: enums (fixAgent: grok/codex; etc.) enforced; invalid -> 400.
- Load merges file + env (non-secrets).

View:
```bash
curl http://localhost:9700/api/agent-loop/settings
```

Update non-secrets only (example):
```bash
curl -X POST http://localhost:9700/api/agent-loop/settings \
  -H "Content-Type: application/json" \
  -d '{"fixAgent": "grok", "workerMaxTurns": 64}'
```

## Provider Health

- `GET /api/agent-loop/provider-health`
- Classifies: grok, openai, anthropic (ready if key present via secret status, else missing/skipped/failed).
- CLI (grok/codex): uses which + --version; includes commandPath and version when present.
- Proxy status separate (non-fatal, usually skipped).
- Output always redacted (no key values). Cacheable (?force to refresh in supported impl).
- Non-fatal for missing optionals.

Useful for pre-run checks before queue execution.

## Run Inspection

- Overview: `/api/agent-loop/runs/overview` or `/runs`
- Detail: `/api/agent-loop/runs/{run_id}` (includes state, artifacts list, bounded stdout/stderr/reports)
- Stream: `/api/agent-loop/runs/{run_id}/events/stream` (SSE)
- Runs stored under agent-loop runs dir (state.json, artifacts, logs). Empty dirs return [] gracefully.
- Corrupt records degrade to safe placeholders without dropping the list.
- Dashboard shell at `/api/agent-loop/dashboard` (fetches overview, no VS Code dependency for the shell).

Inspect via API or the served dashboard. Artifacts use relative safe names only.

## v2 SSOT Replay Path (110 readiness)
The v2 SSOT replay path uses the append-only runtime event log as the single source of truth. See AGENT_LOOP_V2_RUNTIME_SSOT.md.
Read APIs: GET /api/agent-loop/runs/{run_id}/events (initial replay) and /events/stream (SSE incremental).
Fallback to legacy artifact adapter is used for 108/109 runs to emit synthetic v2 events.
Web route verification: the /api/agent-loop/runs/* endpoints support replay-driven UI without polling raw artifacts as primary.
This keeps the Node runner bridge caveat: the Node runner remains the execution owner for queue, workers, and mutation; Python control plane adds replay, projections, and read APIs.
108/109 compatibility is retained.

## Security

- No raw secret storage or documentation of writing keys via runbook/APIs.
- All settings writes are sanitized: secret-like keys (containing apikey/secret/token/password/...) are skipped.
- Command receipts, stdout/stderr, health, and settings responses are redacted via central redaction helpers.
- Path validation on task/queue: rejects .. , absolute starts, drive letters for queue; length and null checks for task.
- Mode validation (queue/single/rerun/task/dry-run only).
- Internal key auth on some SlideRule endpoints (SLIDE_RULE_INTERNAL_KEY).
- CORS open for dev (adjust in prod).
- Never return full env, abs FS paths, or unredacted artifacts from control plane.
- Bridge does not perform process kill on cancel (explicit queued-cancel).

Follow Node AgentLoop security for the runner side (still owned by Node).

## Rollback

During bridge rescue phase (109), rollback to pure-Node is simple because Node runner ownership is retained:

1. Stop the Python control plane (if running).
2. Use Node AgentLoop directly:
   - `cd agent-loop`
   - `node scripts/run-queue.mjs --only <task>` or equivalent entry (see agent-loop docs and package.json scripts).
   - Or use the original VS Code extension / CLI flows that target the Node runner.
3. Point any clients back to direct Node endpoints (remove or ignore PYTHON_SLIDE_RULE_BASE_URL).
4. If settings were changed via Python, they are non-secrets only and stored in JSON; Node defaults or its config continue to apply for execution.
5. Provider keys remain in env / secure stores; no change.
6. Runs/artifacts written by Node runner remain readable (Python readers are additive, non-destructive).

The Python side is additive control plane + delegation target. No destructive cutover in 109. Full switch would be future waves beyond bridge.

If issues after Python start:
- Revert PYTHON_* env on Node side.
- Restart only Node runner paths.
- Python can be left running harmlessly (it does not mutate worker execution).

## Troubleshooting

- "missing marker" or gate fails on docs: ensure AGENT_LOOP_RUNBOOK.md and the 109 test exist with required phrases.
- Provider health shows missing: check env for keys (do not store in runbook).
- Queue dry-run works but real fails: ensure Node is present and in PATH; check cwd for agent-loop dir.
- Run not found: confirm runId matches state dir under agent-loop runs (Node side).
- 400 on queue: validate task id (no ..) and queue path (must look like json/queue/script).
- Settings POST 400: check enums or secret-like keys in payload.
- SSE or dashboard empty: normal for no runs yet; overview always succeeds with [].
- Port conflict: use PORT=... or --port flag.
- Bridge mode confirmed: /api/agent-loop/capabilities shows "bridge": true, "workerExecution": "bridged".

For deeper: see AGENT_LOOP_RUNTIME_BOUNDARY.md, AGENT_LOOP_INTEGRATION_INVENTORY.md, services/agent_loop_*.py, routes/agent_loop.py.

## References

- task: agent-loop/tasks/sliderule-agentloop-release-runbook-109.md
- test: tws-ai-slide-rule-python/tests/test_agent_loop_release_runbook.py
- Python app: tws-ai-slide-rule-python/app.py, routes/agent_loop.py, config/settings.py
- Bridge: services/agent_loop_bridge.py, agent_loop_settings.py, agent_loop_provider_health.py, agent_loop_runs.py
- Node remains: agent-loop/scripts/run-queue.mjs, agent-loop/src/loop.js (execution owner)

This runbook is for the 109 bridge rescue. Node runner is still present.
