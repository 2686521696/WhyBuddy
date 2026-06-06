# Requirements Document

## Introduction

The WhyBuddy `/autopilot` cockpit (frontend, under `client/src/pages/autopilot/`) is the
user-facing surface for the blueprint generation pipeline. The backend now fully implements
the **v4 closed-loop diagram** (`docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md`),
including the v4 **trust layer (信任层)**: the checks ledger (QA_LEDGER), content-quality /
EARS checks (QA_CONTENT), the structural + business invariant guard (SP_INV), the companion
review layer (CO: Critic + Grounding), the traceability matrix (EP_MATRIX), image-generation
provenance (EP_VIS_GEN provenance), and the image-audit → reforge loop (EP_VIS_AUDIT). These
all run on the backend and have been verified end-to-end producing real data, and all five env
gates are default-on under `dev:all`.

The frontend, however, does **not** surface any of these trust-layer nodes. The main flow
(input → clarification → route → spec tree → spec docs → effect preview → handoff) is fully
rendered, but the v4 青虚线 / ◆ / ◆◆ "trust" nodes and their aggregation edges into the ledger
are entirely absent from the UI. This feature builds the missing frontend so the `/autopilot`
cockpit faithfully reflects the v4 diagram ("分毫对齐 v4").

This is a **read-only frontend consumption** feature: it must NOT change backend behavior or
contracts. It surfaces data the backend already produces. It follows v4's two governing
principles:

- **"台账 = 问责中枢"** — the checks ledger is the aggregation hub; schema/invariant/
  content-quality/companion/preview-audit results all converge there, and the ledger flows into
  the delivery bundle.
- **"人是闸 (human is the gate)"** — all checks are non-blocking. Findings are surfaced for
  human review and never auto-block the pipeline.

### Scope summary (v4 nodes/edges this feature delivers)

| # | v4 node / edge | Frontend status today | This feature |
| - | -------------- | --------------------- | ------------ |
| 1 | QA_LEDGER 校验台账 | MISSING | New checks-ledger panel (aggregation hub) |
| 2 | EP_VIS_AUDIT 出图审计 + 回炉 | MISSING | Preview-audit verdict + reforge status UI |
| 3 | EP_VIS_GEN provenance ◆ | parsed, not rendered | Per-image provenance chip + "预览·未验证" label |
| 4 | EP_MATRIX 可追溯矩阵 | MISSING | Traceability matrix panel |
| 5 | CO 伴随发现 (Critic/Grounding) | MISSING | Companion findings surface |
| 6 | SP_INV 不变量守卫 | MISSING | Invariant guard section in ledger panel |
| 7 | QA_CONTENT 内容质量 (EARS) | MISSING | Content-quality section in ledger panel |
| 8 | EP_HAND 加厚交付包 | PARTIAL | Bundle: + ledger + matrix + provenance-labeled previews + open items |
| 9 | RT_GATE / ESC / QA_MERGE 小控件 | MISSING | Route confirm gate / abort-escalate / merge gate surfaces |
| 10 | Cross-cutting | n/a | API wrappers, store/hooks, i18n, states, tests |

### Out of scope

- Any change to backend routes, services, contracts, or the five env gates.
- Building net-new pipeline stages; this feature only visualizes existing backend output.
- Mobile-first redesign of the cockpit (desktop `/autopilot` rail is the target; responsive
  behavior must not regress but no new mobile layouts are required).

### Anchor files (where this feature plugs in)

- `client/src/lib/blueprint-api.ts` — add read-only fetch wrappers.
- `client/src/lib/blueprint-realtime-store.ts` — optional derived slices / no new socket truth source.
- `client/src/pages/autopilot/AutopilotRoutePage.tsx` — page/flow integration.
- `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx` + `resolve-rail-sub-stage.ts` — new rail tabs/panels.
- `client/src/pages/autopilot/right-rail/panels/` — new panel components live here.
- `client/src/components/autopilot/EffectPreviewImagePanel.tsx` + `right-rail/panels/EffectPreviewPanel.tsx` — provenance rendering.
- `client/src/lib/blueprint-copy.ts` — bilingual copy.

---

## Requirements

### Requirement 1: Read-only blueprint trust-layer API wrappers

**User Story:** As a frontend developer, I want typed read-only API wrappers for the v4
trust-layer endpoints, so that panels can fetch checks-ledger and traceability-matrix data
consistently with the existing `blueprint-api` patterns and without touching the backend.

#### Acceptance Criteria

1. THE feature SHALL add `fetchChecksLedger(jobId, filters?)` to `client/src/lib/blueprint-api.ts` that GETs `/api/blueprint/jobs/:jobId/checks-ledger` and returns a typed result via the existing `fetchJsonSafe` + `ApiRequestError` pattern.
2. WHEN `filters.stage`, `filters.status`, or `filters.checkType` are provided, THE wrapper SHALL append them as query parameters with proper URL encoding.
3. THE feature SHALL add `fetchTraceabilityMatrix(jobId, format?)` that GETs `/api/blueprint/jobs/:jobId/traceability-matrix` and returns a typed result; WHEN `format === "markdown"` THE wrapper SHALL request and return the markdown body, otherwise the JSON `{ matrix }`.
4. WHEN the endpoint responds 404 (`matrix_not_generated` / `job_not_found`), THE wrappers SHALL return a structured non-throwing result distinguishing "not generated yet" from transport errors.
5. THE wrappers SHALL define and export TypeScript types mirroring the backend response shapes (`ChecksLedgerResponse` with `entries[]` + `summary{total,pass,warn,fail,skip}`; `TraceabilityMatrix` with `entries[]` + `coverage{coveragePercent,gaps,uncoveredRequirements,...}`), reusing `@shared/blueprint` types where they already exist.
6. THE wrappers SHALL NOT issue write requests and SHALL NOT mutate any backend state.
7. THE feature SHALL add unit tests for each wrapper covering success, 404-not-generated, and transport-error paths, following `client/src/lib/blueprint-api.test.ts` conventions.

### Requirement 2: Checks Ledger panel (QA_LEDGER — 问责中枢)

**User Story:** As a user reviewing an autopilot run, I want a checks-ledger panel that
aggregates every recorded check, so that I can see the single accountability hub the v4 diagram
calls "台账 = 问责中枢".

#### Acceptance Criteria

1. THE feature SHALL add a `ChecksLedgerPanel` component under `client/src/pages/autopilot/right-rail/panels/` that consumes `fetchChecksLedger(jobId)`.
2. THE panel SHALL render a summary header with counts for `total`, `pass`, `warn`, `fail`, and `skip`, each visually distinct.
3. THE panel SHALL group ledger entries by `stage` (e.g. `spec_tree`, `spec_docs`, `effect_preview`) and within each group display `checkName`, `checkType`, `status`, `validator`, and `output`.
4. WHEN an entry `status` is `warn` or `fail`, THE panel SHALL visually highlight it (distinct color/badge) and surface it above `pass`/`skip` entries.
5. THE panel SHALL provide filter controls for `checkType` (schema / invariant / content_quality / companion_trace / preview_audit) and `status`, re-fetching or client-filtering accordingly.
6. WHEN `BLUEPRINT_CHECKS_LEDGER_ENABLED` is off (endpoint returns empty `summary.total === 0` and `entries: []`), THE panel SHALL render a clear "校验台账未启用 / not enabled" empty state rather than an error.
7. WHILE the ledger request is in flight, THE panel SHALL render a loading state; WHEN the request fails with a transport error, THE panel SHALL render an error state with a retry affordance.
8. THE panel SHALL reflect the non-blocking philosophy: it SHALL present `warn`/`fail` as review signals and SHALL NOT imply the pipeline was auto-blocked.

### Requirement 3: Invariant guard surface (SP_INV)

**User Story:** As a user, I want the spec-tree structural and business invariant results
surfaced, so that I can see requirement-coverage and per-node-evidence guard outcomes (v4 SP_INV).

#### Acceptance Criteria

1. THE Checks Ledger panel SHALL render a dedicated section (or filter preset) for `checkType === "invariant"` entries at `stage === "spec_tree"`.
2. THE section SHALL display the structural invariant result (schema/flatten-remap) and the business invariants (`business_requirement_coverage`, `business_node_evidence`) with their `status` and `output`.
3. WHEN a business invariant `status` is `skip` (e.g. no success criteria available), THE section SHALL render the skip reason from `output` rather than hiding the entry.
4. THE section SHALL NOT present invariant `warn`/`fail` as a blocking gate, consistent with the soft-check philosophy.

### Requirement 4: Content quality / EARS surface (QA_CONTENT)

**User Story:** As a user, I want content-quality and EARS-compliance results surfaced, so that
I can judge spec-document substance and acceptance-criteria phrasing (v4 QA_CONTENT).

#### Acceptance Criteria

1. THE Checks Ledger panel SHALL render a section (or filter preset) for `checkType === "content_quality"` entries at `stage === "spec_docs"`.
2. THE section SHALL display per-document substance results and the EARS-pattern result for requirements documents, with `status` and `output`.
3. WHEN content-quality entries are absent (gate off or no docs generated), THE section SHALL render an empty state, not an error.

### Requirement 5: Effect-preview image provenance (EP_VIS_GEN ◆)

**User Story:** As a user viewing generated UI previews, I want each image's provenance shown,
so that I can tell a real model image from a fallback/placeholder and know it is unverified
(v4 EP_VIS_GEN: "标『预览·未验证』").

#### Acceptance Criteria

1. THE feature SHALL render, for each image in `effectPreview.imageBase64ByNodeId[nodeId]`, a provenance chip derived from `provenance.source` and `provenance.ok` in `client/src/components/autopilot/EffectPreviewImagePanel.tsx`.
2. WHEN `provenance.source === "model"` AND `provenance.ok === true`, THE chip SHALL render a "真实生成 / model" success state.
3. WHEN `provenance.source === "fallback"` OR `provenance.ok === false`, THE chip SHALL render a non-success state ("兜底/失败 / fallback") visually distinct from success.
4. THE chip SHALL surface `provenance.modelUsed`, `provenance.retryCount`, and any `provenance.errorIndicators` when present.
5. THE feature SHALL render a persistent "预览·未验证 / preview · unverified" label on every generated preview image regardless of provenance.
6. WHEN a node appears in `failedProvenanceByNodeId` (honest failure, no image), THE panel SHALL show a "缺图 / no image" state with the failure provenance and SHALL NOT render a placeholder image (禁兜底假图).
7. THE provenance rendering SHALL NOT alter existing image rendering, the architecture SVG draft, or break existing effect-preview tests.

### Requirement 6: Preview audit verdict + reforge loop (EP_VIS_AUDIT ◆◆)

**User Story:** As a user, I want the image-audit verdict and reforge status surfaced, so that I
can see whether generated previews passed the fraud audit and whether any fake image was sent
back for regeneration (v4 EP_VIS_AUDIT: check_previews_real + 回炉).

#### Acceptance Criteria

1. THE feature SHALL surface preview-audit results from checks-ledger entries where `checkType === "preview_audit"` (stage `effect_preview`), either within the effect-preview panel or as a dedicated audit subsection.
2. THE audit surface SHALL display the batch verdict (`pass` / `fail`) and, when present, the fraud finding categories: fallback-fraud (`source:"fallback"` AND `ok:true`), fake-success (`ok:true` with `errorIndicators`), and duplicate (byte-identical) detections.
3. WHEN a reforge was requested (`preview_audit.regenerate_requested` / retry entries) THE surface SHALL show the reforge status and `retryCount`.
4. WHEN `retryCount` reached the maximum and audit still failed (`preview_audit_retry_exhausted`), THE surface SHALL show an "回炉耗尽 / retry exhausted" state.
5. THE audit surface SHALL render an empty state when no preview-audit entries exist (no images generated, or gate off), not an error.
6. THE feature SHALL frame the audit as user-run accountability evidence (v4: "用户自跑"), not as an agent-mutable step.

### Requirement 7: Traceability matrix panel (EP_MATRIX)

**User Story:** As a user, I want a traceability matrix panel, so that I can see requirement ↔
design ↔ task ↔ evidence ↔ test coverage and the specific gaps (v4 EP_MATRIX).

#### Acceptance Criteria

1. THE feature SHALL add a `TraceabilityMatrixPanel` component under `right-rail/panels/` that consumes `fetchTraceabilityMatrix(jobId)`.
2. THE panel SHALL render `coverage.coveragePercent` as a prominent indicator (e.g. ring/bar) plus the per-dimension counts (`coveredByDesign`, `coveredByTasks`, `coveredByEvidence`, `coveredByTests`, `totalRequirements`).
3. THE panel SHALL render a five-column table mapping each requirement to its design sections, task items, evidence sources, and test cases.
4. THE panel SHALL render `coverage.gaps` / `coverage.uncoveredRequirements` as an explicit gap list, turning the matrix from "display" into "guard".
5. WHEN the matrix is `stale` (spec_tree changed), THE panel SHALL render a stale indicator.
6. WHEN the endpoint returns `matrix_not_generated` (404), THE panel SHALL render a "矩阵未生成 / not generated yet" empty state with guidance, not an error.
7. THE panel SHALL offer a markdown export action that calls `fetchTraceabilityMatrix(jobId, "markdown")` and triggers a browser download, consistent with `exportSpecDocuments.ts`.

### Requirement 8: Companion findings surface (CO — Critic / Grounding)

**User Story:** As a user, I want Critic and Grounding findings surfaced near the stages they
target, so that adversarial review and grounding evidence are visible at review time (v4 CO,
R2.8: warn/error findings must be exposed to handoff/review).

#### Acceptance Criteria

1. THE feature SHALL read `job.companionFindings[]` from the job details payload (no new socket truth source) and expose them in the autopilot UI.
2. THE companion surface SHALL render each finding's `role` (critic / grounding), `severity` (info / warn / error), `stage`, `findings[]`, `suggestedActions[]`, and `citations[]`.
3. WHEN a finding includes `repoFilesRead[]`, THE surface SHALL display the grounded repo files (Grounding evidence).
4. THE surface SHALL prioritize `warn` and `error` severity findings so they are not buried (R2.8 exposure requirement).
5. WHEN there are no companion findings (gate off or none produced), THE surface SHALL render an empty state, not an error.
6. THE surface SHALL associate findings with their `stage` (clarification / route_generation / spec_tree) so the user can see which stage each finding targets.
7. THE companion findings SHALL also be reflected in the checks ledger view via `checkType === "companion_trace"` entries (留痕进台账), keeping ledger as the aggregation hub.

### Requirement 9: Thickened handoff / delivery bundle (EP_HAND)

**User Story:** As a user exporting a delivery package, I want the bundle to include the trust
artifacts, so that the handoff reflects v4's "加厚交付包" (checks ledger + traceability matrix +
provenance-labeled previews + open items).

#### Acceptance Criteria

1. THE feature SHALL extend the handoff/export surface (building on `EngineeringHandoffPanel.tsx` and `blueprint-api/exportSpecDocuments.ts`) to present links/sections for: the checks ledger, the traceability matrix, and the visual previews with source/provenance labels.
2. THE delivery surface SHALL show an "open items / 未决项" section derived from ledger `warn`/`fail` entries and matrix gaps.
3. THE delivery surface SHALL label every included visual preview with its provenance source (model / fallback / template) consistent with Requirement 5.
4. THE feature SHALL NOT remove or regress the existing spec-document md/zip export.
5. WHEN trust artifacts are unavailable (gates off / not generated), THE delivery surface SHALL omit those sections gracefully without errors.

### Requirement 10: Right-rail integration and navigation

**User Story:** As a user, I want the new trust panels integrated into the autopilot right rail,
so that they appear in context without disrupting the existing main-flow panels.

#### Acceptance Criteria

1. THE feature SHALL mount the new panels (checks ledger, traceability matrix, companion findings) into `AutopilotRightRail.tsx` as additional tabs/sections, using the existing sub-stage routing patterns in `resolve-rail-sub-stage.ts` / `sub-stage-summary.ts`.
2. THE new panels SHALL become available once their underlying data can exist (e.g. ledger/companion after spec_tree; matrix after spec docs; preview audit after effect preview) and SHALL render empty states before then.
3. THE feature SHALL NOT remove, reorder destructively, or break the existing panels (AgentCrewFabric / SpecTree / SpecDocuments / EffectPreview / PromptPackage / RuntimeCapability / EngineeringHandoff / ArtifactMemory).
4. THE integration SHALL keep the existing 3-page projection (`resolveActiveAutopilotPage`) and main flow (`readAutopilotWorkflowStage`) behavior unchanged.

### Requirement 11: Route confirm gate, abort/escalate, merge gate (RT_GATE / ESC / QA_MERGE)

**User Story:** As a user, I want the lightweight v4 gate/escape controls represented, so that
the route confirm gate, abort/escalate path, and merge gate are visible in the cockpit.

#### Acceptance Criteria

1. THE feature SHALL surface a route confirm-gate affordance (RT_GATE) at the route-selection step, making the "confirm to proceed" decision explicit in the UI.
2. THE feature SHALL surface an abort / escalate-to-human control (ESC) reachable from the run, representing v4's "超预算·不收敛 → 转人工" path, wired to existing replan/escalation semantics where available and otherwise presented as a clearly-labeled non-functional placeholder pending backend support.
3. THE feature SHALL surface a merge-gate (QA_MERGE) read-only status that reflects test + content-quality results from the ledger, presented as human-judged (not auto-merge).
4. WHERE backend support for a given control does not exist, THE feature SHALL clearly mark it as informational only and SHALL NOT fabricate success states.

### Requirement 12: Internationalization (zh-CN / en-US)

**User Story:** As a bilingual user, I want all new trust-layer UI to render in both Chinese and
English, so that the cockpit stays consistent with the existing i18n.

#### Acceptance Criteria

1. THE feature SHALL route all new user-facing strings through the existing copy/i18n mechanism (`client/src/lib/blueprint-copy.ts` and the app locale system) with zh-CN and en-US variants.
2. THE feature SHALL NOT hard-code untranslated user-facing literals in the new panels.
3. THE new copy SHALL preserve v4 terminology (校验台账 / 可追溯矩阵 / 出图审计 / 伴随发现 / 预览·未验证).

### Requirement 13: Loading, empty, error, and gates-off states

**User Story:** As a user, I want every new panel to behave gracefully regardless of data
availability, so that the cockpit never shows raw errors or misleading blanks.

#### Acceptance Criteria

1. EACH new panel SHALL implement distinct loading, empty, error, and (where applicable) stale states.
2. WHEN a trust gate is disabled, THE corresponding panel SHALL render an explicit "未启用 / not enabled" state distinguishable from "no data yet".
3. WHEN a fetch fails with a transport/HTTP error, THE panel SHALL render an error state with a retry affordance and SHALL NOT crash the rail.
4. THE empty/error states SHALL be covered by component tests.

### Requirement 14: No regression and read-only guarantee

**User Story:** As a maintainer, I want assurance the feature does not regress existing behavior
or mutate the backend, so that the main pipeline and existing tests stay green.

#### Acceptance Criteria

1. THE feature SHALL NOT modify any file under `server/` or any backend contract.
2. THE feature SHALL NOT introduce a second source of truth for mission/workflow/runtime state; new data SHALL be fetched read-only or derived from existing job payloads/socket store.
3. THE feature SHALL keep the existing autopilot test suite passing and SHALL NOT alter the behavior of existing main-flow panels.
4. THE feature SHALL add new unit/component tests for every new wrapper, panel, and the provenance rendering, and SHALL keep `node --run check` from gaining new errors attributable to this feature.

### Requirement 15: Faithfulness to v4 ("分毫对齐") and accessibility

**User Story:** As the product owner, I want the UI to faithfully represent the v4 diagram and
be accessible, so that the cockpit is an honest, usable mirror of the closed loop.

#### Acceptance Criteria

1. THE feature SHALL represent the v4 trust-layer nodes and their aggregation edges into the ledger (QA_LEDGER as hub) and the image-audit→reforge loop as drawn in the v4 diagram.
2. THE feature SHALL NOT overstate automation: surfaced checks SHALL be presented as review signals with the human as the final gate.
3. THE new interactive controls and status indicators SHALL meet basic accessibility expectations (semantic roles, keyboard focusability, sufficient color contrast, non-color-only status encoding).
4. THE feature SHALL keep glass-panel / token-based styling consistent with the existing autopilot rail components.

---

## Glossary

- **v4 diagram / 闭环总图 v4**: The reference architecture `docs/assets/WhyBuddyArc/WhyBuddySkill闭环总图_改进版v4.md` this feature aligns the frontend to.
- **Trust layer / 信任层**: The v4 ★ / ◆ / ◆◆ nodes that make the pipeline accountable — checks ledger, content quality, invariant guard, companion review, traceability matrix, image provenance, image audit + reforge.
- **QA_LEDGER / 校验台账 / Checks Ledger**: The aggregation hub recording every check (`GET /api/blueprint/jobs/:id/checks-ledger`). v4 principle: "台账 = 问责中枢".
- **checkType**: Ledger entry category — `schema` | `invariant` | `content_quality` | `companion_trace` | `preview_audit`.
- **SP_INV / Invariant Guard**: Structural (unique root / parent reachable / depth / acyclic) + business (requirement-coverage, per-node evidence) invariants recorded as `invariant` ledger entries. Soft checks.
- **QA_CONTENT / Content Quality**: Document substance + EARS-phrasing checks recorded as `content_quality` ledger entries.
- **CO / Companion**: The on-demand review layer — **Critic** (挑刺者, finds gaps/weak evidence) and **Grounding** (接地者, reads real repo, forces real citations). Surfaced via `job.companionFindings[]` and `companion_trace` ledger entries.
- **EP_VIS_GEN / 视觉预览·生成**: Per-requirement image generation. Each image carries `BlueprintPreviewProvenance { source, ok, errorIndicators, modelUsed, retryCount }`. Honest failures appear in `failedProvenanceByNodeId` with no image (禁兜底假图).
- **EP_VIS_AUDIT / 出图审计 / check_previews_real**: Audits image provenance for fallback-fraud (`source:"fallback"` AND `ok:true`), fake-success (`ok:true` with errors), and byte-duplicate fraud; failing images are sent back for reforge (回炉) up to a max retry count.
- **EP_VIS_REND / 结构图·渲染**: Deterministic Mermaid/SVG rendering of the spec tree / architecture (already FULL in frontend via `MermaidBlock.tsx` + `architectureSvgDraft`).
- **EP_MATRIX / 可追溯矩阵 / Traceability Matrix**: requirement ↔ design ↔ task ↔ evidence ↔ test mapping with `coveragePercent` and `gaps` (`GET /api/blueprint/jobs/:id/traceability-matrix`).
- **EP_HAND / 交付包**: The delivery/export bundle; v4 "加厚" version includes the ledger, matrix, and provenance-labeled previews.
- **Gates-off**: When a `BLUEPRINT_*_ENABLED` env gate is disabled, the corresponding backend service no-ops and the panel renders a "未启用 / not enabled" state.
- **人是闸 / Human is the gate**: v4 non-blocking philosophy — checks surface review signals; nothing auto-blocks delivery.
- **Right rail**: The `client/src/pages/autopilot/right-rail/` panel column where stage-scoped panels render.
