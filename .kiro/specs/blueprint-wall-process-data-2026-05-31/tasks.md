# Implementation Plan

> Goal: deliver the pure graph-ready data layer for the tall 3D blueprint wall process graph. This spec does not change visible 3D UI. A later `blueprint-wall-process-graph-hud-2026-05-31` spec will make the wall taller and render the graph.

## Task 1: Add pure data module skeleton

- [x] 1.1 Create `client/src/components/three/scene-fusion/blueprint-wall-process-data.ts`.
  - Export `DeriveBlueprintWallProcessDataInput`.
  - Export `BlueprintWallProcessData` and graph subtypes.
  - Export `deriveBlueprintWallProcessData(input)`.
  - Initial implementation may return safe empty graph data, but it must call `getBlueprintSceneStageSignal(input.job)`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_

- [x] 1.2 Create `client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts`.
  - Add null job safe-output test.
  - Add `stageSignal` consistency test against `getBlueprintSceneStageSignal(job)`.
  - _Requirements: 1.6, 2.1, 2.2, NFR-1_

- [x] 1.3 Run:
  - `npx vitest run client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts`
  - Expected: new tests pass.

## Task 2: Implement stage graph nodes

- [x] 2.1 Generate stage nodes from `stageSignal` and `BLUEPRINT_SCENE_STAGES`.
  - Do not write a new backend stage switch.
  - `completed / active / upcoming` style status must derive from `stageSignal.stageIndex`.
  - Stage nodes use stable ids such as `stage:${stageKey}`.
  - _Requirements: 2.2, 2.3, 2.4, 4.4_

- [x] 2.2 Add tests:
  - backend alias such as `preview` matches `getBlueprintSceneStageSignal`;
  - stage node count equals `BLUEPRINT_SCENE_STAGES.length`;
  - active stage node is based on `stageSignal.stageIndex`.
  - _Requirements: 2.3, 2.4, 2.5_

## Task 3: Implement reasoning nodes and console lines

- [x] 3.1 Implement current-job reasoning filtering.
  - When `job.id` exists, include only `entry.jobId === job.id`.
  - Create reasoning graph nodes with type `reasoning`.
  - Default `maxReasoningNodes` should keep the wall readable; use 12 unless input overrides it.
  - _Requirements: 3.1, 4.1, 4.2, 4.5_

- [x] 3.2 Implement `consoleLines`.
  - Derive from current-job reasoning entries.
  - Include effect-preview `runtimeProjection.logTimeline` when available and current-job scoped.
  - Default cap is 8; support `maxConsoleLines`.
  - _Requirements: 6.4, 6.5, 6.6_

- [x] 3.3 Add tests:
  - `job-a` excludes `job-b` reasoning.
  - max reasoning node cap works.
  - max console line cap works.
  - error phase maps to error tone/status.
  - _Requirements: 3.1, 4.5, 6.4-6.6_

## Task 4: Implement route/spec/capability/preview nodes

- [x] 4.1 Implement user-goal and route nodes.
  - Create a `user_goal` node from job title/prompt/objective when available.
  - Read routes from input `routeSet`.
  - Create stable route node ids.
  - Preserve compatibility `routeSummary`.
  - _Requirements: 4.6, 4.7_

- [x] 4.2 Implement spec nodes.
  - Read nodes from input `specTree`.
  - Create root/top-level spec graph nodes suitable for wall display.
  - Preserve compatibility `specSummary`.
  - _Requirements: 4.6_

- [x] 4.3 Implement capability nodes.
  - Read `capabilityStatuses` and `capabilityOwners`.
  - Use real owners when present.
  - Do not infer a replacement owner for off-stage/unknown real owners.
  - Preserve compatibility `capabilitySummary`.
  - _Requirements: 4.6, 5.6_

- [x] 4.4 Implement preview node and `previewSummary`.
  - Prefer `runtimeProjection.jobId === job.id` and non-empty `runtimeProjection.browserPreview.url`.
  - Treat `runtimeProjection.browserPreview` field presence as insufficient because the object is non-optional in the contract.
  - Fall back to current-job `architectureSvgDraft`.
  - _Requirements: 3.2, 7.1, 7.2, 7.3, 7.4_

- [x] 4.5 Implement artifact and final nodes.
  - Define local `BlueprintWallArtifactInput` in the new module if no existing suitable exported type exists.
  - Create `artifact` nodes for current-job artifact inputs.
  - Create a `final` node when a terminal answer/handoff/landing artifact is present.
  - Preserve artifact count in metrics/compatibility.
  - _Requirements: 4.8, 4.9, 6.2, 8.1-8.3_

- [x] 4.6 Add tests:
  - user goal input creates a `user_goal` node.
  - route/spec inputs create expected node types.
  - capability status creates capability nodes and counts.
  - stale preview is excluded by `runtimeProjection.jobId`.
  - empty browser URL falls back to architecture preview.
  - artifact input creates an `artifact` node.
  - terminal artifact creates a `final` node.
  - _Requirements: 3.2, 4.6-4.11, 7.1-7.4_

## Task 5: Implement graph edges

- [x] 5.1 Add stage-order edges.
  - Connect `stage:${prev}` to `stage:${next}` with kind `depends_on`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5.2 Add known relationship edges.
  - Route/spec/preview/capability nodes connect to nearest known stage node.
  - Reasoning nodes connect to their stage or source role/capability when known.
  - Known terminal result nodes receive `answers` edges from supporting reasoning/artifact nodes.
  - Omit uncertain relationships instead of guessing.
  - _Requirements: 5.5, 5.6, 5.7, 5.8_

- [x] 5.3 Add tests:
  - stage order edges exist.
  - preview production edge exists when preview node exists.
  - final node receives an `answers` edge when a known terminal result exists.
  - capability owner is not guessed when real owner is off-stage/unknown.
  - uncertain relationships are omitted.
  - _Requirements: 5.1-5.8_

## Task 6: Implement metrics and minimap

- [x] 6.1 Implement `metrics`.
  - Active role count from `rolePhases`.
  - Capability totals from `capabilityStatuses`.
  - Artifact count from available input artifacts/effect previews/spec/route data.
  - Token/source/time/remaining values remain null/undefined unless already present in input.
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 6.2 Implement `minimap`.
  - Minimap nodes mirror graph node ids, columns, rows, and statuses.
  - Viewport is deterministic and safe for static wall rendering.
  - _Requirements: 7.5, 7.6, 7.7_

- [x] 6.3 Add tests:
  - capability metrics are correct.
  - missing token/time metrics are not fabricated.
  - minimap nodes mirror graph nodes.
  - compatibility summaries are derived from the same current-job data.
  - default `maxReasoningNodes` is 12 and default `maxConsoleLines` is 8.
  - _Requirements: 6.1-6.3, 7.5-7.7, 8.1-8.5_

## Task 7: Guard the data-only boundary

- [x] 7.1 Add source-level guard test.
  - New module does not import React.
  - New module does not import `useSandboxStore`.
  - New module does not import `SandboxMonitor`, `MissionWallTaskPanel`, or `Scene3D`.
  - New module does not import React Flow, dagre, or elkjs.
  - _Requirements: 1.2, 3.5, 9.1-9.7_

- [x] 7.2 Confirm this spec does not modify:
  - `client/src/components/three/SandboxMonitor.tsx`
  - `client/src/components/three/MissionWallTaskPanel.tsx`
  - `client/src/components/Scene3D.tsx`
  - No hook/adapter wiring is added in this spec.
  - _Requirements: 9.1-9.8, NFR-2.3_

## Task 8: Verification and closeout

- [x] 8.1 Run focused tests:
  - `npx vitest run client/src/components/three/scene-fusion/__tests__/blueprint-wall-process-data.test.ts`
  - `npx vitest run client/src/components/three/scene-fusion/__tests__/blueprint-stage-signal.test.ts`
  - _Requirements: NFR-1, NFR-2.2_

- [x] 8.2 Run:
  - `node --run check`
  - Expected: exit 0.
  - _Requirements: NFR-2.1_

- [x] 8.3 Update this `tasks.md` with completed checkboxes and report:
  - graph-ready data layer complete;
  - visible UI unchanged;
  - next step is `blueprint-wall-process-graph-hud-2026-05-31`, which will make the blueprint wall tall and render the graph directly in 3D.
  - _Requirements: NFR-3_

## Verification Checklist

- [x] New pure graph data test suite passes. (46 tests green)
- [x] Existing stage-signal tests pass. (26 tests green)
- [x] Stage-signal compatibility remains covered by `blueprint-stage-signal.test.ts`; no standalone `SceneStageFlow.test.tsx` exists in this repo.
- [x] `node --run check` exits 0.
- [x] No visible 3D UI files changed in this spec. (git status: only the new module + test + spec dir are added; SandboxMonitor / MissionWallTaskPanel / Scene3D untouched.)
