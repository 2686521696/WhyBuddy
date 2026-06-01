# Design Document

## Overview

This design changes the wall-process data goal from compact HUD summaries to a graph-ready model for a tall 3D wall process graph. The final visible target is not a horizontal three-pane strip. It is a single large wall canvas similar to the user's reference: metrics on the left, a process graph in the center, console lines at the bottom, and a minimap in the lower-right.

This spec still does not render that UI. It only creates the pure data model that the later visual spec will consume.

```text
Autopilot page scoped props + realtime slices
        |
        v
deriveBlueprintWallProcessData(input)
        |
        v
BlueprintWallProcessData
  - stageSignal
  - nodes
  - edges
  - metrics
  - consoleLines
  - minimap
  - previewSummary
        |
        v
Future Tall Wall Process Graph (not implemented here)
```

Key principles:

1. `getBlueprintSceneStageSignal(job)` remains the only stage-progress source.
2. The module is pure: no React, no store hooks, no network, no timers.
3. The output is graph-ready, but the layout is deterministic and wall-bounded, not a generic unlimited DAG engine.
4. Mission-first wall behavior remains untouched.

## Architecture

### Existing State

```text
Scene3D
  └─ SandboxMonitor projectId={projectId}
       ├─ TerminalPreview        <- mission/sandbox log store
       ├─ MissionWallTaskPanel   <- mission-first task summary
       └─ ScreenshotPreview      <- mission screenshot/replay path

Scene3D
  └─ SceneStageFlow mode="blueprint" blueprintJob={job}
       └─ getBlueprintSceneStageSignal(job) <- existing 9-stage signal
```

The later visual spec will make blueprint mode render a taller wall graph instead of the strip. This data spec only prepares the graph data.

### New Data Module

```text
client/src/components/three/scene-fusion/
  ├─ blueprint-stage-signal.ts            (existing)
  └─ blueprint-wall-process-data.ts       (new)
```

`blueprint-wall-process-data.ts` exports only types and pure functions.

```ts
export interface DeriveBlueprintWallProcessDataInput {
  job: BlueprintGenerationJob | null | undefined;
  routeSet?: BlueprintRouteSet | null;
  specTree?: BlueprintSpecTree | null;
  effectPreviews?: BlueprintEffectPreviewSnapshot[];
  agentReasoningEntries?: AgentReasoningEntry[];
  capabilityStatuses?: Record<string, CapabilityStatus>;
  capabilityOwners?: Record<string, CapabilityOwner>;
  rolePhases?: Record<string, RolePhase>;
  artifacts?: BlueprintWallArtifactInput[];
  maxReasoningNodes?: number;
  maxConsoleLines?: number;
  locale?: AppLocale;
}
```

The realtime inputs use the existing `blueprint-realtime-store` slice shapes:

```ts
type CapabilityStatus = "idle" | "invoking" | "completed" | "failed";
type RolePhase =
  | "idle"
  | "activated"
  | "thinking"
  | "acting"
  | "observing"
  | "reviewing"
  | "sleeping"
  | "completed"
  | "failed";

interface CapabilityOwner {
  roleId: string;
  invocationId?: string;
  updatedAt: number;
}
```

`capabilityStatuses`, `capabilityOwners`, and `rolePhases` are all keyed maps from the realtime store:

```ts
capabilityStatuses: Record<capabilityId, CapabilityStatus>
capabilityOwners: Record<capabilityId, CapabilityOwner>
rolePhases: Record<roleId, RolePhase>
```

```ts
export interface BlueprintWallProcessData {
  stageSignal: BlueprintSceneStageSignal;
  nodes: BlueprintWallGraphNode[];
  edges: BlueprintWallGraphEdge[];
  metrics: BlueprintWallMetrics;
  consoleLines: BlueprintWallConsoleLine[];
  minimap: BlueprintWallMinimap;
  previewSummary: BlueprintWallPreviewSummary;
  compatibility: {
    stages: BlueprintWallStageItem[];
    routeSummary: BlueprintWallRouteSummary;
    specSummary: BlueprintWallSpecSummary;
    capabilitySummary: BlueprintWallCapabilitySummary;
    counters: BlueprintWallCounters;
  };
  emptyReason?: "no-job" | "no-blueprint-data";
}
```

The compatibility summaries keep the first data spec useful for tests and transition work, but the main output is now `nodes` and `edges`.

## Components and Interfaces

### `deriveBlueprintWallProcessData(input)`

Responsibility:

- normalize null/undefined inputs;
- call `getBlueprintSceneStageSignal(job)`;
- filter current-job collections;
- derive graph nodes and graph edges;
- derive wall metrics, console lines, minimap, and preview summary.

Non-responsibility:

- rendering;
- React hooks;
- store subscriptions;
- network fetches;
- mission-first fallback data;
- generic graph layout algorithms.

### Graph Nodes

```ts
export type BlueprintWallGraphNodeType =
  | "user_goal"
  | "stage"
  | "reasoning"
  | "route"
  | "spec_node"
  | "capability"
  | "preview"
  | "artifact"
  | "final";

export type BlueprintWallGraphNodeStatus =
  | "empty"
  | "queued"
  | "active"
  | "ready"
  | "completed"
  | "warning"
  | "failed";

export interface BlueprintWallGraphNode {
  id: string;
  type: BlueprintWallGraphNodeType;
  title: string;
  body?: string;
  status: BlueprintWallGraphNodeStatus;
  column: number;
  row: number;
  accent?: "teal" | "purple" | "red" | "blue" | "slate";
  sourceRefs: Array<{
    kind: "job" | "stage" | "reasoning" | "route" | "spec" | "capability" | "preview" | "artifact";
    id: string;
  }>;
}
```

Layout rule:

- The data layer assigns deterministic `column` and `row` values for a wall-bounded layout.
- It does not calculate pixel positions. The visual spec maps columns/rows to CSS/SVG coordinates.
- Suggested columns:
  - `0`: user goal / input
  - `1`: clarification / route
  - `2`: spec / documents
  - `3`: reasoning / capability
  - `4`: preview / handoff / final

### Graph Edges

```ts
export type BlueprintWallGraphEdgeKind =
  | "supports"
  | "depends_on"
  | "produces"
  | "uses_capability"
  | "refines"
  | "blocks"
  | "answers";

export interface BlueprintWallGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: BlueprintWallGraphEdgeKind;
  label?: string;
  priority: "primary" | "secondary" | "ambient";
}
```

Edge rule:

- Known relationships become edges.
- Unknown relationships are omitted, not guessed.
- Capability owner data must use real `capabilityOwners` when present. If a real owner is off-stage or unknown, the graph must not reassign the capability to another role.

### Stage Data

The graph contains stage nodes, and the compatibility block exposes stage items:

```ts
interface BlueprintWallStageItem {
  key: BlueprintSceneStageKey;
  label: string;
  index: number;
  state: "completed" | "active" | "upcoming";
}
```

Implementation rule:

- `stageSignal` must be exactly `getBlueprintSceneStageSignal(job)`.
- Stage state must be derived from `stageSignal.stageIndex`.
- No local backend-stage alias switch is allowed.

### Metrics

```ts
export interface BlueprintWallMetrics {
  tokenBurn?: number | null;
  sourceCount?: number | null;
  remainingPoints?: number | null;
  elapsedMs?: number | null;
  activeRoles: number;
  capabilities: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  artifacts: number;
}
```

Missing telemetry stays null/undefined. The deriver must not fabricate token or time values.

### Console Lines

```ts
export interface BlueprintWallConsoleLine {
  id: string;
  text: string;
  tone: "muted" | "info" | "success" | "warning" | "error";
  sourceRef?: {
    kind: "reasoning" | "preview-log";
    id: string;
  };
}
```

Sources:

- current-job reasoning entries;
- current-job effect preview `runtimeProjection.logTimeline` if available.

Default cap: 8 lines.

### Preview Summary

```ts
type BlueprintWallPreviewSummary =
  | {
      status: "ready";
      kind: "browser";
      previewId: string;
      title: string;
      thumbnailUrl?: string;
      url?: string;
    }
  | {
      status: "ready";
      kind: "architecture";
      previewId: string;
      title: string;
    }
  | {
      status: "empty";
      kind: "none";
      title: string;
    };
```

Rules:

- Prefer current-job `runtimeProjection.browserPreview` only when `browserPreview.url.trim().length > 0`.
- Fall back to current-job `architectureSvgDraft`.
- Never fall back to mission screenshot store.

### Minimap

```ts
export interface BlueprintWallMinimap {
  nodes: Array<{
    id: string;
    column: number;
    row: number;
    status: BlueprintWallGraphNodeStatus;
  }>;
  viewport: {
    columnStart: number;
    columnEnd: number;
    rowStart: number;
    rowEnd: number;
  };
}
```

The minimap is static data for the wall render. The later visual spec may add interaction, but this data spec does not.

## Data Models

### Input Boundary

Inputs are already available page/realtime data:

- `job`
- `routeSet`
- `specTree`
- `effectPreviews`
- `agentReasoningEntries`
- `capabilityStatuses`
- `capabilityOwners`
- `rolePhases`
- optional artifacts and telemetry-like values if already present in current page data

The module does not decide where page wiring happens. That belongs to the later `blueprint-wall-process-graph-hud-2026-05-31` spec.

### Output Boundary

`BlueprintWallProcessData` is a graph-ready wall view model, not a backend contract. It is allowed to be shaped for 3D wall rendering constraints.

## Error Handling

- Null job returns safe defaults with `stageSignal = getBlueprintSceneStageSignal(null)`.
- Malformed arrays are treated as empty by defensive helpers.
- Runtime capability statuses use the store union; `invoking` maps to running/active, `idle` counts in total but not running/completed/failed.
- Missing relationship data produces fewer edges, not guessed edges.
- Missing metrics stay null/undefined.
- Missing preview data returns explicit preview empty state.

## Correctness Properties

### Property 1: Determinism

The same input produces the same output. The deriver does not depend on time, randomness, stores, network, or mutable module-level state.

### Property 2: Stage Single Source

`stageSignal` equals `getBlueprintSceneStageSignal(job)`, and stage node state is derived from `stageSignal.stageIndex`.

### Property 3: Job Isolation

No reasoning or effect preview from another `job.id` appears in nodes, edges, console lines, metrics, or preview summary.

### Property 4: Preview Fallback Correctness

The `browserPreview` object always exists in the contract, so only a non-empty `browserPreview.url` counts as browser preview.

### Property 5: No Owner Re-Attribution

Real off-stage capability owners are not reassigned by heuristic.

### Property 6: No UI Side Effects

This spec does not modify `SandboxMonitor`, `MissionWallTaskPanel`, `Scene3D`, or any visible wall rendering.

## Testing Strategy

Create `client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts`.

Required cases:

1. Stage signal reuse:
   - returned `stageSignal` equals `getBlueprintSceneStageSignal(job)`;
   - stage node states derive from `stageSignal.stageIndex`.

2. Null input safe output:
   - `deriveBlueprintWallProcessData({ job: null })` returns empty nodes/edges, safe metrics, empty preview, and no throw.

3. Reasoning job isolation:
   - entries for `job-a` and `job-b` produce only current-job reasoning nodes and console lines.

4. Preview job isolation:
   - previews with different `runtimeProjection.jobId` values choose only the current job.

5. Architecture fallback:
   - browserPreview object exists but `url` is empty; `architectureSvgDraft` produces `kind: "architecture"`.

6. Graph nodes:
   - route/spec/reasoning/capability/preview inputs produce expected node types.

7. Graph edges:
   - stage order edges exist;
   - known capability/preview production edges exist;
   - uncertain relationships are omitted.

8. Metrics and minimap:
   - capability counts and active roles are deterministic;
   - minimap nodes mirror graph nodes.

9. Source-level guard:
   - module does not import React, `useSandboxStore`, `SandboxMonitor`, `MissionWallTaskPanel`, or `Scene3D`.

Regression tests to keep green:

- `client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
- `client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts`
- `node --run check`

## Key Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Stage progress source | Reuse `getBlueprintSceneStageSignal(job)` | Prevents a second truth source beside `SceneStageFlow` |
| Graph model | Wall-bounded graph nodes/edges | User wants the full reasoning map directly on the 3D wall |
| Layout engine | Deterministic columns/rows, no React Flow/dagre/elkjs | Good enough for the wall and keeps dependency/risk low |
| UI scope | No visible UI change in this spec | Keeps review focused on data correctness and job isolation |
| Later wall size | Target about 1680x760 at distanceFactor 4 | Turns the current horizontal strip into a tall process wall |
| Mission-first behavior | Do not modify `MissionWallTaskPanel` | `/tasks` and mission shell must remain stable |
| Sandbox store | Do not read/write `useSandboxStore` | Avoids stale cross-job bridge residue |

## Out Of Scope

- Rendering the tall wall process graph.
- Replacing `SandboxMonitor` visually.
- Modifying `Scene3D`.
- Modifying `MissionWallTaskPanel`.
- Adding fullscreen process graph route.
- Introducing React Flow, dagre, elkjs, or generic graph layout.
- Changing backend blueprint routes or emitters.
