/**
 * `autopilot-spec-documents-workbench-v2` — DocStats 派生纯函数。
 *
 * 从 `BlueprintSpecDocument` 集合与 `BlueprintSpecTree` 派生顶部状态栏
 * 所需的统计指标聚合（R2.5 / R2.6 / R2.8 / R2.9 / R2.10）。
 *
 * 完成判定口径：`status === "accepted"` 视为已完成，与既有
 * `deriveSpecTreeChip` / `deriveSpecDocumentTreeStats` 一致（design.md Decision 5）。
 */

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

/** 按文档类型分组的统计。 */
export interface DocTypeStats {
  /** 该类型已生成的文档数。 */
  generated: number;
  /** 该类型已完成（status === "accepted"）的文档数，不超过 generated。 */
  completed: number;
}

/** 顶部状态栏展示的统计指标聚合。 */
export interface DocStats {
  /** 文档总数（所有类型）。 */
  totalDocs: number;
  /** 目标文档数：有 specTree 时为 nodes.length * 3；无树时退回到 totalDocs。 */
  targetDocs: number;
  /** tasks 类型文档总数。 */
  totalTasks: number;
  /** 目标 tasks 文档数：有 specTree 时为 nodes.length；无树时退回到 totalTasks。 */
  targetTasks: number;
  /** 整体完成率 [0, 1]；分母为 0 时返回 0。 */
  completionRate: number;
  /** 按 DocType 分组的统计。 */
  byType: Record<BlueprintSpecDocumentType, DocTypeStats>;
}

/** `deriveDocStats` 的输入参数。 */
export interface SpecDocsProgressStatsOverlay {
  batchStatus: "idle" | "running" | "assembling" | "finished";
  totalCount: number;
  completedCount: number;
  assembledCount: number;
  processedCount: number;
}

export interface DeriveDocStatsInput {
  specDocuments: readonly BlueprintSpecDocument[] | undefined;
  specTree: BlueprintSpecTree | null | undefined;
  specDocsProgress?: SpecDocsProgressStatsOverlay | null | undefined;
}

function isSpecDocsProgressOverlayActive(
  progress: SpecDocsProgressStatsOverlay | null | undefined
): progress is SpecDocsProgressStatsOverlay {
  return (
    progress !== null &&
    progress !== undefined &&
    progress.totalCount > 0 &&
    (progress.batchStatus === "running" ||
      progress.batchStatus === "assembling" ||
      progress.batchStatus === "finished")
  );
}

function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

/**
 * 派生 DocStats。
 *
 * - `totalDocs` = specDocuments.length（缺失或为空时为 0）。
 * - `totalTasks` = specDocuments.filter(d => d.type === "tasks").length。
 * - 完成判定：`status === "accepted"`。
 * - `byType[type].completed = min(generated, rawCompleted)`（R2.10 夹取）。
 * - `completionRate`：分母 = 三类 generated 之和；分子 = 三类 completed 之和；
 *   分母为 0 时返回 0（R2.9）。
 */
export function deriveDocStats(input: DeriveDocStatsInput): DocStats {
  const docs = input.specDocuments ?? [];
  const nodeCount = input.specTree?.nodes?.length ?? 0;

  // 按类型统计
  const byType: Record<BlueprintSpecDocumentType, DocTypeStats> = {
    requirements: { generated: 0, completed: 0 },
    design: { generated: 0, completed: 0 },
    tasks: { generated: 0, completed: 0 },
  };

  for (const doc of docs) {
    const type = doc.type;
    if (type in byType) {
      byType[type].generated += 1;
      if (doc.status === "accepted") {
        byType[type].completed += 1;
      }
    }
  }

  // R2.10：夹取 completed 不超过 generated
  for (const type of Object.keys(byType) as BlueprintSpecDocumentType[]) {
    const stats = byType[type];
    if (stats.completed > stats.generated) {
      stats.completed = stats.generated;
    }
  }

  const progress = input.specDocsProgress;
  const progressNodeCount = isSpecDocsProgressOverlayActive(progress)
    ? progress.totalCount
    : 0;
  const targetNodeCount = nodeCount > 0 ? nodeCount : progressNodeCount;
  const liveGeneratedNodeCount = isSpecDocsProgressOverlayActive(progress)
    ? clampCount(
        Math.max(progress.completedCount, progress.assembledCount),
        0,
        targetNodeCount
      )
    : 0;

  if (liveGeneratedNodeCount > 0) {
    byType.requirements.generated = Math.max(
      byType.requirements.generated,
      liveGeneratedNodeCount
    );
    byType.design.generated = Math.max(
      byType.design.generated,
      liveGeneratedNodeCount
    );
    byType.tasks.generated = Math.max(
      byType.tasks.generated,
      liveGeneratedNodeCount
    );
  }

  const totalDocs =
    byType.requirements.generated + byType.design.generated + byType.tasks.generated;
  const totalTasks = byType.tasks.generated;
  const targetDocs = targetNodeCount > 0 ? targetNodeCount * 3 : totalDocs;
  const targetTasks = targetNodeCount > 0 ? targetNodeCount : totalTasks;

  // completionRate：分母 = 三类 generated 之和
  const totalGenerated =
    byType.requirements.generated +
    byType.design.generated +
    byType.tasks.generated;
  const totalCompleted =
    byType.requirements.completed +
    byType.design.completed +
    byType.tasks.completed;
  const completionRate =
    totalGenerated === 0 ? 0 : totalCompleted / totalGenerated;

  return {
    totalDocs,
    targetDocs,
    totalTasks,
    targetTasks,
    completionRate,
    byType,
  };
}
