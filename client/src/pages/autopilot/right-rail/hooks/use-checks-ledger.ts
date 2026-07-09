/**
 * `useChecksLedger` — jobId-keyed 只读拉取校验台账（QA_LEDGER）。
 *
 * 对应 spec：tasks.md 任务 18.1–18.4；requirements.md 需求 13.1 / 13.2 / 13.3 / 14.2。
 *
 * 约束：
 * - 不写实时 store（无新真相源，需求 14.2）；本 hook 持有本地状态。
 * - jobId 变化 / 卸载时 abort 在途请求（AbortController）。
 * - 状态机 idle | loading | ready | empty | error；
 *   empty = `summary.total === 0 && entries.length === 0`（gate 关闭 / 无数据）。
 */

import { useCallback, useEffect, useState } from "react";

import type { ApiRequestError } from "@/lib/api-client";
import {
  fetchChecksLedger,
  type ChecksLedgerFilters,
} from "@/lib/blueprint-api";
import type { BlueprintChecksLedgerResponse } from "@shared/blueprint/checks-ledger/types";

export type ChecksLedgerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface UseChecksLedgerResult {
  status: ChecksLedgerStatus;
  data: BlueprintChecksLedgerResponse | null;
  error: ApiRequestError | null;
  reload: () => void;
}

export interface UseChecksLedgerOptions {
  /** 测试注入点，默认使用真实 `fetchChecksLedger`。 */
  fetcher?: typeof fetchChecksLedger;
}

export function useChecksLedger(
  jobId: string | null | undefined,
  filters?: ChecksLedgerFilters,
  options?: UseChecksLedgerOptions
): UseChecksLedgerResult {
  const fetcher = options?.fetcher ?? fetchChecksLedger;
  const [status, setStatus] = useState<ChecksLedgerStatus>("idle");
  const [data, setData] = useState<BlueprintChecksLedgerResponse | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // 仅按 jobId + 过滤维度作为依赖键（避免 filters 对象引用变化导致重复拉取）。
  const stage = filters?.stage;
  const filterStatus = filters?.status;
  const checkType = filters?.checkType;

  useEffect(() => {
    if (!jobId) {
      setStatus("idle");
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);

    void (async () => {
      const result = await fetcher(
        jobId,
        { stage, status: filterStatus, checkType },
        { signal: controller.signal }
      );
      if (!active || controller.signal.aborted) return;
      if (result.ok) {
        const isEmpty =
          result.data.summary.total === 0 && result.data.entries.length === 0;
        setData(result.data);
        setStatus(isEmpty ? "empty" : "ready");
      } else {
        setError(result.error);
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, stage, filterStatus, checkType, reloadToken, fetcher]);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  return { status, data, error, reload };
}
