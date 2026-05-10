/**
 * Autopilot 驾驶舱右栏数据层 Hook — 单元测试
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 2（Ignore_Stale_Policy 在 reducer 层强制）
 * - Requirement 4（Cache 切换语义）
 * - Requirement 8（fetch 失败保留 previousCache）
 *
 * Task 2 范围：
 * - 只测试 reducer 的 pure 转换规则（`JOB_CHANGED` / `FETCH_STARTED` / `FETCH_FULFILLED` /
 *   `FETCH_REJECTED`）、以及 `buildInitialReducerState` / `deriveWave1FieldUpdates` helper。
 * - 不测试 hook 的 fetch 副作用与 React render cycle（需要 DOM runtime；本 repo 当前不集成
 *   `@testing-library/react`，且 `useEffect` 在 `renderToStaticMarkup` 中不执行）。
 * - Task 11 的 PBT 会引入 `renderHook` 或等价手段覆盖 fetch 副作用、SSE、polling 与 retry。
 */

import { describe, expect, it } from "vitest";

import type { ApiRequestError } from "@/lib/api-client";
import type {
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import {
  __testing__,
  type RightRailDataView,
  type UseAutopilotRightRailDataOptions,
} from "../use-autopilot-right-rail-data";

const {
  rightRailDataReducer,
  buildInitialReducerState,
  deriveWave1FieldUpdates,
  WAVE_1_FIELDS,
  ALL_FIELD_NAMES,
} = __testing__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(id: string, stage: BlueprintGenerationJob["stage"] = "input"): BlueprintGenerationJob {
  return {
    id,
    request: { userInput: "", sources: [] } as unknown as BlueprintGenerationJob["request"],
    status: "running",
    stage,
    version: "1",
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    artifacts: [],
    events: [],
  } as unknown as BlueprintGenerationJob;
}

function makeRouteSet(id: string): BlueprintRouteSet {
  return { id, jobId: id, routes: [] } as unknown as BlueprintRouteSet;
}

function makeSelection(id: string): BlueprintRouteSelection {
  return { id, jobId: id, routeId: `route-${id}` } as unknown as BlueprintRouteSelection;
}

function makeSpecTree(id: string): BlueprintSpecTree {
  return { id, jobId: id, nodes: [], documents: [] } as unknown as BlueprintSpecTree;
}

function makeError(message: string): ApiRequestError {
  return {
    kind: "error",
    source: "network",
    endpoint: "/api/blueprint/jobs/latest",
    message,
    detail: "",
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// buildInitialReducerState
// ---------------------------------------------------------------------------

describe("buildInitialReducerState (Spec 4 Task 2)", () => {
  it("初始化时所有字段的 data 来自 initialData, loading/error/pendingRequestId 均为初始态", () => {
    const initial: UseAutopilotRightRailDataOptions["initialData"] = {
      job: makeJob("job-1"),
      routeSet: makeRouteSet("job-1"),
      capabilities: [{ id: "cap-1" } as never],
    };

    const state = buildInitialReducerState("job-1", initial, null);

    expect(state.currentJobId).toBe("job-1");
    expect(state.job.data?.id).toBe("job-1");
    expect(state.job.loading).toBe(false);
    expect(state.job.error).toBeNull();
    expect(state.job.pendingRequestId).toBeNull();
    expect(state.routeSet.data?.id).toBe("job-1");
    expect(state.capabilities.data).toHaveLength(1);
    // 未在 initialData 中提供的字段应 fallback 到 null。
    expect(state.effectPreviews.data).toBeNull();
    expect(state.promptPackages.data).toBeNull();
  });

  it("cachedFields 优先级高于 initialData", () => {
    const initial: UseAutopilotRightRailDataOptions["initialData"] = {
      job: makeJob("job-1"),
    };
    const cached = {
      job: makeJob("job-1-from-cache"),
      routeSet: makeRouteSet("job-1-from-cache"),
    };

    const state = buildInitialReducerState("job-1", initial, cached);

    expect(state.job.data?.id).toBe("job-1-from-cache");
    expect(state.routeSet.data?.id).toBe("job-1-from-cache");
  });

  it("覆盖 ALL_FIELD_NAMES 全 15 个字段", () => {
    expect(ALL_FIELD_NAMES).toHaveLength(15);
    const state = buildInitialReducerState("job-1", undefined, null);
    for (const field of ALL_FIELD_NAMES) {
      expect(state[field]).toBeDefined();
      expect(state[field].loading).toBe(false);
      expect(state[field].pendingRequestId).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// deriveWave1FieldUpdates
// ---------------------------------------------------------------------------

describe("deriveWave1FieldUpdates (Spec 4 Task 2)", () => {
  it("从 snapshot 派生 W1 4 个字段", () => {
    const updates = deriveWave1FieldUpdates({
      job: makeJob("job-1"),
      routeSet: makeRouteSet("job-1"),
      selection: makeSelection("job-1"),
      specTree: makeSpecTree("job-1"),
    } as never);

    expect(Object.keys(updates).sort()).toEqual(
      ["job", "routeSet", "selection", "specTree"].sort()
    );
    expect((updates.job as BlueprintGenerationJob).id).toBe("job-1");
  });

  it("缺失的 sibling 字段派生为 null（而非 undefined）", () => {
    const updates = deriveWave1FieldUpdates({ job: makeJob("job-1") } as never);

    expect(updates.job).not.toBeNull();
    expect(updates.routeSet).toBeNull();
    expect(updates.selection).toBeNull();
    expect(updates.specTree).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reducer: JOB_CHANGED
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · JOB_CHANGED (Spec 4 Task 2)", () => {
  it("切换到新 jobId 时所有字段重置为 initialData", () => {
    const initial = buildInitialReducerState("job-1", { job: makeJob("job-1") }, null);

    const next = rightRailDataReducer(initial, {
      type: "JOB_CHANGED",
      jobId: "job-2",
      initialData: { job: makeJob("job-2") },
      cachedFields: null,
    });

    expect(next.currentJobId).toBe("job-2");
    expect(next.job.data?.id).toBe("job-2");
    expect(next.job.pendingRequestId).toBeNull();
  });

  it("切回历史 jobId 时从 cachedFields 复用已缓存值", () => {
    const initial = buildInitialReducerState("job-2", undefined, null);
    const cache = { job: makeJob("job-1"), routeSet: makeRouteSet("job-1") };

    const next = rightRailDataReducer(initial, {
      type: "JOB_CHANGED",
      jobId: "job-1",
      initialData: undefined,
      cachedFields: cache,
    });

    expect(next.currentJobId).toBe("job-1");
    expect(next.job.data?.id).toBe("job-1");
    expect(next.routeSet.data?.id).toBe("job-1");
  });
});

// ---------------------------------------------------------------------------
// Reducer: FETCH_STARTED
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · FETCH_STARTED (Spec 4 Task 2)", () => {
  it("在指定字段上设置 loading=true 与 pendingRequestId", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);

    const next = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 1,
    });

    expect(next.job.loading).toBe(true);
    expect(next.job.pendingRequestId).toBe(1);
    expect(next.routeSet.loading).toBe(true);
    expect(next.routeSet.pendingRequestId).toBe(1);
    // Wave 2+ 字段不受影响。
    expect(next.agentCrew.loading).toBe(false);
    expect(next.agentCrew.pendingRequestId).toBeNull();
  });

  it("jobId 不匹配 currentJobId 时 state 保持不变（Ignore_Stale_Policy）", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);

    const next = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-X", // stale
      fields: WAVE_1_FIELDS,
      requestId: 1,
    });

    expect(next).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// Reducer: FETCH_FULFILLED
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · FETCH_FULFILLED (Spec 4 Task 2)", () => {
  it("成功后 data 被写入, loading=false, error=null, pendingRequestId=null", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 1,
    });

    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: {
        job: makeJob("job-1"),
        routeSet: makeRouteSet("job-1"),
        selection: null,
        specTree: null,
      },
    });

    expect(next.job.data?.id).toBe("job-1");
    expect(next.job.loading).toBe(false);
    expect(next.job.error).toBeNull();
    expect(next.job.pendingRequestId).toBeNull();
    expect(next.routeSet.data?.id).toBe("job-1");
    expect(next.selection.data).toBeNull();
  });

  it("pendingRequestId 不匹配时忽略该字段 update（Ignore_Stale_Policy 第 2 道护栏）", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 2, // 更新的请求 id 已落地
    });

    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1, // 老请求 resolve，应被忽略
      fieldUpdates: { job: makeJob("job-1-stale") },
    });

    // pendingRequestId 保持 2, job.data 未被老响应覆盖
    expect(next.job.pendingRequestId).toBe(2);
    expect(next.job.data).toBeNull();
    expect(next.job.loading).toBe(true);
  });

  it("跨 jobId 的 stale 响应被完全忽略（Ignore_Stale_Policy 第 1 道护栏）", () => {
    const started = rightRailDataReducer(
      buildInitialReducerState("job-1", undefined, null),
      {
        type: "FETCH_STARTED",
        jobId: "job-1",
        fields: WAVE_1_FIELDS,
        requestId: 1,
      }
    );
    const changed = rightRailDataReducer(started, {
      type: "JOB_CHANGED",
      jobId: "job-2",
      initialData: undefined,
      cachedFields: null,
    });

    const stale = rightRailDataReducer(changed, {
      type: "FETCH_FULFILLED",
      jobId: "job-1", // 老 jobId 的响应
      requestId: 1,
      fieldUpdates: { job: makeJob("job-1") },
    });

    expect(stale).toBe(changed);
    expect(stale.currentJobId).toBe("job-2");
    expect(stale.job.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reducer: FETCH_REJECTED
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · FETCH_REJECTED (Spec 4 Task 2)", () => {
  it("失败时 data 保留 previousCache, error 被写入, loading=false", () => {
    const initial = buildInitialReducerState(
      "job-1",
      { job: makeJob("job-1-prev") },
      null
    );
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 1,
    });

    const error = makeError("network failed");
    const next = rightRailDataReducer(started, {
      type: "FETCH_REJECTED",
      jobId: "job-1",
      requestId: 1,
      fields: WAVE_1_FIELDS,
      error,
    });

    // data 保留 previousCache（来自 initialData 的 job）
    expect(next.job.data?.id).toBe("job-1-prev");
    expect(next.job.error).toBe(error);
    expect(next.job.loading).toBe(false);
    expect(next.job.pendingRequestId).toBeNull();
  });

  it("pendingRequestId 不匹配时忽略该字段 rejection", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 2, // 最新请求
    });

    const error = makeError("late error");
    const next = rightRailDataReducer(started, {
      type: "FETCH_REJECTED",
      jobId: "job-1",
      requestId: 1, // 老请求 reject
      fields: WAVE_1_FIELDS,
      error,
    });

    // pendingRequestId 保持 2, error 未被老响应写入
    expect(next.job.pendingRequestId).toBe(2);
    expect(next.job.error).toBeNull();
    expect(next.job.loading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hook API surface (smoke test)
// ---------------------------------------------------------------------------

describe("useAutopilotRightRailData · API surface (Spec 4 Task 2)", () => {
  it("exports the expected 15 field names via ALL_FIELD_NAMES and matches RightRailDataView keys", () => {
    const expected: (keyof RightRailDataView)[] = [
      "job",
      "routeSet",
      "selection",
      "specTree",
      "agentCrew",
      "capabilities",
      "capabilityInvocations",
      "capabilityEvidence",
      "effectPreviews",
      "promptPackages",
      "landingPlans",
      "engineeringRuns",
      "artifactEntries",
      "artifactReplays",
      "artifactFeedback",
    ];
    expect([...ALL_FIELD_NAMES].sort()).toEqual(expected.sort());
  });

  it("WAVE_1_FIELDS 精确等于 4 个顶层字段", () => {
    expect([...WAVE_1_FIELDS].sort()).toEqual(
      ["job", "routeSet", "selection", "specTree"].sort()
    );
  });
});
