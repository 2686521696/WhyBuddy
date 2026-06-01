# Design Document

## Overview

This design replaces the blueprint-mode 3D wall strip with an Ant Design ecosystem FlowGraph HUD embedded on the back wall. The target visual is the user's reference image: a large pale graph canvas with node cards, curved dashed labeled edges, a left metric rail, a bottom console, and a lower-right minimap.

The implementation is intentionally split from the previous data spec:

```text
blueprint-wall-process-data-2026-05-31
  deriveBlueprintWallProcessData(input)
        |
        v
blueprint-wall-process-graph-hud-2026-05-31
  BlueprintWallProcessGraphHud
        |
        v
@ant-design/graphs FlowGraph inside drei <Html transform>
```

The previous data spec forbids graph-renderer dependencies to keep the deriver pure. This visual spec uses `@ant-design/graphs` because the user's desired wall is a flow graph canvas and the project already uses Ant Design.

## Architecture

### Current Rendering

```text
Scene3D
  |-- OfficeRoom
  |-- SceneStageFlow
  |-- PetWorkers
  `-- SandboxMonitor projectId={projectId}
      |-- TerminalPreview
      |-- MissionWallTaskPanel
      `-- ScreenshotPreview
```

This is appropriate for mission-first mode but wrong for blueprint mode.

### New Rendering

```text
Scene3D
  |-- OfficeRoom
  |-- SceneStageFlow
  |-- PetWorkers
  `-- mode switch
      |-- mission-first: SandboxMonitor projectId={projectId}
      `-- blueprint: BlueprintWallProcessGraphHud props...
```

`Scene3D` should own the wall-mode switch. This keeps `SandboxMonitor` as the mission-first wall device instead of overloading it with blueprint-only graph behavior.

### Data Flow

```text
AutopilotRoutePage / realtime store slices
  - blueprintJob
  - routeSet
  - specTree
  - effectPreviews
  - agentReasoningEntries
  - capabilityStatuses
  - capabilityOwners
  - rolePhases
  - artifacts
        |
        v
Scene3D props
        |
        v
BlueprintWallProcessGraphHud
        |
        v
deriveBlueprintWallProcessData(input)
        |
        v
mapWallDataToFlowGraph(data)
        |
        v
FlowGraph data / G6 options / overlays
```

The deriver remains the single source for graph content. The visual component maps the deriver's graph-ready model into Ant Design Graphs / G6's rendering model.

## Components and Interfaces

### `BlueprintWallProcessGraphHud`

Proposed location:

```text
client/src/components/three/scene-fusion/BlueprintWallProcessGraphHud.tsx
```

Responsibilities:

- render the wall-mounted `<Html transform>` surface;
- call `deriveBlueprintWallProcessData(input)` or receive already-derived data if the page later chooses to precompute it;
- map deriver nodes and edges to FlowGraph nodes and edges;
- render left metrics, bottom console, minimap, and controls;
- render empty state when `job` is absent or the deriver reports no blueprint data.

Non-responsibilities:

- mission-first wall behavior;
- sandbox terminal/screenshot store bridging;
- graph editing;
- backend event transformation;
- second stage progress formula.

This component and its `@ant-design/graphs` import MUST be lazy-loaded / code-split by `Scene3D` through `React.lazy` or a dynamic `import()`, so the mission-first `Scene3D` / `/tasks` bundle path never statically loads `@ant-design/graphs` and its heavy transitive dependencies (`@antv/g6`, `@antv/graphin`, `@antv/g6-extension-react`, `styled-components`). The blueprint graph chunk only loads when `Scene3D` runs in `mode === "blueprint"`. This satisfies NFR-2.5.

### `BlueprintWallGraphNodeCard`

Custom FlowGraph/G6 node component or HTML-style card renderer for all `BlueprintWallGraphNode.type` values.

Card shape:

```text
+------------------------------+
| [icon] type / status          |
| Node title                    |
| Short body                    |
+------------------------------+
```

Visual mapping:

| Node Type | Visual Role | Color Direction |
| --- | --- | --- |
| `user_goal` | source prompt / root question | blue |
| `stage` | process milestone | slate / active teal |
| `reasoning` | thinking/observing facts | teal |
| `route` | candidate route | violet |
| `spec_node` | spec tree/document node | purple |
| `capability` | tool/runtime invocation | amber or teal by status |
| `preview` | browser/architecture preview | blue |
| `artifact` | generated document/output | slate |
| `final` | terminal answer/handoff | green |

The style should be closer to the reference than to the earlier dark HUD mockup: pale canvas, soft card fills, colored borders, small square icons, and low-noise shadows.

### `mapWallDataToFlowGraph(data)`

Proposed helper:

```ts
function mapWallDataToFlowGraph(data: BlueprintWallProcessData): {
  data: {
    nodes: FlowGraphNodeData[];
    edges: FlowGraphEdgeData[];
  };
  layout: FlowGraphLayoutOptions;
}
```

Rules:

- Resolve each node to a single deterministic `visualStageLane` using the lookup table in the Column Remap section, then compute `x` from that lane. The remap only rewrites the column dimension; `node.row` is preserved unchanged and drives `y`.
- For `reasoning` nodes, read the lane from the `kind === "stage"` entry in `node.sourceRefs`; when absent, fall back to `data.stageSignal.stageIndex`. Never read a `node.stageId` field — graph nodes do not carry one.
- For `capability` nodes, use `data.stageSignal.stageIndex` (current stage lane); do not invent a fixed stage attribution.
- Preserve stable ids from the deriver.
- Preserve status/type/source refs in node data for custom card rendering.
- Convert edge kind/priority into FlowGraph/G6 edge style.
- Use FlowGraph/G6 cubic or polyline curves with dashed styling.
- Use edge labels from `edge.label`.

### Column Remap

The deriver deliberately returns graph-ready positions, but the current output uses two related column schemes:

- stage backbone nodes use `column = stageIndex` from `BLUEPRINT_SCENE_STAGES` (`0..8`);
- branch nodes use category columns inherited from the data spec (`user_goal=0`, `route=1`, `spec=2`, `reasoning/capability=3`, `preview/artifact/final=4`).

`BLUEPRINT_SCENE_STAGES` is a fixed 9-stage list with stable indices: `input=0`, `clarification=1`, `route_generation=2`, `route_selection=3`, `spec_tree=4`, `spec_docs=5`, `effect_preview=6`, `prompt_packaging=7`, `engineering_handoff=8`. There is no `runtime_capability` scene stage; it is only a backend alias that the deriver maps onto `engineering_handoff`, so the mapper must never target it.

The visual mapper must not apply a uniform `x = column * 330` to both schemes. That would place branch nodes beneath the wrong stage lane. Instead, the mapper resolves each node to a single deterministic stage lane (`visualStageLane`) using the table below. Every row produces exactly one `stageIndex`; there are no ranges, no "by kind" splits, and no future-data fallbacks.

| Node Type | Deriver Column | Visual Stage Lane (stageIndex) | Rule |
| --- | ---: | ---: | --- |
| `stage` | = stageIndex | own stageIndex (no remap) | Own stageIndex; backbone node, uses deriver column directly |
| `user_goal` | 0 | 0 (input) | Fixed |
| `reasoning` | 3 | matched sourceRef stage index; else `data.stageSignal.stageIndex` | Read the kind==="stage" entry in node.sourceRefs; fall back to data.stageSignal.stageIndex |
| `route` | 1 | 2 (route_generation) | Fixed to route_generation (not clarification, not route_selection) |
| `spec_node` | 2 | 4 (spec_tree) | Fixed to spec_tree (not route_generation, not spec_docs) |
| `capability` | 3 | `data.stageSignal.stageIndex` (current stage lane) | Current stage lane data.stageSignal.stageIndex; no reliable stage attribution, do not fabricate |
| `preview` | 4 | 6 (effect_preview) | Fixed |
| `artifact` | 4 | 8 (engineering_handoff) | Fixed; shares the final lane (different row, no overlap) |
| `final` | 4 | 8 (engineering_handoff) | Fixed |

Lane resolution rules that follow from the table:

- `reasoning` nodes carry their stage in `node.sourceRefs`, not on a `node.stageId` field. The mapper reads the entry where `kind === "stage"` and uses that stage's index as the lane. The deriver only appends such a `sourceRef` when the original entry's `stageId` hits a known stage, so when no `kind === "stage"` ref exists the mapper falls back to the current stage lane `data.stageSignal.stageIndex`.
- `capability` nodes have no reliable stage attribution in the data layer (`capabilityOwners` map only to roles, roles are not graph nodes, and the deriver intentionally draws no `capability → stage` edge). The mapper does not invent a fixed stage; it places capability nodes in the current stage lane `data.stageSignal.stageIndex`, identical to the no-known-stage `reasoning` fallback.
- `artifact` nodes are not split by `BlueprintWallArtifactInput.kind` (`code | document | diagram | log | other`). There is no strong kind-to-stage semantics, so all artifacts land deterministically in `engineering_handoff` (`stageIndex=8`), sharing the `final` lane. Artifacts and `final` occupy different rows, so they never overlap.

The remap only rewrites the column dimension into `visualStageLane` (which drives `x`). It does not change the row: `y` is still driven by each deriver node's own `row`.

Initial pixel layout after remap is deterministic and simple:

```text
x = visualStageLane * 330 + offsetX
y = row * 180 + offsetY
```

Here `visualStageLane` MUST be the remapped value from the table above, never the deriver's raw `node.column`. The wall graph may later evolve to a richer layout, but this spec uses deterministic positions so nodes do not jump between renders.

> Row spacing note (Task 7.4 browser-QA polish): the per-row vertical span started at `150` and was raised to `180` after Task 7.3 browser evidence. On a sparse early-stage job the 9 stage lanes make the content roughly `3100 x 780` (~4:1) while the wall canvas is `1680 x 760` (~2.2:1), so `fitView` is width-constrained and centers a short, wide block vertically, leaving the lower wall underused. Widening the row span spreads the populated rows so fit-view uses more vertical height, without changing card render size (the width-constrained fit scale is independent of row spacing) and without touching the horizontal lane span (cards are `300` wide against a `330` lane, so they cannot be compressed further). The lane span (`330`) and offsets are unchanged.

### Deterministic Layout vs FlowGraph Default Dagre

`@ant-design/graphs` `FlowGraph` ships with a default `layout: { type: 'dagre' }`. Dagre reads the configured `direction`/rankdir (LR or TB) and automatically re-ranks and repositions every node, ignoring any `x`/`y` already present on the node data. If the mapper simply hands `nodes`/`edges` to `FlowGraph` with the default layout active, dagre will overwrite the deterministic `visualStageLane`/`row` coordinates from the Column Remap section and break stage-lane alignment — route/spec/preview/artifact/final cards would be reflowed out of their owning stage lanes.

Therefore the implementation MUST:

- set each FlowGraph node's position to the remapped fixed `x`/`y` (`x = visualStageLane * 330 + offsetX`, `y = row * 180 + offsetY`);
- disable or override the built-in FlowGraph/G6 dagre auto-layout so node placement honors the supplied coordinates, for example by passing a static/preset-coordinate layout, or by explicitly turning the layout off so the graph respects the incoming positions.

Fallback decision: if the chosen `FlowGraph` wrapper cannot cleanly disable its default dagre layout, the implementation drops to the lower-level `@antv/g6` `Graph` API (still inside the Ant Design / AntV ecosystem) to retain deterministic coordinates. Switching the rendering layer in this way is a design change and MUST update this spec before the code is finalized.

This aligns with requirements Req 2 AC 8 (deterministic positions, no auto-layout reflow) and Req 2 AC 9 (the `@antv/g6` fallback).

### `BlueprintWallMetricsRail`

Renders the left rail:

```text
BURN
189116 tokens

SOURCES
371 sources

REMAINING
1057 points

TIME
5.7 min
```

Missing values render as muted placeholders such as `--`. In the current data layer, `tokenBurn`, `sourceCount`, `remainingPoints`, and `elapsedMs` are always `null`; real values require a later telemetry-input extension to `deriveBlueprintWallProcessData`.

### `BlueprintWallConsole`

Bottom overlay inside the wall surface. It renders `data.consoleLines`.

It should visually match the reference console: pale translucent background, compact monospace lines, command-like prefixes, and colored status text.

### Ant Design Graphs Usage

Add dependency:

```text
@ant-design/graphs
```

Use:

- `FlowGraph`;
- FlowGraph/G6 minimap capability when exposed cleanly;
- FlowGraph/G6 zoom and drag-canvas behaviors;
- FlowGraph/G6 grid/background options when useful.

FlowGraph/G6 settings:

- disable graph editing and node creation;
- disable edge creation / connection handles;
- enable drag-canvas and zoom-canvas only inside the wall surface;
- fit view on initial render and job changes;
- constrain min/max zoom for wall readability;
- disable or override the built-in dagre auto-layout; feed deterministic visualStageLane/row positions so node placement does not reflow;
- use deterministic layout input so the wall does not jump between renders.

### Transform Interaction Spike

`BlueprintWallProcessGraphHud` is mounted inside drei `<Html transform>`, which applies CSS transforms to the DOM surface. G6/FlowGraph uses pointer coordinates for canvas panning and zooming, so the first implementation must verify hit-testing inside the transformed wall before relying on interactive pan/zoom.

Fallback if hit-testing is unreliable:

- render a non-editable fitted FlowGraph view;
- keep the minimap/metrics/console overlays;
- expose fit/zoom controls as external wall buttons only when they can call graph APIs reliably;
- do not block the feature on full direct canvas pan/zoom.

## 3D Wall Placement

The existing mission wall strip uses:

```ts
WALL_MONITOR_POSITION = [0, 1.5, -4.88]
DEVICE_WIDTH = 1416
DEVICE_HEIGHT = 243
DEVICE_DISTANCE_FACTOR = 4.0
```

The blueprint wall graph should be substantially taller. Initial target:

```ts
BLUEPRINT_WALL_GRAPH_POSITION = [0, 3.85, -4.87]
BLUEPRINT_WALL_GRAPH_WIDTH = 1680
BLUEPRINT_WALL_GRAPH_HEIGHT = 760
BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR = 4.0
BLUEPRINT_WALL_GRAPH_PANEL_Z = 0.002
```

These are starting values, not final art direction. Playwright/browser visual QA should decide final fit. The graph must stay inside the back wall and not collide visually with role pets/desks in the default `/autopilot` camera. The wall graph remains a large wall-sized canvas; visual overlap must be solved by a blueprint-only taller back wall, flush wall placement, reduced floating-card treatment, and `Html` depth blending so foreground 3D roles can occlude the wall surface, not by shrinking the graph back into a small monitor strip.

In blueprint mode, `OfficeRoom` extends the real room wall to `17.4 × 8.2m` with center `y=4.1`, and hides the old mission cork board. Mission-first mode keeps the original `15.42 × 3m` wall and cork board. This gives the large FlowGraph a real wall-sized surface to live on instead of letting it overflow the old wall and read as a floating glass overlay.

## Data Models

### Component Props

`Scene3D` currently accepts only a subset of blueprint props. This spec needs additional blueprint wall inputs.

Proposed extension:

```ts
interface Scene3DProps {
  mode?: SceneFusionMode;
  blueprintJob?: BlueprintGenerationJob | null;
  blueprintRouteSet?: BlueprintRouteSet | null;
  blueprintSpecTree?: BlueprintSpecTree | null;
  blueprintEffectPreviews?: BlueprintEffectPreviewSnapshot[];
  blueprintAgentReasoningEntries?: AgentReasoningEntry[];
  blueprintCapabilityStatuses?: Record<string, CapabilityStatus>;
  blueprintCapabilityOwners?: Record<string, CapabilityOwner>;
  blueprintRolePhases?: Record<string, RolePhase>;
  blueprintArtifacts?: BlueprintWallArtifactInput[];
}
```

Only the blueprint branch consumes these props. Mission-first callers can omit them.

### FlowGraph Node Data

```ts
interface BlueprintWallGraphNodeCardData {
  wallNode: BlueprintWallGraphNode;
  previewSummary?: BlueprintWallPreviewSummary;
  locale: AppLocale;
}
```

The node card can inspect `wallNode.type`, `wallNode.status`, and `wallNode.accent` for visual styling.

### Edge Styling

| Edge Kind | Suggested Label/Color |
| --- | --- |
| `supports` | muted blue-gray |
| `depends_on` | teal |
| `produces` | blue |
| `uses_capability` | amber/teal |
| `refines` | purple |
| `blocks` | red |
| `answers` | green or final accent |

All edge styling is observational. The visual layer must not invent new semantic relationships.

## Error Handling

- If `job` is null, render a clean empty graph canvas with a short centered empty state.
- If the deriver returns no nodes, render the empty graph state and no stale mission data.
- If FlowGraph fails to fit view before layout is measured, retry fit on the next animation frame.
- If preview image/thumbnail is missing, render the preview URL/fallback marker from `previewSummary`; current data usually provides `url`, not a true thumbnail.
- If metrics are missing, render muted placeholders.
- If node count is high, cap or visually de-emphasize low-priority nodes in the wall view rather than making the 3D wall unreadable.

## Correctness Properties

### Property 1: Mode Isolation

**Validates: Requirements 1.1, 1.2**

Mission-first mode renders `SandboxMonitor`; blueprint mode renders `BlueprintWallProcessGraphHud`.

### Property 2: Deriver Single Source

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

All FlowGraph nodes, edges, metrics, console lines, preview state, and minimap data come from `deriveBlueprintWallProcessData(...)` output.

### Property 3: No Sandbox Leakage

**Validates: Requirements 3.7, 4.4, 4.5**

Blueprint wall graph rendering does not import or consume `useSandboxStore`, mission terminal logs, or mission screenshots.

### Property 4: Stable Graph Identity

**Validates: Requirements 3.2, 3.3**

FlowGraph node and edge ids are derived from stable deriver ids so graph state does not churn on each render.

### Property 5: Observational Graph

**Validates: Requirements 2.6, 6.6, 6.7, 9.2, 9.3, 9.4**

The wall graph allows inspection but does not allow editing, node creation, edge creation, or capability re-attribution.

### Property 6: Wall Fit

**Validates: Requirements 8.3, 8.4, 8.5**

The default graph view fits within the 3D back wall and remains legible at the default `/autopilot` desktop camera.

### Property 7: Stage-Lane Alignment

**Validates: Requirements 3.9**

Branch nodes are visually remapped to a single deterministic stage lane (per the Column Remap lookup table) before pixel positions are computed, so route/spec/preview/artifact/final cards do not appear under unrelated stage backbone nodes. The remap changes only the column-driven `x`; each node's `row`-driven `y` is preserved. `reasoning` lanes come from the `kind === "stage"` entry in `node.sourceRefs` (falling back to `data.stageSignal.stageIndex`), and `capability` lanes are `data.stageSignal.stageIndex`.

## Testing Strategy

### Unit / SSR Tests

Add tests near the scene-fusion / three test suites:

```text
client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-graph-hud.test.tsx
```

Recommended coverage:

1. `mapWallDataToFlowGraph` maps representative nodes and edges.
2. Mapping tests cover stage-lane remap for route, spec, preview, artifact, and final nodes.
3. Custom node card renders type, title, body, and status class.
4. Empty state renders for null job / empty deriver output.
5. Source-level test: `BlueprintWallProcessGraphHud` imports `@ant-design/graphs`.
6. Source-level test: `BlueprintWallProcessGraphHud` imports `deriveBlueprintWallProcessData`.
7. Source-level test: blueprint graph files do not import `useSandboxStore`.
8. Source-level test: `Scene3D` switches `SandboxMonitor` vs `BlueprintWallProcessGraphHud` by `mode`.
9. Existing `blueprint-wall-process-data.test.ts` remains green.

FlowGraph/G6 can be awkward in SSR. If full SSR rendering is brittle, use focused pure mapping tests plus source-level guard tests for the FlowGraph component. Do not weaken the deriver tests.

### Browser / Playwright QA

After implementation, verify:

1. Open `http://localhost:3000/autopilot`.
2. Confirm canvas is present and no console-blocking runtime error occurs.
3. Confirm blueprint wall shows a tall Ant Design FlowGraph graph, not the old three-pane strip.
4. Confirm minimap and controls are visible.
5. Confirm bottom console is inside the wall and not covering role models.
6. Confirm graph is not clipped on desktop.
7. Check a mobile/narrow viewport for a non-broken fallback.

### Verification Commands

Run:

```powershell
npx vitest run client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts
npx vitest run client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-graph-hud.test.tsx
node --run check
```

If a broader scene harness test exists for this surface, run it too.

## Key Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Renderer | `@ant-design/graphs` `FlowGraph` | User explicitly wants the Ant Design ecosystem flow graph direction |
| Wall switch | `Scene3D` branches by mode | Keeps `SandboxMonitor` mission-first instead of overloading it |
| Data source | `deriveBlueprintWallProcessData` | Prevents another state stitching layer |
| Layout | Deriver columns/rows mapped to FlowGraph layout data | Stable enough for wall, avoids jumpy auto-layout |
| Layout engine | Deterministic visualStageLane/row positions; built-in dagre disabled | Auto-layout would move branch nodes out of their stage lanes |
| Graph dependency loading | Lazy-load / code-split the blueprint graph component | Keep @ant-design/graphs out of the mission-first /tasks bundle path |
| Interaction | Observational pan/zoom only | Wall should not become a graph editor |
| Old monitor | Preserve for mission-first | Avoids breaking `/tasks` and mission runtime |
| Visual target | Pale canvas with cards, dashed curves, minimap, console | Matches user's reference image |

## Out Of Scope

- Fullscreen process graph route.
- Graph editing.
- Node dragging persistence.
- Edge creation.
- A separate full graph editor with persistent drag layout.
- Mission-first wall redesign.
- Modifying `MissionWallTaskPanel`.
- Backend event contract changes.
