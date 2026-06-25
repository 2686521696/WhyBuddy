# SlideRule AgentLoop Runtime Boundary

This document defines the stable boundary between the SlideRule Python control plane and the AgentLoop Node worker bridge for task 108.

## Python-owned (SlideRule control plane)
- APIs: public contract surface for run control and status queries.
- Settings: configuration loading, effective settings, and schema for runtime.
- Run readers: accessors for run state and history from Python.
- Event readers: streaming and querying of run events from Python.
- Redaction: secret and sensitive data redaction rules and application points.
- Path safety: workspace and worktree path validation and containment checks.
- Product UI: the end-user product interfaces and views that expose runtime.

Python owns the product definition and the read-side contracts.

## Node-owned (AgentLoop worker bridge)
- Queue execution: the run queue, scheduling, and dispatch in the Node side.
- Worker process spawning: launching and managing the isolated worker processes.
- Worktree mutation: file system writes, edits, and mutations inside worktrees.
- Gates: execution of verification gates and checks during runs.
- Diffs: change detection, diff computation, and patch application.
- Final reports: aggregation and output of completion reports for this wave.

Node owns the execution mechanics and mutation side for this wave.

## Future direction
A full Python rewrite of the runner is an optional follow-up after 108. This task (108) only establishes the boundary contract. Later tasks must follow this boundary; the rewrite path is not part of 108.

## Ownership rules
- Python is product owner of the overall SlideRule runtime surface.
- Node bridge remains the current execution implementation behind the boundary.
- All future changes to contracts must update this document and keep Python in control of the named areas above.
- No changes to worker prompts or addition of UI code is in scope for boundary definition.
