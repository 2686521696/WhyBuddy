/**
 * Autopilot v4 信任层 — 出图来源分类（EP_VIS_GEN ◆）纯派生函数。
 *
 * 对应 spec：tasks.md 任务 11.1–11.3；design.md §Components 6 / Property 3；
 * requirements.md 需求 5.1 / 5.2 / 5.3 / 5.6。
 *
 * 纪律：纯、无 IO、确定、全、不抛错。
 */

import type { BlueprintPreviewProvenance, ProvenanceClass } from "./types";

/**
 * 11.1 把图片 provenance 分类为 `model_ok | fallback | failed`。
 *
 * 规则（Property 3 / 需求 5.2 / 5.3）：
 * - `model_ok` 当且仅当 `source === "model" && ok === true`。
 * - `ok === false` → `failed`（诚实失败/缺图）。
 * - 其余（含关键的 `source === "fallback" && ok === true` 兜底冒充）→ `fallback`，
 *   永不归为 `model_ok`。
 * - 防御式：undefined / null / 缺字段 → `failed`（最保守，不冒充成功）。
 */
export function classifyProvenance(
  provenance: BlueprintPreviewProvenance | null | undefined,
): ProvenanceClass {
  if (!provenance || typeof provenance !== "object") return "failed";
  const { source, ok } = provenance;
  if (ok !== true) return "failed";
  if (source === "model") return "model_ok";
  return "fallback";
}

/**
 * 11.2 出图预览恒为"未验证"（EP_VIS_GEN 强制标『预览·未验证』）。
 */
export function isPreviewUnverified(): true {
  return true;
}
