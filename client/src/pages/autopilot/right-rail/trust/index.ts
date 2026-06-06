/**
 * Autopilot v4 信任层 — 纯派生模块 barrel (`right-rail/trust/`)
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - design.md §Correctness Properties（本目录函数即 property-based-testing 目标）
 * - requirements.md 需求 14.2（不新增第二真相源）/ 15.1（分毫对齐 v4）
 *
 * ── 本目录纪律（READ-ONLY / PURE DISCIPLINE）──────────────────────────────
 *
 * 本目录承载 v4 信任层（QA_LEDGER / SP_INV / QA_CONTENT / CO / EP_VIS_*）的
 * **纯派生逻辑**。所有模块（后续任务新增的 group-ledger.ts / provenance.ts /
 * preview-audit.ts / companion.ts / types.ts）必须遵守以下约束：
 *
 * 1. 纯（pure）、无 IO（IO-free）、确定（deterministic）、全（total）函数：
 *    给定相同输入恒返回相同输出，对任意输入都有定义，绝不抛错。
 * 2. 禁止 import 任何 store 或 `blueprint-api` 的运行时成员（runtime members）；
 *    只允许以 `import type` 形式只读消费 `@shared/blueprint/*` 类型。
 * 3. 禁止非确定性来源：不得使用 `Date.now()` / `Math.random()` /
 *    `performance.now()` 等。
 * 4. 禁止副作用：不得使用 `console.*`，不得写任何外部状态。
 * 5. 禁止抛异常（no throwing）：对 partial / undefined 输入做防御式读取，
 *    缺失时回退到空值/默认值，而不是抛错。
 * 6. 只读消费（read-only）：仅消费 `@shared/blueprint/*` 类型，不复制/重定义
 *    后端契约，不引入新的真相源（no-new-truth-source，需求 14.2）。
 *
 * 这套纪律与 `right-rail/resolve-rail-sub-stage.ts` 的纯函数约束一致，确保本目录
 * 可作为 property-based-testing 目标被独立验证（见 design.md §Correctness Properties）。
 *
 * ── 导出说明 ────────────────────────────────────────────────────────────
 *
 * 派生模块（types.ts / group-ledger.ts / provenance.ts / preview-audit.ts /
 * companion.ts）从此处 re-export 形成单一 import 面。
 */

export type * from "./types";
export {
  groupLedgerByStage,
  selectByCheckType,
  sortWarnFailFirst,
  applyLedgerFilters,
} from "./group-ledger";
export { classifyProvenance, isPreviewUnverified } from "./provenance";
export { derivePreviewAuditVerdict } from "./preview-audit";
export {
  selectCompanionFindings,
  groupCompanionByStage,
  sortBySeverity,
  type CompanionFindingsSource,
} from "./companion";
