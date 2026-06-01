# Implementation Plan

> Goal: render the blueprint wall as an Ant Design Graphs `FlowGraph` style process graph directly inside the 3D back wall, using `deriveBlueprintWallProcessData(...)` as the only graph data source. Mission-first wall behavior stays unchanged.

## Task 1: Add Ant Design Graphs dependency and graph HUD skeleton

- [x] 1.1 Add `@ant-design/graphs` to project dependencies.
  - Pin the exact resolved version chosen during implementation; do not leave a broad floating range.
  - Keep the dependency limited to the visual graph HUD; the data deriver must remain React-free.
  - _Requirements: 2.1, 3.1_

- [x] 1.2 Create `client/src/components/three/scene-fusion/BlueprintWallProcessGraphHud.tsx`.
  - Render a wall-mounted `<Html transform>` container.
  - Render a placeholder empty graph shell first.
  - Import `FlowGraph` from `@ant-design/graphs`.
  - _Requirements: 1.3, 1.5, 2.1-2.5_

- [x] 1.3 Add initial source-level tests.
  - Component imports `@ant-design/graphs`.
  - Component imports `deriveBlueprintWallProcessData`.
  - Component does not import `useSandboxStore`.
  - _Requirements: 2.1, 3.1, 3.7, 10.2-10.4_

- [x] 1.4 Add an early transformed-wall interaction spike.
  - Mount a minimal FlowGraph inside the same `<Html transform>` style surface.
  - Verify whether G6 pan/zoom pointer coordinates work through the transform.
  - If not reliable, lock the implementation to fitted/non-editable view plus external fit/zoom controls.
  - _Requirements: 9.1, 9.8, 9.9_

## Task 2: Wire blueprint wall data inputs

- [x] 2.1 Extend `Scene3DProps` with blueprint wall inputs.
  - route set
  - spec tree
  - effect previews
  - agent reasoning entries
  - capability statuses
  - capability owners
  - role phases
  - artifacts when available
  - _Requirements: 3.1-3.6, 4.1-4.4_

- [x] 2.2 Wire `/autopilot` page data into `Scene3D`.
  - Pass current job-scoped props already available on the page/realtime store.
  - Do not read mission-first sandbox data.
  - _Requirements: 3.1-3.8, 4.1-4.4_

- [x] 2.3 Add mode switch in `Scene3D`.
  - `mode === "mission-first"` renders `SandboxMonitor`.
  - `mode === "blueprint"` renders `BlueprintWallProcessGraphHud`.
  - Lazy-load / code-split `BlueprintWallProcessGraphHud` (e.g. `React.lazy` + dynamic `import()`), so the mission-first branch and `/tasks` bundle path never statically import `@ant-design/graphs`.
  - _Requirements: 1.1, 1.2, 1.6, 10.1, NFR-2.5_

- [x] 2.4 Add source-level or focused tests for the `Scene3D` mode switch.
  - Mission-first path still references `SandboxMonitor`.
  - Blueprint path references `BlueprintWallProcessGraphHud`.
  - Blueprint branch does not mount `SandboxMonitor`.
  - Assert mission-first `Scene3D` source/bundle path does not statically import `@ant-design/graphs` (e.g. blueprint graph component is referenced via lazy/dynamic import, not a top-level static import in the mission-first path).
  - _Requirements: 1.1, 1.2, 10.1_

## Task 3: Map Wall_Process_Data to FlowGraph

- [x] 3.1 Create `mapWallDataToFlowGraph(data)`.
  - Map deriver node ids to FlowGraph node ids.
  - Remap branch node category columns to owning stage lanes before computing pixel positions.
  - Map remapped stage lane and `row` to deterministic pixel positions.
  - Preserve node type/status/sourceRefs in node data.
  - Disable or override the FlowGraph/G6 built-in dagre auto-layout and assign each node the fixed remapped `x = visualStageLane * 330 + offsetX` / `y = row * 150 + offsetY`; verify dagre does not reflow nodes out of their stage lanes. If the FlowGraph wrapper cannot cleanly disable dagre, drop to the `@antv/g6` Graph API and update the spec design first.
  - _Requirements: 3.2, 3.9, 5.1-5.7, 10.5, 2.8, 2.9_

- [x] 3.2 Map deriver edges to FlowGraph edges.
  - Curved dashed edges by default.
  - Preserve labels.
  - Style by kind/priority.
  - _Requirements: 3.3, 6.1-6.7_

- [x] 3.3 Add pure mapping tests.
  - Representative nodes produce FlowGraph nodes.
  - Representative edges produce dashed labeled FlowGraph edges.
  - Node/edge ids remain stable.
  - Route nodes map to the route_generation lane (stageIndex 2), not clarification (1) and not route_selection (3).
  - Spec nodes map to the spec_tree lane (stageIndex 4), not route_generation (2) and not spec_docs (5).
  - Preview nodes map to the effect_preview lane (stageIndex 6), not spec_tree (4).
  - Final nodes map to the engineering_handoff lane (stageIndex 8); artifact nodes also map to engineering_handoff (8) but on a different row, so they do not overlap final.
  - Reasoning nodes with a `kind:"stage"` sourceRef map to that stage's lane; reasoning/capability without a known stage fall back to `data.stageSignal.stageIndex`.
  - Mapped FlowGraph nodes carry explicit fixed x/y from the remap (not left for dagre); a representative node's x equals its `visualStageLane * 330 + offsetX`.
  - _Requirements: 3.2, 3.3, 3.9, 6.1-6.4, 10.5_

## Task 4: Build custom node card rendering

- [x] 4.1 Implement `BlueprintWallGraphNodeCard`.
  - Header icon/color.
  - Title/body.
  - Status styling.
  - Controlled text wrapping.
  - _Requirements: 5.1-5.7_

- [x] 4.2 Add node type visual variants.
  - user goal
  - stage
  - reasoning
  - route
  - spec node
  - capability
  - preview
  - artifact
  - final
  - _Requirements: 5.1-5.7_

- [x] 4.3 Add preview node treatment.
  - Browser preview URL/marker when available.
  - Architecture fallback marker when available.
  - Empty preview marker when no preview exists.
  - True thumbnail rendering is optional and only enabled if a later data source supplies `thumbnailUrl`.
  - _Requirements: 3.6, 5.5, 5.6_

- [x] 4.4 Add SSR/source tests for node card output.
  - Type/title/body render.
  - Status class or data attribute renders.
  - Preview fallback renders without throwing.
  - _Requirements: 5.1-5.7, 10.5_

## Task 5: Add FlowGraph wall overlays

- [x] 5.1 Add left telemetry rail.
  - Token burn.
  - Sources.
  - Remaining points.
  - Time.
  - Muted placeholders for missing values.
  - Treat token/source/remaining/time as placeholder-only in this first implementation because current deriver output is `null` for those fields.
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 5.2 Add bottom console overlay.
  - Render `consoleLines`.
  - Keep inside wall.
  - Avoid covering key graph content at fit view.
  - _Requirements: 7.4-7.7_

- [x] 5.3 Add FlowGraph/G6 minimap and controls.
  - Lower-right minimap.
  - Top-right or reference-like controls.
  - Constrained fit/zoom behavior.
  - _Requirements: 2.3, 2.4, 7.3, 9.1-9.7_

- [x] 5.4 Add tests/source guards for overlays.
  - Metrics placeholders.
  - Console empty/non-empty states.
  - FlowGraph/G6 minimap and controls are wired or equivalent same-data overlays exist.
  - _Requirements: 7.1-7.7, 10.2_

## Task 6: Fit the graph into the 3D wall

- [x] 6.1 Set blueprint wall dimensions and placement.
  - Start around 1680x760 at distanceFactor 4.0.
  - Place on back wall.
  - Keep mission-first monitor dimensions unchanged.
  - _Requirements: 8.1-8.7_

- [x] 6.2 Configure FlowGraph viewport.
  - Fit view on initial render.
  - Fit view after job changes.
  - Constrain min/max zoom.
  - Disable editing interactions.
  - Respect the Task 1.4 interaction spike result; use fitted/static behavior if transformed pan/zoom is unreliable.
  - _Requirements: 2.6, 2.7, 9.1-9.9_

- [x] 6.3 Add empty state.
  - Clean blank graph state for no active job.
  - No mission fallback data.
  - _Requirements: 4.2, 10.6_

- [x] 6.4 Add desktop/mobile fit checks in tests where possible.
  - Source-level constants are stable.
  - No obvious overlap with old monitor path.
  - _Requirements: 8.1-8.7_

## Task 7: Browser QA and polish

- [x] 7.1 Run focused tests.
  - `blueprint-wall-process-data.test.ts`
  - `blueprint-wall-process-graph-hud.test.tsx`
  - relevant scene-fusion harness tests
  - _Requirements: 10.1-10.7_

- [x] 7.2 Run `node --run check`.
  - Expected: exit 0.
  - _Requirements: 10.7_

- [x] 7.3 Use Playwright or equivalent browser QA on `http://localhost:3000/autopilot`.
  - Empty state: With no active blueprint job on `/autopilot`, confirm a clean empty graph state and that the old three-pane mission strip is NOT shown.
  - With data: With a blueprint job that has data (fixture / replay job / completed generation flow), confirm the tall Ant Design FlowGraph is visible and non-empty with nodes, edges, minimap, console, and is not clipped on desktop; capture screenshot evidence.
  - _Requirements: 8.3-8.7, 10.8, 10.9_

- [x] 7.4 Polish based on browser evidence.
  - Adjust wall size/position.
  - Adjust node density.
  - Adjust console/minimap placement.
  - Re-run focused verification.
  - _Requirements: 5.4, 7.5, 8.3-8.7_

## Verification Checklist

- [x] `@ant-design/graphs` is installed and used only in visual graph UI.
- [x] Blueprint mode renders `BlueprintWallProcessGraphHud`.
- [x] Mission-first mode still renders `SandboxMonitor`.
- [x] `MissionWallTaskPanel` is not modified.
- [x] Graph nodes and edges are derived from `deriveBlueprintWallProcessData`.
- [x] Blueprint wall graph does not import `useSandboxStore`.
- [x] Empty job renders clean empty graph.
- [x] Branch nodes visually align to owning stage lanes after column remap.
- [x] Metrics rail intentionally shows placeholders for telemetry fields until a later telemetry-input spec exists.
- [x] Preview nodes do not promise real thumbnails unless `thumbnailUrl` exists.
- [x] FlowGraph interaction through `<Html transform>` has been verified or downgraded to fitted/static behavior.
- [x] Focused tests pass.
- [x] `node --run check` exits 0.
- [x] Browser screenshot confirms the desired Ant Design FlowGraph wall effect on `/autopilot`.
- [x] FlowGraph built-in dagre auto-layout is disabled/overridden; nodes use deterministic remapped x/y and stay in their stage lanes.
- [x] Blueprint graph component is lazy-loaded; mission-first `/tasks` bundle path does not statically import `@ant-design/graphs`.
- [x] Browser QA covers both the empty-job state and a data-present job state.
