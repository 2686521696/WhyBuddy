import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getBlueprintFamily,
  type GetBlueprintFamilyResult,
  type BlueprintFamilyError,
} from "@/lib/blueprint-api/family";
import type { BlueprintFamilyResponse } from "@shared/blueprint/contracts";

export type FamilyDataStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "static_unsupported";

export interface FamilyDataState {
  status: FamilyDataStatus;
  data: BlueprintFamilyResponse | null;
  error: BlueprintFamilyError | null;
  loading: boolean;
}

export type FetchBlueprintFamily = (
  jobId: string,
  options?: RequestInit
) => Promise<GetBlueprintFamilyResult>;

export interface LoadBlueprintFamilyDataOptions {
  jobId?: string | null;
  enabled?: boolean;
  disableRemoteFetch?: boolean;
  initialData?: BlueprintFamilyResponse | null;
  fetchFamily?: FetchBlueprintFamily;
  requestInit?: RequestInit;
}

export interface UseFamilyDataOptions extends LoadBlueprintFamilyDataOptions {
  onData?: (data: BlueprintFamilyResponse) => void;
  onError?: (error: BlueprintFamilyError) => void;
}

function trimJobId(jobId?: string | null): string {
  return jobId?.trim() ?? "";
}

export function createFamilyDataState(
  options: Pick<
    LoadBlueprintFamilyDataOptions,
    "jobId" | "enabled" | "disableRemoteFetch" | "initialData"
  >
): FamilyDataState {
  const enabled = options.enabled !== false;
  const data = options.initialData ?? null;

  if (options.disableRemoteFetch) {
    return {
      status: "static_unsupported",
      data,
      error: null,
      loading: false,
    };
  }

  if (!enabled || trimJobId(options.jobId).length === 0) {
    return {
      status: data ? "ready" : "idle",
      data,
      error: null,
      loading: false,
    };
  }

  return {
    status: data ? "ready" : "loading",
    data,
    error: null,
    loading: !data,
  };
}

export function mergeFamilyRequestInit(
  requestInit: RequestInit | undefined,
  abortSignal: AbortSignal
): RequestInit {
  return {
    ...requestInit,
    signal: requestInit?.signal ?? abortSignal,
  };
}

export async function loadBlueprintFamilyData({
  jobId,
  enabled = true,
  disableRemoteFetch = false,
  initialData = null,
  fetchFamily = getBlueprintFamily,
  requestInit,
}: LoadBlueprintFamilyDataOptions): Promise<FamilyDataState> {
  const trimmedJobId = trimJobId(jobId);

  if (disableRemoteFetch || !enabled || trimmedJobId.length === 0) {
    return createFamilyDataState({
      jobId: trimmedJobId,
      enabled,
      disableRemoteFetch,
      initialData,
    });
  }

  const result = await fetchFamily(trimmedJobId, requestInit);
  if (!result.ok) {
    return {
      status: "error",
      data: initialData,
      error: result.error,
      loading: false,
    };
  }

  return {
    status: "ready",
    data: result.data,
    error: null,
    loading: false,
  };
}

export function useFamilyData({
  jobId,
  enabled = true,
  disableRemoteFetch = false,
  initialData = null,
  fetchFamily = getBlueprintFamily,
  requestInit,
  onData,
  onError,
}: UseFamilyDataOptions): FamilyDataState & { refetch: () => void } {
  const trimmedJobId = trimJobId(jobId);
  const [refetchTick, setRefetchTick] = useState(0);
  const [state, setState] = useState<FamilyDataState>(() =>
    createFamilyDataState({
      jobId: trimmedJobId,
      enabled,
      disableRemoteFetch,
      initialData,
    })
  );

  useEffect(() => {
    let closed = false;

    if (disableRemoteFetch || !enabled || trimmedJobId.length === 0) {
      setState(
        createFamilyDataState({
          jobId: trimmedJobId,
          enabled,
          disableRemoteFetch,
          initialData,
        })
      );
      return () => {
        closed = true;
      };
    }

    const controller = new AbortController();
    setState(current => ({
      status: "loading",
      data: current.data ?? initialData,
      error: null,
      loading: true,
    }));

    void loadBlueprintFamilyData({
      jobId: trimmedJobId,
      enabled,
      disableRemoteFetch,
      initialData,
      fetchFamily,
      requestInit: mergeFamilyRequestInit(requestInit, controller.signal),
    }).then(nextState => {
      if (closed) return;
      setState(nextState);
      if (nextState.status === "ready" && nextState.data) {
        onData?.(nextState.data);
      }
      if (nextState.status === "error" && nextState.error) {
        onError?.(nextState.error);
      }
    });

    return () => {
      closed = true;
      controller.abort();
    };
  }, [
    trimmedJobId,
    enabled,
    disableRemoteFetch,
    initialData,
    fetchFamily,
    requestInit,
    onData,
    onError,
    refetchTick,
  ]);

  const refetch = useCallback(() => {
    if (disableRemoteFetch) return;
    setRefetchTick(current => current + 1);
  }, [disableRemoteFetch]);

  return useMemo(
    () => ({
      ...state,
      refetch,
    }),
    [state, refetch]
  );
}
