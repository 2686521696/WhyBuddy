/**
 * Autopilot v4 信任层 — 前端专用 view-model 类型（`right-rail/trust/types.ts`）
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - design.md §Data Models（"New view-model types (frontend-only)"）
 * - tasks.md 任务 2.1 / 2.2 / 2.3 / 2.4
 * - requirements.md 需求 1.5 / 5.1 / 6.1 / 7.1 / 8.1
 *
 * ── 本模块纪律 ────────────────────────────────────────────────────────────
 *
 * 本文件遵守 `right-rail/trust/index.ts` 声明的纯/只读纪律：
 * - 纯类型模块（pure type module），无任何 runtime code。
 * - 仅以 `import type` 只读消费 `@shared/blueprint/*` 类型，不复制/重定义后端契约，
 *   不引入新的真相源（no-new-truth-source，需求 14.2）。
 * - 这里定义的均为 **派生 / 展示用** view-model，由信任层派生函数从已 fetch 的
 *   台账 / 矩阵 / job 负载计算得出，而非独立 fetch（design.md §Data Models）。
 *
 * 别名约定：与 `client/src/lib/blueprint-api.ts` 一致使用 `@shared/blueprint/*`
 * 子路径别名（`@shared/*` → `./shared/*`）。
 */

import type {
  BlueprintCheckStatus,
  BlueprintCheckType,
  BlueprintChecksLedgerEntry,
} from "@shared/blueprint/checks-ledger/types";
import type { CompanionFinding } from "@shared/blueprint/companion/types";
import type { BlueprintGenerationStage } from "@shared/blueprint/contracts";

// ── 任务 2.4：单一 import 面 — re-export 被消费的 @shared/blueprint/* 类型 ──────
//
// 让信任层模块只需 `import ... from "right-rail/trust/types"` 即可拿到全部所需的
// 共享类型 + view-model 类型（design.md §Data Models / §Components 列出的消费集合）。

export type {
  BlueprintChecksLedgerEntry,
  BlueprintChecksLedgerResponse,
  BlueprintChecksLedgerSummary,
  BlueprintCheckType,
  BlueprintCheckStatus,
} from "@shared/blueprint/checks-ledger/types";

export type {
  TraceabilityMatrix,
  TraceabilityMatrixEntry,
  TraceabilityCoverage,
  TraceabilityGap,
} from "@shared/blueprint/traceability-matrix/types";

export type {
  BlueprintPreviewProvenance,
  PreviewImageMeta,
  PreviewAuditFinding,
  PreviewAuditResult,
} from "@shared/blueprint/preview-audit/types";

export type { CompanionFinding } from "@shared/blueprint/companion/types";

// ── 任务 2.1：校验台账（QA_LEDGER）展示 view-model ───────────────────────────

/**
 * 单个阶段的台账分组（design §Components 4：entries grouped by `stage`）。
 *
 * 由 `groupLedgerByStage` 之类的纯派生函数产出：一个阶段标签 + 落在该阶段的
 * 台账条目数组。`stage` 取 `BlueprintChecksLedgerEntry["stage"]`
 * （即 `BlueprintGenerationStage`），保证与共享契约同源。
 */
export interface LedgerStageGroup {
  /** 阶段标签，例如 `spec_tree` / `spec_docs` / `effect_preview` */
  stage: BlueprintGenerationStage;
  /** 落在该阶段的台账条目（已按需排序，warn/fail 前置由派生函数负责） */
  entries: BlueprintChecksLedgerEntry[];
}

/**
 * 台账过滤状态（design §Components 4：filter bar / `applyLedgerFilters`）。
 *
 * 两个维度均为可选；缺省表示"不过滤该维度"。客户端过滤，不需要重新 fetch。
 */
export interface LedgerFilterState {
  /** 按校验类型过滤（schema / invariant / content_quality / companion_trace / preview_audit / ...） */
  checkType?: BlueprintCheckType;
  /** 按结果状态过滤（pass / fail / warn / skip） */
  status?: BlueprintCheckStatus;
}

// ── 任务 2.2：出图审计（EP_VIS_AUDIT）+ 来源分类（EP_VIS_GEN）view-model ───────

/**
 * 单条预览审计发现的展示视图（mirror of `PreviewAuditFinding` 的欺诈类别）。
 *
 * 复刻 `PreviewAuditFinding.reason` 的三类欺诈类别：
 * - `fallback_pretending` — 兜底冒充（`source:"fallback"` AND `ok:true`）
 * - `fake_success` — 假成功（`ok:true` 却带 `errorIndicators`）
 * - `duplicate_content` — 逐字节重复
 *
 * 这是前端派生视图：由 `derivePreviewAuditVerdict` 从台账 `preview_audit`
 * 条目的 `checkName` / `output` 模式解析得出（design §Components 3 / 6）。
 */
export interface PreviewAuditFindingView {
  /** 关联的图片 id（解析得到时填写） */
  imageId?: string;
  /** 欺诈类别，复刻 `PreviewAuditFinding["reason"]` */
  reason: "fallback_pretending" | "fake_success" | "duplicate_content";
  /** 人类可读细节 */
  details: string;
  /** 严重度，复刻 `PreviewAuditFinding["severity"]` */
  severity: "warn" | "error";
}

/**
 * 出图审计批次裁决（EP_VIS_AUDIT ◆◆，design §Components 6 / 需求 6）。
 *
 * 由 `derivePreviewAuditVerdict(ledgerEntries)` 从 `checkType==="preview_audit"`
 * 的台账条目派生：
 * - `batchStatus` — 批次综合状态（fail 优先，其次 warn，再 pass）。
 * - `retryCount` — 回炉重试次数。
 * - `exhausted` — 是否回炉耗尽（`preview_audit_retry_exhausted`）。
 * - `findings` — 解析出的欺诈发现列表。
 */
export interface PreviewAuditVerdict {
  batchStatus: BlueprintCheckStatus;
  retryCount: number;
  exhausted: boolean;
  findings: PreviewAuditFindingView[];
}

/**
 * 单图来源分类（EP_VIS_GEN ◆，design §Components 6 / 需求 5）。
 *
 * 由 `classifyProvenance(provenance)` 从 `BlueprintPreviewProvenance` 派生：
 * - `model_ok` — 真实模型成功生成（`source:"model"` AND `ok:true`）。
 * - `fallback` — 兜底（占位/模板路径或兜底冒充）。
 * - `failed` — 诚实失败（无图）。
 *
 * 关键约束（需求 5.3 / 6.2）：`source:"fallback"` 永不归为 `model_ok`。
 */
export type ProvenanceClass = "model_ok" | "fallback" | "failed";

// ── 任务 2.3：伴随发现（CO）按阶段分组 view-model ────────────────────────────

/**
 * 伴随发现按阶段分组（design §Components 7 / 需求 8.6）。
 *
 * 由 `groupCompanionByStage(findings)` 产出：阶段标签 + 落在该阶段的伴随发现，
 * 便于用户看到每条发现针对的是哪个阶段（clarification / route_generation /
 * spec_tree 等）。
 */
export interface CompanionFindingGroup {
  stage: BlueprintGenerationStage;
  findings: CompanionFinding[];
}
