/**
 * `useTraceabilityMatrix` — jobId-keyed 只读拉取可追溯矩阵（EP_MATRIX）。
 *
 * 对应 spec：tasks.md 任务 19.1–19.3；requirements.md 需求 7.5 / 7.6 / 13.1 / 13.3。
 *
 * 状态机 idle | loading | ready | not_generated | stale | error。
 * - not_generated：后端 404 `matrix_not_generated` / `job_not_found`。
 * - stale：成功且 `matrix.stale === true`（仍带 matrix 数据）。
 */

import { useCallback, useEffect, useState } from "react";

import type { ApiRequestError } from "@/lib/api-client";
import { fetchTraceabilityMatrix } from "@/lib/blueprint-api";
import type { TraceabilityMatrix } from "@shared/blueprint/traceability-matrix/types";

export type TraceabilityMatrixStatus =
  | "idle"
  | "loading"
  | "ready"
  | "not_generated"
  | "stale"
  | "error";

export interface UseTraceabilityMatrixResult {
  status: TraceabilityMatrixStatus;
  matrix: TraceabilityMatrix | null;
  error: ApiRequestError | null;
  reload: () => void;
}

export interface UseTraceabilityMatrixOptions {
  fetcher?: typeof fetchTraceabilityMatrix;
}

export function useTraceabilityMatrix(
  jobId: string | null | undefined,
  options?: UseTraceabilityMatrixOptions
): UseTraceabilityMatrixResult {
  const fetcher = options?.fetcher ?? fetchTraceabilityMatrix;
  const [status, setStatus] = useState<TraceabilityMatrixStatus>("idle");
  const [matrix, setMatrix] = useState<TraceabilityMatrix | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!jobId) {
      setStatus("idle");
      setMatrix(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);

    void (async () => {
      const result = await fetcher(jobId, "json", {
        signal: controller.signal,
      });
      if (!active || controller.signal.aborted) return;
      if (result.ok && result.kind === "json") {
        setMatrix(result.data);
        setStatus(result.data.stale === true ? "stale" : "ready");
      } else if (!result.ok && result.notGenerated) {
        setMatrix(null);
        setStatus("not_generated");
      } else if (!result.ok) {
        setError(result.error);
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, reloadToken, fetcher]);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  return { status, matrix, error, reload };
}
