# Requirements Document

## Introduction

The existing `/autopilot` 3D back wall still uses the mission-first `SandboxMonitor` shape: a horizontal three-pane strip for terminal, task summary, and browser preview. That shape is not the intended blueprint-mode experience.

The desired blueprint-mode wall is a large Ant Design ecosystem FlowGraph embedded directly on the 3D back wall. It should visually match the user's reference: a pale infinite-canvas graph, card-like nodes, curved dashed edges with labels, left-side telemetry counters, top-right graph controls, lower-right minimap, and a bottom console stream.

This spec is the visual follow-up to `blueprint-wall-process-data-2026-05-31`. The data spec intentionally forbids graph-renderer dependencies because it is a pure deriver. This visual spec intentionally allows `@ant-design/graphs` because it is the UI layer that renders that deriver output.

The main invariant remains: blueprint process data must come from `deriveBlueprintWallProcessData(...)`. The visual layer must not re-read mission-first sandbox stores, rebuild a second stage progress formula, or show stale data from a previous blueprint job.

## Glossary

- **Blueprint_Wall_Process_Graph_HUD**: the new blueprint-mode wall component that embeds an Ant Design Graphs `FlowGraph` into the 3D back wall.
- **Ant_Design_Flow_Wall_Canvas**: the `@ant-design/graphs` `FlowGraph` rendered inside a drei `<Html transform>` surface.
- **Wall_Process_Data**: the output of `deriveBlueprintWallProcessData(input)`.
- **Data_Deriver**: `deriveBlueprintWallProcessData(...)`, implemented by `blueprint-wall-process-data-2026-05-31`.
- **Mission_First_Wall**: the existing mission-first `SandboxMonitor` path for `/tasks` and non-blueprint scene usage.
- **Current_Job_Scope**: all graph content must be scoped to the active blueprint job and must not leak from a previous project or job.
- **Graph_Node_Card**: a FlowGraph node rendered as a readable card, such as user goal, stage, reasoning, route, spec node, capability, preview, artifact, or final answer.
- **Graph_Edge**: a FlowGraph edge rendered as a curved dashed relationship line with optional semantic label.
- **Wall_Console**: a bottom overlay inside the wall graph that renders recent console/reasoning lines from `Wall_Process_Data.consoleLines`.
- **Wall_Minimap**: the G6/FlowGraph minimap rendered in the lower-right corner of the wall canvas.

## Requirements

### Requirement 1: Replace blueprint-mode wall strip with an Ant Design FlowGraph HUD

**User Story:** As a blueprint user, I want the 3D wall to show a complete process graph, so I can understand the whole generation flow at a glance instead of reading a mission-first three-screen strip.

#### Acceptance Criteria

1. WHEN `Scene3D` runs in `mode === "blueprint"`, THE scene SHALL render `BlueprintWallProcessGraphHud` instead of the mission-first `SandboxMonitor`.
2. WHEN `Scene3D` runs in `mode === "mission-first"`, THE scene SHALL continue rendering the existing `SandboxMonitor` with no visible behavior change.
3. THE blueprint wall graph SHALL be a tall wall-mounted surface, not a horizontal three-pane strip.
4. THE blueprint wall graph SHALL visually resemble the reference process canvas with card nodes, curved dashed edges, controls, minimap, and console overlay.
5. THE blueprint wall graph SHALL be embedded in the 3D scene through drei `<Html transform>` or an equivalent existing in-scene DOM rendering technique.
6. THE implementation SHALL NOT modify `MissionWallTaskPanel` for this feature.

### Requirement 2: Use Ant Design Graphs FlowGraph as the graph renderer

**User Story:** As a user, I want the wall to look and behave like a real node graph canvas, so it matches the reference image and supports scale/minimap affordances naturally.

#### Acceptance Criteria

1. THE implementation SHALL add and use `@ant-design/graphs` for the blueprint wall graph.
2. THE graph SHALL use `FlowGraph` data, nodes, and edges rather than a hand-rolled SVG-only graph renderer.
3. THE graph SHALL use the G6/FlowGraph minimap capability when available, or a small overlay minimap driven by the same graph data when the wrapper API does not expose one cleanly.
4. THE graph SHALL provide controls for at least zoom out and fit view, using FlowGraph/G6 APIs or an equivalent constrained overlay matching the reference.
5. THE graph MAY use FlowGraph/G6 grid/background options if they improve the pale canvas readability.
6. THE graph SHALL disable node editing, edge creation, and destructive graph interactions; the wall graph is observational, not a graph editor.
7. THE graph SHALL support controlled panning/zooming only within wall-safe limits.
8. THE graph SHALL disable or override the FlowGraph/G6 built-in dagre auto-layout and SHALL position nodes using the deterministic `visualStageLane`/`row` coordinates produced by the column remap, so auto-layout does not move route/spec/preview nodes out of their stage lanes.
9. IF the chosen `@ant-design/graphs` `FlowGraph` wrapper cannot cleanly disable its default dagre layout, THEN THE implementation MAY drop to the lower-level `@antv/g6` Graph API (still within the Ant Design / AntV ecosystem) to retain deterministic positions; switching renderer in this way SHALL update this spec's design before code is finalized.

### Requirement 3: Use Wall_Process_Data as the only graph data source

**User Story:** As a maintainer, I want the visual graph to consume the existing pure deriver, so the wall does not become another parallel state stitcher.

#### Acceptance Criteria

1. THE graph HUD SHALL call or receive output from `deriveBlueprintWallProcessData(input)`.
2. THE graph HUD SHALL map `Wall_Process_Data.nodes` to FlowGraph nodes.
3. THE graph HUD SHALL map `Wall_Process_Data.edges` to FlowGraph edges.
4. THE graph HUD SHALL use `Wall_Process_Data.metrics` for left-side telemetry.
5. THE graph HUD SHALL use `Wall_Process_Data.consoleLines` for the bottom console.
6. THE graph HUD SHALL use `Wall_Process_Data.previewSummary` to render preview/browser/architecture nodes.
7. THE graph HUD SHALL NOT read from `useSandboxStore`.
8. THE graph HUD SHALL NOT rebuild stage progress from a separate local stage table; any stage information must come from the deriver output.
9. THE graph HUD SHALL NOT treat every `Wall_Process_Data.node.column` value as the same semantic stage column. Stage backbone nodes use `column = stageIndex`, while branch nodes use category columns; the visual mapper SHALL remap branch nodes to their nearest owning stage lane before computing FlowGraph positions.

### Requirement 4: Preserve Current_Job_Scope and avoid previous-project residue

**User Story:** As a user starting a new blueprint project, I do not want the wall graph to show nodes, screenshots, console lines, or capability calls from an earlier job.

#### Acceptance Criteria

1. THE graph HUD SHALL pass the active blueprint job id and current page-scoped blueprint data into the deriver.
2. WHEN there is no active blueprint job, THE graph HUD SHALL render a clean empty graph state rather than mission-first data.
3. WHEN the active job changes, THE graph HUD SHALL recompute graph data from the new job-scoped inputs.
4. THE graph HUD SHALL NOT use global latest sandbox screenshots, terminal logs, or mission task details as fallback content.
5. Tests SHALL cover that blueprint mode does not import or consume mission-first sandbox store data for wall content.

### Requirement 5: Render card nodes with semantic visual treatment

**User Story:** As a user, I want each node card to communicate what it represents, so the graph is readable even when embedded on a 3D wall.

#### Acceptance Criteria

1. THE graph SHALL render custom FlowGraph/G6 node cards for all supported `BlueprintWallGraphNode.type` values.
2. Node cards SHALL show a compact type header with icon/color, a title, and optional body text.
3. Node cards SHALL use distinct but restrained visual styles for at least:
   - `user_goal`
   - `stage`
   - `reasoning`
   - `route`
   - `spec_node`
   - `capability`
   - `preview`
   - `artifact`
   - `final`
4. Node cards SHALL keep text readable in the wall context with predictable width and controlled wrapping.
5. Preview nodes SHALL show a browser URL/preview marker when `previewSummary.kind === "browser"`, an architecture fallback marker when `previewSummary.kind === "architecture"`, and a muted empty marker otherwise.
6. Preview nodes MAY show a true thumbnail only if a future data source supplies one; this spec SHALL NOT fabricate thumbnails.
7. Node status SHALL affect styling, including active, completed, warning, and failed states.
8. The visual style SHALL follow the reference direction: pale canvas, clean cards, colored borders/handles, and low-noise shadows.

### Requirement 6: Render semantic curved edges with labels

**User Story:** As a user, I want the graph to show how facts, stages, capabilities, and outputs relate to each other.

#### Acceptance Criteria

1. THE graph SHALL render `Wall_Process_Data.edges` as FlowGraph edges.
2. Edges SHALL use curved dashed lines by default.
3. Edge color SHALL reflect semantic edge kind or priority.
4. Edge labels SHALL appear when the deriver supplies `edge.label`.
5. Edge handles SHALL visually align with node cards.
6. The graph SHALL omit uncertain relationships rather than drawing guessed edges.
7. THE graph SHALL not infer capability ownership that is absent from `Wall_Process_Data`.

### Requirement 7: Provide wall telemetry, minimap, and console overlays

**User Story:** As a user, I want the wall graph to include the same surrounding affordances as the reference image: metrics, minimap, and process console.

#### Acceptance Criteria

1. THE graph HUD SHALL render a left-side telemetry column from `Wall_Process_Data.metrics`.
2. Missing metrics SHALL render as muted placeholders, not fabricated values.
3. Because the current data deriver returns token burn, source count, remaining points, and elapsed time as `null`, THE first implementation SHALL expect those fields to render as placeholders unless a later telemetry spec extends the deriver input.
4. THE graph HUD SHALL render a lower-right minimap using FlowGraph/G6 minimap capability or a same-data overlay fallback.
5. THE graph HUD SHALL render a bottom console from `Wall_Process_Data.consoleLines`.
6. The bottom console SHALL not cover important graph content at the default fit view.
7. Console lines SHALL remain compact and capped by the deriver output.
8. The overlays SHALL remain inside the wall surface and SHALL NOT float over unrelated 3D scene areas.

### Requirement 8: Fit the FlowGraph canvas into the 3D wall

**User Story:** As a user, I want the graph to feel like it is actually installed on the office wall, not pasted as a random web page.

#### Acceptance Criteria

1. THE blueprint wall surface SHALL be substantially taller than the old 1416x243 strip.
2. THE initial target DOM size SHOULD be around 1680x760 or larger, adjusted only if Playwright/browser visual QA shows readability issues.
3. THE wall SHALL fit within the back wall without clipping on desktop.
4. THE graph SHALL remain legible at the default camera on `/autopilot`.
5. THE wall graph SHALL not overlap role agents, desks, or floor UI in the normal desktop view.
6. THE wall graph SHALL have a reasonable fallback layout on narrow/mobile viewports.
7. The implementation SHALL use stable dimensions and avoid layout jumps while graph data changes.

### Requirement 9: Keep interaction constrained and wall-safe

**User Story:** As a user, I want to inspect the graph without the wall becoming a full graph editor or interfering with the 3D scene.

#### Acceptance Criteria

1. THE graph MAY allow pan and zoom inside FlowGraph/G6.
2. THE graph SHALL disable node dragging by default unless a future spec explicitly enables editing.
3. THE graph SHALL disable edge creation.
4. THE graph SHALL disable node connection handles as interactive connection targets.
5. THE graph SHALL support fit-to-view on initial render and after job changes.
6. THE graph SHOULD preserve a stable viewport per job where practical.
7. THE graph SHALL not capture unintended page-level scroll outside the wall area.
8. BEFORE relying on interactive pan/zoom, THE implementation SHALL verify that FlowGraph/G6 pointer coordinates work correctly inside the transformed drei `<Html>` wall surface.
9. IF transformed hit-testing is unreliable, THE graph SHALL fall back to a non-editable fitted view with external fit/zoom controls or static fit behavior.

### Requirement 10: Verify with tests and browser visual QA

**User Story:** As a reviewer, I want proof that the Ant Design FlowGraph wall works in code and in the real `/autopilot` scene.

#### Acceptance Criteria

1. Tests SHALL verify that blueprint mode uses the new wall graph path and mission-first mode keeps `SandboxMonitor`.
2. Tests SHALL verify that `BlueprintWallProcessGraphHud` imports/uses `@ant-design/graphs`.
3. Tests SHALL verify that `BlueprintWallProcessGraphHud` imports/uses `deriveBlueprintWallProcessData`.
4. Tests SHALL verify that no blueprint wall content reads `useSandboxStore`.
5. Tests SHALL verify FlowGraph node and edge mapping for representative deriver output.
6. Tests SHALL verify empty state rendering for `job === null`.
7. `node --run check` SHALL exit 0.
8. WHEN `/autopilot` has no active blueprint job, THE Playwright check (or equivalent) SHALL confirm the wall renders a clean empty graph state and does NOT show the old mission-first three-pane strip.
9. WHEN a blueprint job with data is active via fixture, replay job, or a completed generation flow, THE Playwright check (or equivalent) SHALL confirm the wall graph is visible and non-empty with nodes, edges, minimap, and console, and is not clipped on desktop.

## Non-Functional Requirements

### NFR-1: Mission-First Compatibility

1. Mission-first `/tasks` and non-blueprint `Scene3D` behavior SHALL remain unchanged.
2. `MissionWallTaskPanel` SHALL remain untouched.
3. The existing mission-first `SandboxMonitor` helper tests SHALL remain valid unless unrelated baseline changes exist.

### NFR-2: Performance

1. The wall graph SHOULD cap rendered node count for the 3D wall if the deriver returns too many nodes.
2. The first implementation SHOULD favor readable representative nodes over rendering an unbounded full graph.
3. FlowGraph/G6 options SHALL avoid expensive interactions that are not needed for an observational wall.
4. The graph SHALL use memoized node/edge mapping where practical.
5. THE blueprint wall graph component and its `@ant-design/graphs` import SHALL be lazy-loaded or code-split, for example via `React.lazy` or a dynamic import, so the mission-first `Scene3D` / `/tasks` bundle path does not statically load `@ant-design/graphs`.

### NFR-3: Documentation and Spec Sync

1. This spec's `tasks.md` SHALL be updated as implementation progresses.
2. Any implementation deviation from the Ant Design FlowGraph direction SHALL update this spec before code is finalized.
3. The previous data spec SHALL remain data-only; `@ant-design/graphs` belongs to this visual spec.
