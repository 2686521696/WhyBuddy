# Requirements Document

## Introduction

The current 3D back-wall `SandboxMonitor` is a mission-first three-pane strip:

- left: `TerminalPreview`
- center: `MissionWallTaskPanel`
- right: `ScreenshotPreview`

In `/autopilot` blueprint mode, that strip is no longer the right product shape. The desired direction is a single tall wall-mounted process graph, visually closer to a reasoning map: metrics on the left, a multi-node process graph in the center, recent console/reasoning lines at the bottom, and a minimap in the lower-right corner.

This spec is still the data-first step. It does not render the tall 3D wall yet. Instead, it upgrades `Blueprint Wall Process Data` from compact summaries into a graph-ready pure view model. The follow-up visual spec will use this data to replace the blueprint-mode wall strip with a taller wall process graph while keeping mission-first behavior unchanged.

The most important invariant remains unchanged: blueprint stage progress must reuse the existing `getBlueprintSceneStageSignal(job)`. `autopilot-scene-fusion` already connected the 9-stage signal to `SceneStageFlow`; this data layer must not create a second stage-progress formula.

## Glossary

- **Blueprint_Wall_Process_Data**: a pure graph-ready view model for the tall 3D wall process graph. It includes stage signal, graph nodes, graph edges, metrics, console lines, minimap data, preview summary, and compatibility summaries.
- **Tall_Wall_Process_Graph**: the future 3D wall UI that replaces the old three-pane strip in blueprint mode. It is not implemented by this spec.
- **Stage_Signal**: the `BlueprintSceneStageSignal` returned by `getBlueprintSceneStageSignal(job)`. It is the only source of blueprint stage progress.
- **Wall_Process_Data_Deriver**: the new pure function `deriveBlueprintWallProcessData(input)`.
- **Current_Job_Scope**: when `job?.id` exists, reasoning, effect preview, artifact, capability, and graph data must be scoped to that job and must not leak from a previous project or job.
- **Graph_Node**: a graph card to be rendered later on the tall wall. Examples: user goal, stage, route, spec node, reasoning event, capability call, preview, artifact, final handoff.
- **Graph_Edge**: a semantic curved/dashed relationship between graph nodes. Examples: supports, depends_on, produces, uses_capability, refines, blocks, answers.
- **Mission_First_Wall**: the existing mission-first `SandboxMonitor` and `MissionWallTaskPanel` path. This spec does not change it.

## Requirements

### Requirement 1: Build a pure graph-ready data layer

**User Story:** As a maintainer of the 3D blueprint scene, I want the tall wall process graph data to be derived by one pure function, so the later visual work does not keep stitching state from multiple stores and bridges.

#### Acceptance Criteria

1. THE implementation SHALL add a pure function named `deriveBlueprintWallProcessData(input)`.
2. THE function SHALL NOT call React hooks, Zustand stores, network APIs, `Date.now()`, random APIs, timers, or mutable module-level caches.
3. THE function SHALL return stable output for the same input.
4. THE function SHALL tolerate `job === null` or `job === undefined` and still return a safe empty graph data object.
5. THE function SHALL live near the existing scene-fusion pure helpers, under `client/src/components/three/scene-fusion/`.
6. THE function SHALL be covered by focused unit tests that do not mount React components.

### Requirement 2: Reuse Stage_Signal as the only stage progress source

**User Story:** As a user, I want the wall process graph, the floor stage flow, and the blueprint main flow to agree on progress.

#### Acceptance Criteria

1. THE data deriver SHALL call `getBlueprintSceneStageSignal(job)` to produce `stageSignal`.
2. THE data deriver SHALL NOT duplicate `BLUEPRINT_SCENE_STAGES` progress formulas, stage index math, backend stage alias mapping, or fallback stage rules.
3. THE data deriver MAY expose `stageNodes`, but those nodes MUST be derived from the returned `stageSignal` and imported `BLUEPRINT_SCENE_STAGES`, not from a new local stage table.
4. WHEN `getBlueprintSceneStageSignal(job)` maps backend aliases such as `preview`, `runtime_capability`, or `engineering_landing`, THE wall data SHALL reflect that same mapped result.
5. IF future changes alter `getBlueprintSceneStageSignal`, THE wall process data tests SHALL assert contract-level consistency and SHALL NOT freeze a second progress formula.

### Requirement 3: Isolate all output by Current_Job_Scope

**User Story:** As a user starting a new project or blueprint, I do not want the 3D wall graph to show reasoning, screenshots, capabilities, or artifacts from the previous job.

#### Acceptance Criteria

1. WHEN `job?.id` exists, THE data deriver SHALL filter `agentReasoningEntries` to entries whose `jobId === job.id`.
2. WHEN an effect preview snapshot exposes `runtimeProjection.jobId` and that value does not match `job.id`, THE data deriver SHALL exclude it.
3. WHEN an input item has no job id and cannot be proven to belong to the current job, THE data deriver SHALL include it only if it is directly passed as the current page's already-scoped prop and no better job-scoped alternative exists.
4. THE output SHALL NOT depend on global latest-job state.
5. THE output SHALL NOT read from `useSandboxStore`; sandbox logs from previous jobs must not be a data source for blueprint wall process data.

### Requirement 4: Produce graph nodes for the tall wall

**User Story:** As a user looking at the 3D wall, I want the process to appear as a real reasoning map, not as disconnected summaries.

#### Acceptance Criteria

1. THE data deriver SHALL expose `nodes: BlueprintWallGraphNode[]`.
2. Each graph node SHALL include a stable id, type, title, optional body, status, column, row, and source references.
3. Supported node types SHALL include at least `user_goal`, `stage`, `reasoning`, `route`, `spec_node`, `capability`, `preview`, `artifact`, and `final`.
4. THE deriver SHALL create stage nodes from the existing stage signal and stage list.
5. THE deriver SHALL create reasoning nodes from current-job reasoning entries.
6. THE deriver SHALL create route/spec/preview/capability nodes when corresponding current-job data exists.
7. THE deriver SHALL create a `user_goal` node when the job exposes a usable title, prompt, objective, or equivalent user-intent text.
8. THE deriver SHALL create `artifact` nodes for current-job artifact inputs when they are provided.
9. THE deriver SHALL create a `final` node when the job or artifact inputs expose a completed final answer, handoff, landing plan, or equivalent terminal result.
10. THE deriver SHALL produce a safe empty node set when no job or data exists.
11. THE graph model SHALL be optimized for a tall 3D wall canvas, not for an unlimited full-screen graph.

### Requirement 5: Produce semantic graph edges

**User Story:** As a user, I want to see why nodes are related: what produced an artifact, what capability was used, and what evidence supports a later result.

#### Acceptance Criteria

1. THE data deriver SHALL expose `edges: BlueprintWallGraphEdge[]`.
2. Each edge SHALL include stable id, from node id, to node id, kind, label, and visual priority.
3. Supported edge kinds SHALL include at least `supports`, `depends_on`, `produces`, `uses_capability`, `refines`, `blocks`, and `answers`.
4. THE deriver SHALL connect stage nodes in stage order.
5. THE deriver SHALL connect reasoning nodes to their nearest stage or role/capability node where the relationship is known.
6. THE deriver SHALL NOT invent ownership for capabilities when a real off-stage owner exists.
7. THE deriver SHALL tolerate missing relationship fields by omitting uncertain edges instead of guessing.
8. THE deriver SHALL create `answers` edges from evidence/reasoning/artifact nodes to a `final` node when a known terminal result exists.

### Requirement 6: Produce metrics and console lines

**User Story:** As a user, I want the wall graph to show process-level telemetry like the reference image: token/source/time counters and recent console-style reasoning output.

#### Acceptance Criteria

1. THE data deriver SHALL expose `metrics`.
2. `metrics` SHALL include available token burn, source count, elapsed time, remaining points, active role count, capability counts, and artifact count when those values are available from input.
3. Missing metrics SHALL be represented as `null` or omitted optional fields, not fabricated values.
4. THE data deriver SHALL expose `consoleLines`.
5. `consoleLines` SHALL be derived from current-job reasoning entries and effect-preview runtime projection log timelines when available.
6. `consoleLines` SHALL be capped to a small wall-readable number. The default cap SHALL be 8 and SHALL be configurable in input options for tests and later UI tuning.

### Requirement 7: Produce preview and minimap data

**User Story:** As a user, I want the browser/preview output to appear as part of the graph, with a small minimap that makes the large wall canvas understandable.

#### Acceptance Criteria

1. THE data deriver SHALL expose `previewSummary`.
2. `previewSummary` SHALL prefer the latest current-job effect preview snapshot whose `runtimeProjection.browserPreview.url` is a non-empty string.
3. IF no browser preview exists but `architectureSvgDraft` exists, THE summary SHALL expose an architecture preview fallback marker.
4. IF no preview exists, THE summary SHALL return an explicit empty state, not mission-first screenshot data.
5. THE data deriver SHALL expose `minimap`.
6. `minimap.nodes` SHALL be derived from graph node positions.
7. `minimap.viewport` SHALL be deterministic and safe for a later static wall render.

### Requirement 8: Preserve compatibility summaries while graph data becomes primary

**User Story:** As an implementer of the next visual spec, I want graph data to be primary while still having summary fields available for transition tests and small labels.

#### Acceptance Criteria

1. THE data deriver SHALL expose a `compatibility` block containing stage items, route summary, spec summary, capability summary, and counters.
2. THE `compatibility` block SHALL be derived from the same filtered current-job data as `nodes`, `edges`, `metrics`, and `previewSummary`.
3. THE data deriver MAY expose `emptyReason` with values such as `no-job` or `no-blueprint-data`.
4. THE default `maxReasoningNodes` SHALL be 12 unless the caller provides an override.
5. THE default `maxConsoleLines` SHALL be 8 unless the caller provides an override.

### Requirement 9: Keep mission-first and visible UI untouched in this data spec

**User Story:** As a reviewer, I want this spec to prepare the complete graph data without also changing 3D layout and interaction in the same step.

#### Acceptance Criteria

1. THIS spec SHALL NOT implement the visible `Tall_Wall_Process_Graph`.
2. THIS spec SHALL NOT replace the visible three-screen `SandboxMonitor` UI.
3. THIS spec SHALL NOT modify `MissionWallTaskPanel`.
4. THIS spec SHALL NOT modify `Scene3D`.
5. THIS spec SHALL NOT add React Flow, dagre, elkjs, or a generic graph layout engine.
6. THIS spec SHALL NOT implement a fullscreen process graph route.
7. THIS spec SHALL NOT add a mode-compatible data hook or adapter; the implementation scope is pure types, pure derivation, and unit tests only.
8. The later visual spec SHALL be responsible for making the blueprint wall tall, roughly replacing the old 1416x243 strip with a wall graph target around 1680x760 px at `distanceFactor=4`, while mission-first keeps the existing strip.

## Non-Functional Requirements

### NFR-1: Test Shape

1. Tests SHALL use focused Vitest unit tests for the pure deriver.
2. Tests SHALL NOT require Playwright, browser rendering, jsdom, happy-dom, or `@testing-library/react`.
3. Tests SHALL include cross-job leakage cases, stage-signal reuse cases, graph node/edge cases, preview fallback cases, minimap cases, and empty-input cases.

### NFR-2: Compatibility

1. `node --run check` SHALL exit 0 after implementation.
2. Existing stage-signal and blueprint runtime harness tests SHALL continue to pass where present.
3. Mission-first `/tasks` wall monitor behavior SHALL remain unchanged.

### NFR-3: Documentation

1. The implementation SHALL update this spec's `tasks.md` as items complete.
2. New exported types SHALL state that they are graph-ready wall view models, not canonical backend contracts.
