/**
 * `useCompanionFindings` — 从 job 负载派生伴随发现（CO），无需 fetch。
 *
 * 对应 spec：tasks.md 任务 20；requirements.md 需求 8.1 / 14.2。
 *
 * 伴随发现已随 job 详情下发（`job.companionFindings`），因此这是一个纯 selector
 * （memoized），不引入新的 fetch / 真相源。
 */

import { useMemo } from "react";

import type { CompanionFinding } from "@shared/blueprint/companion/types";
import {
  groupCompanionByStage,
  selectCompanionFindings,
  sortBySeverity,
  type CompanionFindingsSource,
} from "../trust";
import type { CompanionFindingGroup } from "../trust/types";

export interface UseCompanionFindingsResult {
  findings: CompanionFinding[];
  /** 按严重度（error > warn > info）稳定排序。 */
  sorted: CompanionFinding[];
  /** 按阶段分组。 */
  groups: CompanionFindingGroup[];
  isEmpty: boolean;
}

export function useCompanionFindings(
  job: CompanionFindingsSource | null | undefined
): UseCompanionFindingsResult {
  return useMemo(() => {
    const findings = selectCompanionFindings(job);
    return {
      findings,
      sorted: sortBySeverity(findings),
      groups: groupCompanionByStage(findings),
      isEmpty: findings.length === 0,
    };
  }, [job]);
}
