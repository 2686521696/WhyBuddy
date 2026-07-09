import { describe, expect, it, vi } from "vitest";

import {
  createFamilyDataState,
  loadBlueprintFamilyData,
  mergeFamilyRequestInit,
} from "../use-family-data";
import { family, job } from "./version-history-fixtures";

describe("use-family-data", () => {
  it("represents idle, loading, ready, and static-preview states", () => {
    const initialData = family([job("root")]);

    expect(createFamilyDataState({ jobId: null })).toMatchObject({
      status: "idle",
      loading: false,
    });
    expect(createFamilyDataState({ jobId: "root" })).toMatchObject({
      status: "loading",
      loading: true,
    });
    expect(createFamilyDataState({ jobId: "root", initialData })).toMatchObject({
      status: "ready",
      data: initialData,
      loading: false,
    });
    expect(
      createFamilyDataState({
        jobId: "root",
        disableRemoteFetch: true,
        initialData,
      }),
    ).toMatchObject({
      status: "static_unsupported",
      data: initialData,
      loading: false,
    });
  });

  it("returns an error state when the injectable fetcher fails", async () => {
    const error = {
      kind: "error" as const,
      source: "http" as const,
      endpoint: "/api/blueprint/jobs/root/family",
      message: "job_not_found",
      detail: "missing",
      retryable: false,
      status: 404,
    };
    const state = await loadBlueprintFamilyData({
      jobId: "root",
      fetchFamily: vi.fn(async () => ({ ok: false as const, error })),
    });

    expect(state).toMatchObject({
      status: "error",
      error,
      loading: false,
    });
  });

  it("passes an abort signal for hook unmount cancellation without replacing caller signals", () => {
    const callerSignal = new AbortController().signal;
    const hookSignal = new AbortController().signal;

    expect(mergeFamilyRequestInit({ headers: { accept: "application/json" } }, hookSignal)).toMatchObject({
      signal: hookSignal,
    });
    expect(mergeFamilyRequestInit({ signal: callerSignal }, hookSignal)).toMatchObject({
      signal: callerSignal,
    });
  });
});
