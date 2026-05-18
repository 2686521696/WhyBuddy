# Requirements Document

## Introduction

把 Autopilot 蓝图管线生成的 `BlueprintSpecDocument` 集合（每节点 `requirements.md` / `design.md` / `tasks.md`）暴露为可下载的 markdown / zip 文件。当前主仓 `BlueprintSpecDocument` 已含 `content: string` 字段，前端右栏 `SpecDocPreviewBlock` 只渲染了 H2 + 3 行预览，用户无法直接拿到完整 markdown 做归档、走 review、或喂给外部 spec 工具。

本 spec 在不改 `BlueprintSpecDocument` 数据形态、不修改 prompt / parser / runtime 主线的前提下：

- 后端新增 `GET /api/blueprint/jobs/:jobId/spec-documents/export` 路由，返回 zip 包；按 query 参数支持单文档 / 单节点 / 整树三种颗粒度。
- 前端在 `SpecDocPreviewBlock` 与 `SpecTreeWorkbench` 各加导出入口，调用导出 API 触发下载。
- TypeScript 116 基线不变；既有 5140+ 测试不破。

## Glossary

- **Spec_Documents**：Autopilot 蓝图管线产出的规格文档集合，每个 SPEC 树节点对应 `requirements` / `design` / `tasks` 三类。
- **Export_Route**：后端新增的 `GET /api/blueprint/jobs/:jobId/spec-documents/export` 路由。
- **Export_Granularity**：导出颗粒度，枚举 `single` / `node` / `tree`。
- **Export_Archive**：导出产物，单文档时为 `text/markdown` 响应，节点 / 整树时为 `application/zip` 响应。
- **SpecExportButton**：前端在 `SpecDocPreviewBlock` 与 `SpecTreeWorkbench` 中新增的导出按钮组件。
- **Filename_Sanitizer**：把 `node.title` 转为合法文件名片段的纯函数（去除 `/ \ : * ? " < > |` 等保留字符）。

## Requirements

### Requirement 1: 后端导出路由

**User Story:** As a developer using Autopilot, I want a single HTTP endpoint that returns markdown / zip for spec documents, so that the frontend (and future scripts) can fetch portable artifacts without re-implementing aggregation logic.

#### Acceptance Criteria

1.1 THE Export_Route SHALL accept `GET /api/blueprint/jobs/:jobId/spec-documents/export` with query params `granularity ∈ { single, node, tree }`, optional `nodeId: string`, optional `type ∈ { requirements, design, tasks }`.

1.2 WHEN `granularity = single`, THE Export_Route SHALL require both `nodeId` and `type`; THE response Content-Type SHALL be `text/markdown; charset=utf-8` and the body SHALL be the document's `content` field unchanged. The `Content-Disposition` header SHALL be `attachment; filename="<sanitized-node-title>-<type>.md"`.

1.3 WHEN `granularity = node`, THE Export_Route SHALL require `nodeId` and SHALL ignore `type`; THE response Content-Type SHALL be `application/zip` containing 1..3 markdown files (`requirements.md` / `design.md` / `tasks.md`) under a single directory `<sanitized-node-title>/`. The `Content-Disposition` filename SHALL be `<sanitized-node-title>-spec.zip`.

1.4 WHEN `granularity = tree`, THE Export_Route SHALL ignore `nodeId` and `type`; THE response SHALL be a `application/zip` containing every `BlueprintSpecDocument` for the job, organized as `<sanitized-node-title>/<type>.md`. Empty/missing types SHALL be skipped silently. The `Content-Disposition` filename SHALL be `<sanitized-feature-name>-spec.zip` where feature-name comes from job's first SPEC tree root title (or `blueprint-spec` fallback).

1.5 IF the requested `jobId` does not exist, THEN THE Export_Route SHALL return HTTP 404 with `{ error: "blueprint job not found", jobId }` JSON body.

1.6 IF `granularity = single` and the requested `(nodeId, type)` document does not exist for that job, THEN THE Export_Route SHALL return HTTP 404 with `{ error: "spec document not found", jobId, nodeId, type }` JSON body.

1.7 IF `granularity = node` and `nodeId` is missing/empty, OR `granularity = single` and any of `nodeId`/`type` is missing/empty, OR `granularity` itself is missing or not in the enum, THEN THE Export_Route SHALL return HTTP 400 with `{ error: "<descriptive message>" }` JSON body and SHALL NOT attempt to read documents.

1.8 IF the job exists but has zero SPEC documents (granularity = tree) or zero documents for the requested node (granularity = node), THEN THE Export_Route SHALL return HTTP 404 with a descriptive `{ error, jobId, ... }` body rather than returning an empty zip.

1.9 THE Export_Route SHALL include a top-level `MANIFEST.json` inside zip archives (granularity = node | tree) with shape `{ jobId, exportedAt, granularity, nodeIds: string[], documents: Array<{ nodeId, nodeTitle, type, filename, generationSource }> }`. `exportedAt` is ISO 8601.

1.10 THE Export_Route SHALL NOT mutate any persisted state; it SHALL be safe to call repeatedly without side effects.

### Requirement 2: 前端单文档导出入口

**User Story:** As a developer reviewing a SPEC tree node in the right rail, I want a small download button on each `SpecDocPreviewBlock`, so that I can grab the underlying markdown of any single document without opening a separate viewer.

#### Acceptance Criteria

2.1 WHEN `SpecDocPreviewBlock` receives a `document` (non-undefined), THE component SHALL render a download icon button next to the type badge / status row, with `aria-label` of `"导出 <type> 文档"` (zh-CN) or `"Export <type> document"` (en-US).

2.2 WHEN the user clicks the download button, THE component SHALL call `GET /api/blueprint/jobs/<jobId>/spec-documents/export?granularity=single&nodeId=<nodeId>&type=<type>` via the existing fetch helper, then trigger a browser download with the response body and the `Content-Disposition` filename.

2.3 WHILE the export request is in flight, THE button SHALL appear disabled with a spinner indicator; the user SHALL NOT be able to issue duplicate requests.

2.4 WHEN the export request fails (non-2xx response, network error, AbortError), THE component SHALL surface a brief inline error indicator (icon + tooltip with the failure reason) and SHALL re-enable the button. The component SHALL NOT throw or crash the parent.

2.5 WHEN `document === undefined` (placeholder state), THE component SHALL NOT render the download button — there is nothing to export.

2.6 THE download button SHALL NOT trigger a row collapse/expand or any other parent-level interaction; click events SHALL stop propagation.

### Requirement 3: 前端节点级 / 整树导出入口

**User Story:** As a developer ready to archive a SPEC tree, I want bulk export entries at the node row and at the tree workbench header, so that I can grab one zip per node or one zip for the entire tree.

#### Acceptance Criteria

3.1 WHEN a `SpecTreeWorkbench` row is expanded and the node has at least one generated document, THE row SHALL render a `导出本节点` button next to (or below) the row's CTA area calling `granularity=node&nodeId=<id>`.

3.2 WHEN `SpecTreeWorkbench` has at least one node with at least one generated document, THE workbench SHALL render a `导出全部 SPEC` button in the top CTA row calling `granularity=tree`. The button SHALL be disabled when no documents exist (specTree.nodes empty OR all docsByNodeId entries empty).

3.3 WHEN the user clicks either bulk export button, THE component SHALL trigger a browser download of the returned zip with the `Content-Disposition` filename and SHALL NOT block other workbench interactions during the download.

3.4 WHILE either bulk export request is in flight, THE corresponding button SHALL appear disabled with a spinner and show progressing copy (e.g., `导出中...`).

3.5 WHEN either bulk export fails, THE component SHALL surface an inline error toast / tooltip and SHALL re-enable the button without crashing the workbench.

### Requirement 4: 文件名清洗与稳定性

**User Story:** As a developer, I want exported filenames to be predictable and safe across OS / archive tools, so that I can re-import or compare archives without surprises.

#### Acceptance Criteria

4.1 THE Filename_Sanitizer SHALL replace each character in `< > : " / \ | ? *` with `-`, collapse consecutive whitespace into single `_`, trim leading/trailing whitespace, and truncate to 80 characters. Empty results SHALL be replaced with `untitled`.

4.2 WHEN multiple SPEC tree nodes happen to sanitize to the same filename, THE Export_Route SHALL append `-<short-id>` (first 6 hex chars of `nodeId`) to disambiguate.

4.3 THE export filename SHALL NOT include hash digests, datetime stamps, or query strings; it SHALL be deterministic given the same `(jobId, granularity, nodeId, type)` inputs (modulo the `MANIFEST.exportedAt` field inside the zip).

### Requirement 5: 测试与基线约束

**User Story:** As a maintainer, I want the new export feature to ship with focused tests and not regress baselines, so that future contributors can extend it safely.

#### Acceptance Criteria

5.1 THE feature SHALL include vitest example-based tests for: (a) Filename_Sanitizer pure function; (b) Export_Route happy path for all three granularities; (c) Export_Route 4xx branches (missing job, missing doc, missing query); (d) `SpecDocPreviewBlock` download button render & error states (SSR snapshot or `react-dom/server` render).

5.2 THE feature SHALL NOT introduce additional TypeScript compilation errors beyond the existing baseline of 116 errors. All new types SHALL be explicit (no `any`).

5.3 THE feature SHALL NOT break existing 5140+ tests.

5.4 THE feature SHALL NOT introduce `@testing-library/react`, `jsdom`, or `happy-dom`. Frontend tests SHALL continue using `react-dom/server` SSR + `vi.mock` patterns consistent with current project conventions.

5.5 THE feature SHALL NOT modify protected files: `agent-reasoning-bridge.ts`, `callback-receiver.ts`, `lite-agent-runtime.ts`, `llm-call.ts`, `useAutopilotSandboxBridge.ts`, `MissionWallTaskPanel.tsx`, `MiroFishCardStream.tsx`.

5.6 THE zip implementation SHALL prefer a zero-dependency / minimal-dependency approach (e.g., `jszip` already in deps tree, OR a hand-rolled minimal store-only zip writer). Adding new top-level npm dependencies REQUIRES this requirement to be re-discussed.
