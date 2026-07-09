/**
 * Autopilot v4 信任层 — 伴随发现（CO: Critic / Grounding）纯派生函数。
 *
 * 对应 spec：tasks.md 任务 15.1–15.3；design.md §Components 7 / Property 5；
 * requirements.md 需求 8.1 / 8.4 / 8.6。
 *
 * 纪律：纯、无 IO、确定、全、不抛错。
 */

import type { CompanionFinding, CompanionFindingGroup } from "./types";

/** 仅消费 `companionFindings` 字段的最小 job 形状。 */
export interface CompanionFindingsSource {
  companionFindings?: CompanionFinding[] | null;
}

/**
 * 15.1 从 job 负载安全选取伴随发现（缺字段 → 空数组，绝不抛错）。
 */
export function selectCompanionFindings(
  job: CompanionFindingsSource | null | undefined,
): CompanionFinding[] {
  const raw = job?.companionFindings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((finding): finding is CompanionFinding => !!finding);
}

/**
 * 15.2 按 `stage` 分组（首次出现顺序，组内保留输入顺序）。
 */
export function groupCompanionByStage(
  findings: readonly CompanionFinding[] | null | undefined,
): CompanionFindingGroup[] {
  const groups: CompanionFindingGroup[] = [];
  const indexByStage = new Map<string, number>();
  for (const finding of findings ?? []) {
    if (!finding) continue;
    const stage = finding.stage;
    const existing = indexByStage.get(stage);
    if (existing === undefined) {
      indexByStage.set(stage, groups.length);
      groups.push({ stage, findings: [finding] });
    } else {
      groups[existing].findings.push(finding);
    }
  }
  return groups;
}

const SEVERITY_RANK: Record<CompanionFinding["severity"], number> = {
  error: 0,
  warn: 1,
  info: 2,
};

/**
 * 15.3 按严重度稳定排序：error > warn > info。
 *
 * Property 5：输出是输入的排列；error 全先于 warn，warn 全先于 info；同级稳定。
 */
export function sortBySeverity(
  findings: readonly CompanionFinding[] | null | undefined,
): CompanionFinding[] {
  const list = (findings ?? []).filter(
    (finding): finding is CompanionFinding => !!finding,
  );
  return list
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => {
      const rankDiff =
        (SEVERITY_RANK[a.finding.severity] ?? 99) -
        (SEVERITY_RANK[b.finding.severity] ?? 99);
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    })
    .map(({ finding }) => finding);
}
