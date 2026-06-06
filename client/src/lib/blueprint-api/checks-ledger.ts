/**
 * Blueprint trust-layer 子域：校验台账（QA_LEDGER）只读读取封装。
 *
 * `autopilot-v4-frontend-alignment` 需求 1：
 * - 1.1 GET `/api/blueprint/jobs/:jobId/checks-ledger`，复用 `fetchJsonSafe` + `ApiRequestError`。
 * - 1.2 `stage`/`status`/`checkType` 作为查询参数仅在提供时附加（URLSearchParams 编码）。
 * - 1.5 复用 `@shared/blueprint/checks-ledger/types` 类型，不重复定义。
 * - 1.6 只读：不发起写请求，不修改后端状态。
 *
 * 约定与 `family.ts` / `replan.ts` 一致：`{ ok:true, data } | { ok:false, error }`。
 */

import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import type {
  BlueprintChecksLedgerResponse,
  BlueprintCheckStatus,
  BlueprintCheckType,
} from "@shared/blueprint/checks-ledger/types";

/** 校验台账查询过滤条件（需求 1.2）。 */
export interface ChecksLedgerFilters {
  stage?: string;
  status?: BlueprintCheckStatus;
  checkType?: BlueprintCheckType;
}

export type FetchChecksLedgerResult =
  | { ok: true; data: BlueprintChecksLedgerResponse }
  | { ok: false; error: ApiRequestError };

function buildChecksLedgerQuery(filters?: ChecksLedgerFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.status) params.set("status", filters.status);
  if (filters.checkType) params.set("checkType", filters.checkType);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchChecksLedger(
  jobId: string,
  filters?: ChecksLedgerFilters,
  options?: RequestInit
): Promise<FetchChecksLedgerResult> {
  const query = buildChecksLedgerQuery(filters);
  const result = await fetchJsonSafe<BlueprintChecksLedgerResponse>(
    `/api/blueprint/jobs/${encodeURIComponent(jobId)}/checks-ledger${query}`,
    options
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, data: result.data };
}
