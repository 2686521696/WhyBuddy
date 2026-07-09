/**
 * Autopilot v4 信任层 — 校验台账（QA_LEDGER）纯派生函数。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 9.1–9.4
 * - design.md §Components 4 / §Correctness Properties（Property 1 / 2 / 6）
 * - requirements.md 需求 2.3 / 2.4 / 2.5 / 3.1 / 4.1
 *
 * 纪律（见 `./index.ts`）：纯、无 IO、确定、全、不抛错。
 */

import type {
  BlueprintCheckStatus,
  BlueprintCheckType,
  BlueprintChecksLedgerEntry,
  LedgerFilterState,
  LedgerStageGroup,
} from "./types";

/**
 * 9.1 按 `stage` 分组台账条目。
 *
 * Property 1（分组完整性）：所有分组的并集 === 输入多重集，无丢弃、无重复，
 * 每个输出条目都是输入条目。分组按首次出现的 stage 顺序排列，组内保留输入顺序。
 */
export function groupLedgerByStage(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined,
): LedgerStageGroup[] {
  const groups: LedgerStageGroup[] = [];
  const indexByStage = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (!entry) continue;
    const stage = entry.stage;
    const existing = indexByStage.get(stage);
    if (existing === undefined) {
      indexByStage.set(stage, groups.length);
      groups.push({ stage, entries: [entry] });
    } else {
      groups[existing].entries.push(entry);
    }
  }
  return groups;
}

/**
 * 9.2 选取指定 checkType 的条目（保留顺序）。
 */
export function selectByCheckType(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined,
  checkType: BlueprintCheckType,
): BlueprintChecksLedgerEntry[] {
  return (entries ?? []).filter(
    (entry): entry is BlueprintChecksLedgerEntry =>
      !!entry && entry.checkType === checkType,
  );
}

/**
 * 状态优先级：fail / warn 归入"前置桶"(0)，pass / skip 归入"后置桶"(1)。
 * 桶内保持输入相对顺序（稳定）。
 */
function statusBucket(status: BlueprintCheckStatus): 0 | 1 {
  return status === "fail" || status === "warn" ? 0 : 1;
}

/**
 * 9.3 稳定地把 warn/fail 排到 pass/skip 之前。
 *
 * Property 2：输出是输入的排列；每个 warn/fail 都先于每个 pass/skip；
 * 同桶内相对顺序保留（稳定）；幂等（排两次 === 排一次）。
 */
export function sortWarnFailFirst(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined,
): BlueprintChecksLedgerEntry[] {
  const list = (entries ?? []).filter(
    (entry): entry is BlueprintChecksLedgerEntry => !!entry,
  );
  // 稳定排序：仅按桶比较，相等保持原序（Array.prototype.sort 在现代引擎稳定，
  // 但为严格稳定性显式用 index 兜底）。
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const bucketDiff = statusBucket(a.entry.status) - statusBucket(b.entry.status);
      return bucketDiff !== 0 ? bucketDiff : a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * 9.4 应用台账过滤（checkType + status），客户端过滤。
 *
 * Property 6：两个维度的过滤可交换、幂等。
 */
export function applyLedgerFilters(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined,
  filter: LedgerFilterState | null | undefined,
): BlueprintChecksLedgerEntry[] {
  const list = (entries ?? []).filter(
    (entry): entry is BlueprintChecksLedgerEntry => !!entry,
  );
  if (!filter) return list;
  return list.filter((entry) => {
    if (filter.checkType && entry.checkType !== filter.checkType) return false;
    if (filter.status && entry.status !== filter.status) return false;
    return true;
  });
}
