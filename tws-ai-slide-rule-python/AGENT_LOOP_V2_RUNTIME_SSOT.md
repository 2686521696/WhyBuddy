# AgentLoop v2 Runtime SSOT Architecture

**Status**: 110 planning anchor.

**Goal**: Make AgentLoop runtime state deterministic by moving the product UI and Python control plane onto one event-sourced source of truth while the Node runner remains the mutation owner during the bridge phase.

**Boundary reminder**: v2 does not remove the Node runner in one jump. Node still owns queue execution, worker spawning, worktree mutation, gates, diffs, and final reports until a later runner rewrite. Python owns the product control plane, read APIs, settings, path safety, redaction, dashboard shell, and runtime projections.

## Problem Statement

AgentLoop currently has several competing truth surfaces:

- Node runner memory while a queue is active.
- `.agent-loop/runs/<runId>/state.json`.
- `.agent-loop/runs/<runId>/events.jsonl`.
- Grok and Codex stdout/stderr artifacts.
- Queue landing summaries.
- Dashboard snapshots built by polling and log selection.

This creates visible failure modes:

- Flow panels flicker because the UI rebuilds from changing snapshots.
- Done tasks can appear stale because queue completion and UI refresh are not one committed event.
- Active agent output can jump between log candidates.
- Python and Web readers must infer state from artifacts instead of replaying one event stream.

## v2 Principle

The append-only runtime event log is the single source of truth. `state.json`, queue summaries, flow graphs, detail panes, and dashboard counters are derived projections that can be rebuilt from events.

No product state transition is authoritative unless it is represented as a normalized event.

## System Diagram

```text
                          +------------------------------+
                          |        Web Console           |
                          |  /AgentLoop React + AntD     |
                          |  flow, detail, settings      |
                          +---------------+--------------+
                                          |
                                          | SSE or WebSocket
                                          v
                    +--------------------------------------------+
                    |       Python Runtime Gateway               |
                    |  FastAPI routes, settings, redaction       |
                    |  safe paths, snapshots, event stream       |
                    +---------+----------------------+-----------+
                              |                      |
                              | starts/reads         | reads/writes projections
                              v                      v
              +-----------------------------+   +-----------------------------+
              |      Node Orchestrator      |   |      Projection Store       |
              |  run-queue.mjs / loop.js    |   |  state.json, indexes, UI    |
              |  gates, diffs, reports      |   |  snapshots, artifact index  |
              +--------------+--------------+   +--------------+--------------+
                             |                                 ^
                             | normalized runtime events        |
                             v                                 |
              +-----------------------------------------------+
              |          Runtime Event Store (SSOT)           |
              |  .agent-loop/events/<runId>.jsonl             |
              |  append-only, monotonic sequence, redacted     |
              +----------------+---------------+--------------+
                               |               |
                               | emits         | emits
                               v               v
                    +----------------+   +----------------+
                    | Grok Worker    |   | Codex Reviewer |
                    | fix output     |   | review output  |
                    +----------------+   +----------------+
                               |
                               | optional bridge execution
                               v
                    +--------------------------+
                    | Python Worker Adapter    |
                    | tests, tools, utilities  |
                    +--------------------------+
```

## Core Event Envelope

Every runtime event must use one normalized envelope:

```json
{
  "version": "agentloop.event.v2",
  "runId": "2026-06-25T02-30-12-664Z",
  "seq": 42,
  "ts": "2026-06-25T02:34:51.000Z",
  "source": "node|python|grok|codex|system",
  "phase": "queue|probe|gate|fix|review|landing|finalize",
  "type": "RUN_STARTED|GATE_RESULT|AGENT_LOG|REVIEW_RESULT|RUN_FINALIZED",
  "task": "agent-loop/tasks/example.md",
  "status": "GROK_FIX",
  "payload": {},
  "artifacts": [],
  "redaction": {
    "applied": true
  }
}
```

Rules:

- `seq` is monotonic per run.
- `runId`, `ts`, `source`, `phase`, and `type` are required.
- `payload` is always redacted before exposure to Web clients.
- Events are append-only; corrections are new events, not edits.
- `state.json` is a cache, not the authority.

## Required Event Types

Minimum v2 event set:

- `QUEUE_STARTED`
- `TASK_STARTED`
- `WORKTREE_READY`
- `BASELINE_GATE_RESULT`
- `AGENT_FIX_STARTED`
- `AGENT_LOG`
- `AGENT_FIX_RESULT`
- `POST_FIX_GATE_RESULT`
- `REVIEW_STARTED`
- `REVIEW_RESULT`
- `RETRY_REQUESTED`
- `ARTIFACT_INDEXED`
- `RUN_FINALIZED`
- `QUEUE_LANDING_READY`
- `QUEUE_FINISHED`
- `RUN_FAILED`

## State Reducer Contract

The reducer is a pure function:

```text
reduce(events[]) -> {
  runId,
  task,
  status,
  phase,
  activeAgent,
  currentIteration,
  gate,
  reviewVerdict,
  artifacts,
  flowNodes,
  flowEdges,
  timeline,
  finalized
}
```

Reducer requirements:

- Replaying the same events must produce the same snapshot.
- A `RUN_FINALIZED` event is the only event that moves a run into a final done state.
- `REVIEW_RESULT` controls review verdict; logs do not.
- `GATE_RESULT` controls gate status; textual parsing is not authoritative.
- Flow nodes and edges come from events and stable ids, not from DOM rebuilds.

## Web Update Model

The Web UI does not poll `state.json` as its primary data source.

Recommended update path:

```text
GET /api/agent-loop/runs/{runId}/events
  -> initial replay

GET /api/agent-loop/runs/{runId}/events/stream
  -> incremental SSE frames

event -> reducer -> React state patch -> stable Flow graph update
```

The dashboard may keep a low-frequency fallback refresh for offline or legacy runs, but that path is not the primary v2 update path.

## Compatibility Model

Existing 108 and 109 runs may not have v2 events. The compatibility adapter (fallback to legacy artifact adapter) reads:

- `state.json`
- `events.jsonl`
- `final-report.json`
- `grok-output*.log`
- `codex-review*.log`
- `diff*.patch`

and emits synthetic v2 events. Synthetic events must be marked:

```json
{
  "payload": {
    "synthetic": true,
    "legacySource": "state.json"
  }
}
```

This allows the Web UI to render old runs without keeping separate rendering logic.

## Execution DAG for Wave 110

```text
1. event envelope contract
   |
2. append-only event store
   |
3. deterministic state reducer
   |
4. legacy artifact adapter
   |
5. Python event read API
   |
6. SSE stream v2
   |
7. Web replay engine
   |
8. Flow event projection
   |
9. Node event adapter
   |
10. Python worker adapter
   |
11. artifact index
   |
12. e2e replay and release readiness
```

## Wave 110 Task Set

The 110 queue should implement the DAG in this order:

1. `sliderule-agentloop-event-envelope-110`
2. `sliderule-agentloop-event-store-110`
3. `sliderule-agentloop-state-reducer-110`
4. `sliderule-agentloop-legacy-event-adapter-110`
5. `sliderule-agentloop-event-read-api-110`
6. `sliderule-agentloop-sse-stream-v2-110`
7. `sliderule-agentloop-web-route-shell-110`
8. `sliderule-agentloop-flow-event-projection-110`
9. `sliderule-agentloop-node-event-adapter-110`
10. `sliderule-agentloop-python-worker-adapter-110`
11. `sliderule-agentloop-artifact-index-110`
12. `sliderule-agentloop-replay-release-readiness-110`

## Success Criteria

Wave 110 is complete when:

- Release readiness 110 covers rollback guidance, Web route verification, and safe operation of v2 replay beside Node runner.
- Web `/AgentLoop` can render current and legacy runs from one event replay path.
- Flow updates use stable node and edge ids.
- Done state is driven by `RUN_FINALIZED`.
- Active log display is driven by event references, not newest-file guessing.
- Python APIs expose redacted event replay and SSE stream.
- Node runner emits or can be adapted into normalized v2 events without removing the runner.
- 108 and 109 runs remain readable through the compatibility adapter.
