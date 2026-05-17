/**
 * Autopilot 驾驶舱右栏数据层 Hook — 单元测试
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 2（Ignore_Stale_Policy 在 reducer 层强制）
 * - Requirement 3（Wave 2 懒加载 gate + registry-first 合并 + agentCrew 派生）
 * - Requirement 4（Cache 切换语义）
 * - Requirement 8（fetch 失败保留 previousCache）
 *
 * Task 2-3 范围：
 * - 只测试 reducer 的 pure 转换规则（`JOB_CHANGED` / `FETCH_STARTED` / `FETCH_FULFILLED` /
 *   `FETCH_REJECTED`）、以及 `buildInitialReducerState` / `deriveWave1FieldUpdates` helper。
 * - Task 3 新增 Wave 2 helper 单测：`shouldLoadField` 懒加载 gate、`mergeCapabilities` 合并
 *   规则、`deriveAgentCrewFromJob` 派生规则。
 * - Task 4 新增 Wave 3 范围：`shouldLoadField` 对 `effectPreviews / promptPackages /
 *   landingPlans / engineeringRuns` 四个字段的懒加载阈值；reducer 对 Wave 3 字段的
 *   `FETCH_STARTED / FETCH_FULFILLED / FETCH_REJECTED` 行为（与 Wave 1/2 共用 reducer，但
 *   需覆盖 Wave 3 字段集合不污染 Wave 1/2/4）；`JOB_CHANGED` 切回历史 `jobId` 时从
 *   `cachedFields` 恢复 Wave 3 字段；`WAVE_3_FETCH_FIELDS` 常量断言。
 * - Task 5 新增 Wave 4 范围：`shouldLoadField` 对 `artifactEntries / artifactReplays /
 *   artifactFeedback` 三个字段的懒加载阈值（`currentSubStage === "artifact_memory"` 或
 *   `job.stage === "engineering_landing"`）；reducer 对 Wave 4 fetch 字段（entries / replays）
 *   的 `FETCH_STARTED / FETCH_FULFILLED / FETCH_REJECTED` 行为（不污染 Wave 1/2/3）；
 *   `JOB_CHANGED` 切回历史 `jobId` 时从 `cachedFields` 恢复 Wave 4 fetch 字段；
 *   `WAVE_4_FETCH_FIELDS` 常量断言（**不**含 `artifactFeedback`，因为是派生字段）；
 *   `deriveArtifactFeedbackFromJob` helper 从 job artifacts 派生 feedback 列表。
 * - 不测试 hook 的 fetch 副作用与 React render cycle（需要 DOM runtime；本 repo 当前不集成
 *   `@testing-library/react`，且 `useEffect` 在 `renderToStaticMarkup` 中不执行）。
 * - Task 11 的 PBT 会引入 `renderHook` 或等价手段覆盖 fetch 副作用、SSE、polling 与 retry。
 */

import { describe, expect, it } from "vitest";

import type { ApiRequestError } from "@/lib/api-client";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecDocument,
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
  WAVE_2_FETCH_FIELDS,
  WAVE_3_FETCH_FIELDS,
  WAVE_4_FETCH_FIELDS,
  ALL_FIELD_NAMES,
  shouldLoadField,
  deriveAgentCrewFromJob,
  mergeCapabilities,
  deriveArtifactFeedbackFromJob,
  shouldTriggerPerFieldRetry,
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

function makeSpecDocument(id: string): BlueprintSpecDocument {
  return {
    id,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-1",
    type: "requirements",
    title: "Requirements",
    content: "# Requirements",
    status: "draft",
    version: 1,
  } as unknown as BlueprintSpecDocument;
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

  it("把 snapshot.specDocuments 合并到 specTree.documents，供 SPEC 文档阶段立即识别 ready", () => {
    const specTree = makeSpecTree("tree-1");
    const documents = [makeSpecDocument("doc-1")];
    const updates = deriveWave1FieldUpdates({
      job: makeJob("job-1"),
      specTree,
      specDocuments: documents,
    } as never);

    expect(
      (updates.specTree as BlueprintSpecTree & {
        documents?: BlueprintSpecDocument[];
      }).documents
    ).toBe(documents);
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

  it("WAVE_2_FETCH_FIELDS 精确等于 3 个 fetch 字段（agentCrew 派生不在内）", () => {
    expect([...WAVE_2_FETCH_FIELDS].sort()).toEqual(
      ["capabilities", "capabilityInvocations", "capabilityEvidence"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Wave 2 helpers: shouldLoadField, mergeCapabilities, deriveAgentCrewFromJob
// ---------------------------------------------------------------------------

describe("shouldLoadField (Spec 4 Task 3)", () => {
  const baseParams = {
    jobStage: "input" as BlueprintGenerationJob["stage"],
    skipLazyLoad: false,
  };

  it("Wave 2 字段：currentSubStage 存在（任一 fabric 子阶段）时返回 true", () => {
    for (const field of [
      "agentCrew",
      "capabilities",
      "capabilityInvocations",
      "capabilityEvidence",
    ] as const) {
      expect(
        shouldLoadField(field, { ...baseParams, currentSubStage: "spec_tree" })
      ).toBe(true);
      expect(
        shouldLoadField(field, { ...baseParams, currentSubStage: "agent_crew_fabric" })
      ).toBe(true);
      expect(
        shouldLoadField(field, { ...baseParams, currentSubStage: "artifact_memory" })
      ).toBe(true);
    }
  });

  it("Wave 2 字段：currentSubStage === undefined 且 skipLazyLoad === false 时返回 false", () => {
    for (const field of [
      "agentCrew",
      "capabilities",
      "capabilityInvocations",
      "capabilityEvidence",
    ] as const) {
      expect(
        shouldLoadField(field, { ...baseParams, currentSubStage: undefined })
      ).toBe(false);
    }
  });

  it("skipLazyLoad === true 时任何字段（Wave 2）都返回 true，即便 currentSubStage === undefined", () => {
    for (const field of [
      "agentCrew",
      "capabilities",
      "capabilityInvocations",
      "capabilityEvidence",
    ] as const) {
      expect(
        shouldLoadField(field, {
          ...baseParams,
          currentSubStage: undefined,
          skipLazyLoad: true,
        })
      ).toBe(true);
    }
  });

  it("Wave 4 字段（artifactEntries / artifactReplays / artifactFeedback）按 artifact_memory 或 engineering_landing 阈值开启", () => {
    // currentSubStage === "artifact_memory" → 三个字段均返回 true
    for (const field of [
      "artifactEntries",
      "artifactReplays",
      "artifactFeedback",
    ] as const) {
      expect(
        shouldLoadField(field, {
          ...baseParams,
          currentSubStage: "artifact_memory",
        })
      ).toBe(true);
    }
  });
});

describe("mergeCapabilities (Spec 4 Task 3)", () => {
  const cap = (id: string) =>
    ({ id, label: id } as unknown as BlueprintRuntimeCapability);

  it("registry-first fallback：job 非空时使用 job 列表", () => {
    const registry = [cap("A"), cap("B")];
    const jobList = [cap("B"), cap("C")];
    expect(mergeCapabilities(registry, jobList)).toEqual(jobList);
  });

  it("job 为空数组时回退到 registry 列表", () => {
    const registry = [cap("A"), cap("B")];
    expect(mergeCapabilities(registry, [])).toEqual(registry);
  });

  it("registry 缺失时采用 job 列表（包含空数组）", () => {
    const jobList = [cap("X")];
    expect(mergeCapabilities(null, jobList)).toEqual(jobList);
    expect(mergeCapabilities(null, [])).toEqual([]);
  });

  it("两侧都为 null 时返回 null（调用方据此 dispatch REJECTED）", () => {
    expect(mergeCapabilities(null, null)).toBeNull();
  });
});

describe("deriveAgentCrewFromJob (Spec 4 Task 3)", () => {
  function makeJobWithArtifacts(
    artifacts: Array<{ type: string; payload: unknown }>
  ): BlueprintGenerationJob {
    return {
      id: "job-1",
      request: { userInput: "", sources: [] } as unknown as BlueprintGenerationJob["request"],
      status: "running",
      stage: "spec_tree",
      version: "1",
      createdAt: "2026-05-11T00:00:00Z",
      updatedAt: "2026-05-11T00:00:00Z",
      artifacts: artifacts.map((a, i) => ({
        id: `artifact-${i}`,
        type: a.type,
        title: `title-${i}`,
        summary: `summary-${i}`,
        createdAt: "2026-05-11T00:00:00Z",
        payload: a.payload,
      })) as unknown as BlueprintGenerationJob["artifacts"],
      events: [],
    } as unknown as BlueprintGenerationJob;
  }

  it("job 为 null 时返回 null", () => {
    expect(deriveAgentCrewFromJob(null)).toBeNull();
  });

  it("job 无 agent_crew artifact 时返回 null", () => {
    const job = makeJobWithArtifacts([
      { type: "intake", payload: { anything: true } },
    ]);
    expect(deriveAgentCrewFromJob(job)).toBeNull();
  });

  it("job 有 agent_crew artifact 时返回 normalize 后的 snapshot", () => {
    const crewPayload = {
      id: "crew-1",
      jobId: "job-1",
      stage: "spec_tree",
      roles: [],
      capabilityMatrix: [],
      activationPolicies: [],
      presence: [],
      roleTimelines: [],
      createdAt: "2026-05-11T00:00:00Z",
      updatedAt: "2026-05-11T00:00:00Z",
    };
    const job = makeJobWithArtifacts([
      { type: "agent_crew", payload: crewPayload },
    ]);
    const snapshot = deriveAgentCrewFromJob(job);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.id).toBe("crew-1");
  });

  it("优先取最新 agent_crew payload（artifacts 中可能有多个历史版本）", () => {
    const older = {
      id: "crew-old",
      jobId: "job-1",
      stage: "spec_tree",
      roles: [],
      capabilityMatrix: [],
      activationPolicies: [],
      presence: [],
      roleTimelines: [],
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    };
    const newer = { ...older, id: "crew-new" };
    const job = makeJobWithArtifacts([
      { type: "agent_crew", payload: older },
      { type: "agent_crew", payload: newer },
    ]);
    expect(deriveAgentCrewFromJob(job)?.id).toBe("crew-new");
  });

  it("role_timeline payload 存在时会合并到 roleTimelines / presence", () => {
    const crewPayload = {
      id: "crew-1",
      jobId: "job-1",
      stage: "spec_tree",
      roles: [{ id: "role-1", name: "Planner" }],
      capabilityMatrix: [],
      activationPolicies: [],
      presence: [],
      roleTimelines: [],
      createdAt: "2026-05-11T00:00:00Z",
      updatedAt: "2026-05-11T00:00:00Z",
    };
    const timelineEntry = {
      id: "timeline-1",
      jobId: "job-1",
      roleId: "role-1",
      roleName: "Planner",
      displayName: "Planner",
      displayLabel: "Planner",
      group: "core",
      stage: "spec_tree",
      state: "active",
      currentAction: "drafting",
      capabilityIds: [],
      capabilityLabels: [],
      artifactIds: [],
      evidenceIds: [],
    };
    const job = makeJobWithArtifacts([
      { type: "agent_crew", payload: crewPayload },
      { type: "role_timeline", payload: { timelines: [timelineEntry] } },
    ]);
    const snapshot = deriveAgentCrewFromJob(job);
    expect(snapshot?.roleTimelines.length).toBeGreaterThan(0);
    expect(snapshot?.presence.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Reducer: Wave 2 field 行为（与 Wave 1 reducer 语义保持一致）
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · Wave 2 fetch fields (Spec 4 Task 3)", () => {
  function makeCapability(id: string): BlueprintRuntimeCapability {
    return { id, label: id } as unknown as BlueprintRuntimeCapability;
  }

  it("FETCH_STARTED 只把目标字段置为 loading，不动 Wave 1 字段", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const next = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: [
        "capabilities",
        "capabilityInvocations",
        "capabilityEvidence",
      ],
      requestId: 10,
    });

    expect(next.capabilities.loading).toBe(true);
    expect(next.capabilityInvocations.loading).toBe(true);
    expect(next.capabilityEvidence.loading).toBe(true);
    // Wave 1 未动
    expect(next.job.loading).toBe(false);
    expect(next.routeSet.loading).toBe(false);
    // agentCrew 不进入 FETCH_STARTED 流程
    expect(next.agentCrew.loading).toBe(false);
    expect(next.agentCrew.pendingRequestId).toBeNull();
  });

  it("FETCH_FULFILLED 批量应用 Wave 2 字段", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["capabilities", "capabilityInvocations", "capabilityEvidence"],
      requestId: 1,
    });

    const mergedCapabilities = [makeCapability("A"), makeCapability("B")];
    const invocations: BlueprintCapabilityInvocation[] = [];
    const evidence: BlueprintCapabilityEvidence[] = [];

    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: {
        capabilities: mergedCapabilities,
        capabilityInvocations: invocations,
        capabilityEvidence: evidence,
      },
    });

    expect(next.capabilities.data).toBe(mergedCapabilities);
    expect(next.capabilities.loading).toBe(false);
    expect(next.capabilityInvocations.data).toBe(invocations);
    expect(next.capabilityEvidence.data).toBe(evidence);
  });

  it("FETCH_FULFILLED 只写入目标字段，其它字段（例如部分字段失败未在 fieldUpdates 中）保持 loading", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["capabilities", "capabilityInvocations", "capabilityEvidence"],
      requestId: 1,
    });

    // 只 fulfill capabilities：invocations / evidence 保持 loading = true
    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: { capabilities: [makeCapability("A")] },
    });

    expect(next.capabilities.loading).toBe(false);
    expect(next.capabilityInvocations.loading).toBe(true);
    expect(next.capabilityEvidence.loading).toBe(true);
  });

  it("FETCH_REJECTED 只把失败字段置为 error 并保留 previousCache", () => {
    const previous = [makeCapability("PREV")];
    const initial = buildInitialReducerState(
      "job-1",
      { capabilities: previous },
      null
    );
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["capabilities"],
      requestId: 1,
    });

    const error: ApiRequestError = {
      kind: "error",
      source: "network",
      endpoint: "/api/blueprint/capabilities",
      message: "boom",
      detail: "",
      retryable: true,
    };
    const next = rightRailDataReducer(started, {
      type: "FETCH_REJECTED",
      jobId: "job-1",
      requestId: 1,
      fields: ["capabilities"],
      error,
    });

    expect(next.capabilities.data).toBe(previous);
    expect(next.capabilities.error).toBe(error);
    expect(next.capabilities.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JOB_CHANGED：Wave 2 字段的 cache seed 行为
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · JOB_CHANGED seeds Wave 2 cache (Spec 4 Task 3)", () => {
  it("切回历史 jobId 时从 cachedFields 恢复 capabilities/capabilityInvocations/capabilityEvidence", () => {
    const initial = buildInitialReducerState("job-2", undefined, null);
    const cachedCapabilities = [
      { id: "A", label: "A" } as unknown as BlueprintRuntimeCapability,
    ];
    const cachedInvocations: BlueprintCapabilityInvocation[] = [];
    const cachedEvidence: BlueprintCapabilityEvidence[] = [];

    const next = rightRailDataReducer(initial, {
      type: "JOB_CHANGED",
      jobId: "job-1",
      initialData: undefined,
      cachedFields: {
        capabilities: cachedCapabilities,
        capabilityInvocations: cachedInvocations,
        capabilityEvidence: cachedEvidence,
      },
    });

    expect(next.capabilities.data).toBe(cachedCapabilities);
    expect(next.capabilities.loading).toBe(false);
    expect(next.capabilityInvocations.data).toBe(cachedInvocations);
    expect(next.capabilityEvidence.data).toBe(cachedEvidence);
    // pendingRequestId 始终为 null（切换后没有 pending fetch）
    expect(next.capabilities.pendingRequestId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wave 3 helper: shouldLoadField 按子阶段 / job.stage 双维度判定
// ---------------------------------------------------------------------------

describe("shouldLoadField · Wave 3 (Spec 4 Task 4)", () => {
  const baseParams = {
    jobStage: null as BlueprintGenerationJob["stage"] | null,
    skipLazyLoad: false,
  };

  // ----- effectPreviews -----
  it("effectPreviews: 5 个合法 currentSubStage 均返回 true", () => {
    for (const sub of [
      "effect_preview",
      "prompt_package",
      "runtime_capability",
      "engineering_handoff",
      "artifact_memory",
    ] as const) {
      expect(
        shouldLoadField("effectPreviews", {
          ...baseParams,
          currentSubStage: sub,
        })
      ).toBe(true);
    }
  });

  it("effectPreviews: 非合法 currentSubStage（spec_tree/agent_crew_fabric）且 jobStage=null 时返回 false", () => {
    for (const sub of [
      "agent_crew_fabric",
      "spec_tree",
    ] as const) {
      expect(
        shouldLoadField("effectPreviews", {
          ...baseParams,
          currentSubStage: sub,
        })
      ).toBe(false);
    }
  });

  it("effectPreviews: jobStage ∈ { preview, effect_preview, prompt_packaging, runtime_capability, engineering_handoff, engineering_landing } 时返回 true（即便 currentSubStage 为非合法 fabric 子阶段）", () => {
    for (const stage of [
      "preview",
      "effect_preview",
      "prompt_packaging",
      "runtime_capability",
      "engineering_handoff",
      "engineering_landing",
    ] as const) {
      expect(
        shouldLoadField("effectPreviews", {
          currentSubStage: "spec_tree",
          jobStage: stage,
          skipLazyLoad: false,
        })
      ).toBe(true);
    }
  });

  it("effectPreviews: jobStage ∈ { input, clarification, route_generation, spec_tree, spec_docs } 且 currentSubStage 非合法时返回 false", () => {
    for (const stage of [
      "input",
      "clarification",
      "route_generation",
      "spec_tree",
      "spec_docs",
    ] as const) {
      expect(
        shouldLoadField("effectPreviews", {
          currentSubStage: "spec_tree",
          jobStage: stage,
          skipLazyLoad: false,
        })
      ).toBe(false);
    }
  });

  // ----- promptPackages -----
  it("promptPackages: 4 个合法 currentSubStage 均返回 true", () => {
    for (const sub of [
      "prompt_package",
      "runtime_capability",
      "engineering_handoff",
      "artifact_memory",
    ] as const) {
      expect(
        shouldLoadField("promptPackages", {
          ...baseParams,
          currentSubStage: sub,
        })
      ).toBe(true);
    }
  });

  it("promptPackages: currentSubStage === effect_preview 时返回 false（该子阶段只解锁 effectPreviews，不解锁 promptPackages）", () => {
    expect(
      shouldLoadField("promptPackages", {
        ...baseParams,
        currentSubStage: "effect_preview",
      })
    ).toBe(false);
  });

  it("promptPackages: jobStage ∈ { prompt_packaging, runtime_capability, engineering_handoff, engineering_landing } 时返回 true", () => {
    for (const stage of [
      "prompt_packaging",
      "runtime_capability",
      "engineering_handoff",
      "engineering_landing",
    ] as const) {
      expect(
        shouldLoadField("promptPackages", {
          currentSubStage: "spec_tree",
          jobStage: stage,
          skipLazyLoad: false,
        })
      ).toBe(true);
    }
  });

  it("promptPackages: jobStage === preview 但 currentSubStage 非合法时返回 false（preview 只解锁 effectPreviews）", () => {
    expect(
      shouldLoadField("promptPackages", {
        currentSubStage: "spec_tree",
        jobStage: "preview",
        skipLazyLoad: false,
      })
    ).toBe(false);
  });

  // ----- landingPlans / engineeringRuns -----
  for (const field of ["landingPlans", "engineeringRuns"] as const) {
    it(`${field}: 2 个合法 currentSubStage（engineering_handoff / artifact_memory）均返回 true`, () => {
      for (const sub of ["engineering_handoff", "artifact_memory"] as const) {
        expect(
          shouldLoadField(field, { ...baseParams, currentSubStage: sub })
        ).toBe(true);
      }
    });

    it(`${field}: currentSubStage === prompt_package 且 jobStage=null 时返回 false`, () => {
      expect(
        shouldLoadField(field, {
          ...baseParams,
          currentSubStage: "prompt_package",
        })
      ).toBe(false);
    });

    it(`${field}: jobStage ∈ { engineering_handoff, engineering_landing } 时返回 true`, () => {
      for (const stage of [
        "engineering_handoff",
        "engineering_landing",
      ] as const) {
        expect(
          shouldLoadField(field, {
            currentSubStage: "spec_tree",
            jobStage: stage,
            skipLazyLoad: false,
          })
        ).toBe(true);
      }
    });

    it(`${field}: jobStage ∈ { prompt_packaging, runtime_capability } 且 currentSubStage 非合法时返回 false`, () => {
      for (const stage of ["prompt_packaging", "runtime_capability"] as const) {
        expect(
          shouldLoadField(field, {
            currentSubStage: "spec_tree",
            jobStage: stage,
            skipLazyLoad: false,
          })
        ).toBe(false);
      }
    });
  }

  it("skipLazyLoad === true 时 Wave 3 四个字段全部返回 true（即便 currentSubStage=undefined 且 jobStage=null）", () => {
    for (const field of [
      "effectPreviews",
      "promptPackages",
      "landingPlans",
      "engineeringRuns",
    ] as const) {
      expect(
        shouldLoadField(field, {
          currentSubStage: undefined,
          jobStage: null,
          skipLazyLoad: true,
        })
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Reducer: Wave 3 field 行为（reducer 与 Wave 1/2 共享，但需独立覆盖 Wave 3 字段集合）
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · Wave 3 fetch fields (Spec 4 Task 4)", () => {
  it("FETCH_STARTED 只把 Wave 3 四个字段置为 loading，不动 Wave 1/2/4 字段", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const next = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: [
        "effectPreviews",
        "promptPackages",
        "landingPlans",
        "engineeringRuns",
      ],
      requestId: 100,
    });

    expect(next.effectPreviews.loading).toBe(true);
    expect(next.effectPreviews.pendingRequestId).toBe(100);
    expect(next.promptPackages.loading).toBe(true);
    expect(next.landingPlans.loading).toBe(true);
    expect(next.engineeringRuns.loading).toBe(true);
    // Wave 1/2 未受影响
    expect(next.job.loading).toBe(false);
    expect(next.capabilities.loading).toBe(false);
    expect(next.capabilityInvocations.loading).toBe(false);
    expect(next.capabilityEvidence.loading).toBe(false);
    expect(next.agentCrew.loading).toBe(false);
    // Wave 4 未受影响
    expect(next.artifactEntries.loading).toBe(false);
    expect(next.artifactReplays.loading).toBe(false);
    expect(next.artifactFeedback.loading).toBe(false);
  });

  it("FETCH_FULFILLED 批量应用 Wave 3 字段", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: [
        "effectPreviews",
        "promptPackages",
        "landingPlans",
        "engineeringRuns",
      ],
      requestId: 1,
    });

    const effectPreviewsPayload = [{ id: "ep-1" }] as never;
    const promptPackagesPayload = [{ id: "pp-1" }] as never;
    const landingPlansPayload = [{ id: "lp-1" }] as never;
    const engineeringRunsPayload = [{ id: "er-1" }] as never;

    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: {
        effectPreviews: effectPreviewsPayload,
        promptPackages: promptPackagesPayload,
        landingPlans: landingPlansPayload,
        engineeringRuns: engineeringRunsPayload,
      },
    });

    expect(next.effectPreviews.data).toBe(effectPreviewsPayload);
    expect(next.effectPreviews.loading).toBe(false);
    expect(next.effectPreviews.error).toBeNull();
    expect(next.promptPackages.data).toBe(promptPackagesPayload);
    expect(next.landingPlans.data).toBe(landingPlansPayload);
    expect(next.engineeringRuns.data).toBe(engineeringRunsPayload);
  });

  it("部分字段失败时，已成功字段保持数据，失败字段保留 previousCache 并写入 error", () => {
    const previousLanding = [{ id: "lp-old" }] as never;
    const initial = buildInitialReducerState(
      "job-1",
      { landingPlans: previousLanding },
      null
    );
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["effectPreviews", "landingPlans"],
      requestId: 1,
    });

    // 只 fulfill effectPreviews
    const fulfilled = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: { effectPreviews: [{ id: "ep-1" }] as never },
    });

    const error: ApiRequestError = {
      kind: "error",
      source: "network",
      endpoint: "/api/blueprint/jobs/job-1/engineering-landing",
      message: "boom",
      detail: "",
      retryable: true,
    };
    const rejected = rightRailDataReducer(fulfilled, {
      type: "FETCH_REJECTED",
      jobId: "job-1",
      requestId: 1,
      fields: ["landingPlans"],
      error,
    });

    // effectPreviews 成功值不受 rejection 影响
    expect(rejected.effectPreviews.data).toEqual([{ id: "ep-1" }]);
    expect(rejected.effectPreviews.loading).toBe(false);
    // landingPlans 保留 previousCache 并挂上 error
    expect(rejected.landingPlans.data).toBe(previousLanding);
    expect(rejected.landingPlans.error).toBe(error);
    expect(rejected.landingPlans.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JOB_CHANGED：Wave 3 字段的 cache seed 行为
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · JOB_CHANGED seeds Wave 3 cache (Spec 4 Task 4)", () => {
  it("切回历史 jobId 时从 cachedFields 恢复 effectPreviews/promptPackages/landingPlans/engineeringRuns", () => {
    const initial = buildInitialReducerState("job-2", undefined, null);
    const cachedEffectPreviews = [{ id: "ep-cached" }] as never;
    const cachedPromptPackages = [{ id: "pp-cached" }] as never;
    const cachedLandingPlans = [{ id: "lp-cached" }] as never;
    const cachedEngineeringRuns = [{ id: "er-cached" }] as never;

    const next = rightRailDataReducer(initial, {
      type: "JOB_CHANGED",
      jobId: "job-1",
      initialData: undefined,
      cachedFields: {
        effectPreviews: cachedEffectPreviews,
        promptPackages: cachedPromptPackages,
        landingPlans: cachedLandingPlans,
        engineeringRuns: cachedEngineeringRuns,
      },
    });

    expect(next.effectPreviews.data).toBe(cachedEffectPreviews);
    expect(next.effectPreviews.loading).toBe(false);
    expect(next.promptPackages.data).toBe(cachedPromptPackages);
    expect(next.landingPlans.data).toBe(cachedLandingPlans);
    expect(next.engineeringRuns.data).toBe(cachedEngineeringRuns);
    // pendingRequestId 始终为 null
    expect(next.effectPreviews.pendingRequestId).toBeNull();
    expect(next.promptPackages.pendingRequestId).toBeNull();
    expect(next.landingPlans.pendingRequestId).toBeNull();
    expect(next.engineeringRuns.pendingRequestId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WAVE_3_FETCH_FIELDS 常量断言
// ---------------------------------------------------------------------------

describe("WAVE_3_FETCH_FIELDS (Spec 4 Task 4)", () => {
  it("精确等于 4 个 Wave 3 fetch 字段", () => {
    expect([...WAVE_3_FETCH_FIELDS].sort()).toEqual(
      [
        "effectPreviews",
        "promptPackages",
        "landingPlans",
        "engineeringRuns",
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Wave 4 helper: shouldLoadField 按 artifact_memory / engineering_landing 判定
// ---------------------------------------------------------------------------

describe("shouldLoadField · Wave 4 (Spec 4 Task 5)", () => {
  const baseParams = {
    jobStage: null as BlueprintGenerationJob["stage"] | null,
    skipLazyLoad: false,
  };

  const WAVE_4_FIELDS = [
    "artifactEntries",
    "artifactReplays",
    "artifactFeedback",
  ] as const;

  it("currentSubStage === 'artifact_memory' 时 3 个字段均返回 true", () => {
    for (const field of WAVE_4_FIELDS) {
      expect(
        shouldLoadField(field, {
          ...baseParams,
          currentSubStage: "artifact_memory",
        })
      ).toBe(true);
    }
  });

  it("非 artifact_memory 的其它合法 currentSubStage（spec_tree / agent_crew_fabric / effect_preview / prompt_package / runtime_capability / engineering_handoff）且 jobStage=null 时返回 false", () => {
    for (const sub of [
      "spec_tree",
      "agent_crew_fabric",
      "effect_preview",
      "prompt_package",
      "runtime_capability",
      "engineering_handoff",
    ] as const) {
      for (const field of WAVE_4_FIELDS) {
        expect(
          shouldLoadField(field, {
            ...baseParams,
            currentSubStage: sub,
          })
        ).toBe(false);
      }
    }
  });

  it("jobStage === 'engineering_landing' 且 currentSubStage=undefined 时 3 个字段均返回 true", () => {
    for (const field of WAVE_4_FIELDS) {
      expect(
        shouldLoadField(field, {
          currentSubStage: undefined,
          jobStage: "engineering_landing",
          skipLazyLoad: false,
        })
      ).toBe(true);
    }
  });

  it("非 engineering_landing 的其它合法 jobStage（engineering_handoff / preview / prompt_packaging / runtime_capability）且 currentSubStage 非 artifact_memory 时返回 false", () => {
    for (const stage of [
      "engineering_handoff",
      "preview",
      "prompt_packaging",
      "runtime_capability",
    ] as const) {
      for (const field of WAVE_4_FIELDS) {
        expect(
          shouldLoadField(field, {
            currentSubStage: "spec_tree",
            jobStage: stage,
            skipLazyLoad: false,
          })
        ).toBe(false);
      }
    }
  });

  it("skipLazyLoad === true 时 Wave 4 三个字段全部返回 true（即便 currentSubStage=undefined 且 jobStage=null）", () => {
    for (const field of WAVE_4_FIELDS) {
      expect(
        shouldLoadField(field, {
          currentSubStage: undefined,
          jobStage: null,
          skipLazyLoad: true,
        })
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Reducer: Wave 4 field 行为（Wave 4 fetch 字段 = entries + replays；feedback 为派生字段不
// 进入 reducer 流程）
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · Wave 4 fetch fields (Spec 4 Task 5)", () => {
  it("FETCH_STARTED 只把 artifactEntries / artifactReplays 置为 loading，不动 Wave 1/2/3 或 artifactFeedback", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const next = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["artifactEntries", "artifactReplays"],
      requestId: 200,
    });

    expect(next.artifactEntries.loading).toBe(true);
    expect(next.artifactEntries.pendingRequestId).toBe(200);
    expect(next.artifactReplays.loading).toBe(true);
    expect(next.artifactReplays.pendingRequestId).toBe(200);
    // artifactFeedback 不进入 reducer 流程
    expect(next.artifactFeedback.loading).toBe(false);
    expect(next.artifactFeedback.pendingRequestId).toBeNull();
    // Wave 1/2/3 未受影响
    expect(next.job.loading).toBe(false);
    expect(next.capabilities.loading).toBe(false);
    expect(next.effectPreviews.loading).toBe(false);
    expect(next.promptPackages.loading).toBe(false);
    expect(next.landingPlans.loading).toBe(false);
    expect(next.engineeringRuns.loading).toBe(false);
  });

  it("FETCH_FULFILLED 批量应用 Wave 4 fetch 字段", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["artifactEntries", "artifactReplays"],
      requestId: 1,
    });

    const entriesPayload = [{ id: "entry-1" }] as never;
    const replaysPayload = [{ id: "replay-1" }] as never;

    const next = rightRailDataReducer(started, {
      type: "FETCH_FULFILLED",
      jobId: "job-1",
      requestId: 1,
      fieldUpdates: {
        artifactEntries: entriesPayload,
        artifactReplays: replaysPayload,
      },
    });

    expect(next.artifactEntries.data).toBe(entriesPayload);
    expect(next.artifactEntries.loading).toBe(false);
    expect(next.artifactEntries.error).toBeNull();
    expect(next.artifactReplays.data).toBe(replaysPayload);
    expect(next.artifactReplays.loading).toBe(false);
  });

  it("FETCH_REJECTED 保留 previousCache 并写入 error", () => {
    const previousEntries = [{ id: "entry-old" }] as never;
    const initial = buildInitialReducerState(
      "job-1",
      { artifactEntries: previousEntries },
      null
    );
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: ["artifactEntries"],
      requestId: 1,
    });

    const error: ApiRequestError = {
      kind: "error",
      source: "network",
      endpoint: "/api/blueprint/jobs/job-1/artifact-ledger",
      message: "boom",
      detail: "",
      retryable: true,
    };
    const next = rightRailDataReducer(started, {
      type: "FETCH_REJECTED",
      jobId: "job-1",
      requestId: 1,
      fields: ["artifactEntries"],
      error,
    });

    expect(next.artifactEntries.data).toBe(previousEntries);
    expect(next.artifactEntries.error).toBe(error);
    expect(next.artifactEntries.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JOB_CHANGED：Wave 4 字段的 cache seed 行为
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · JOB_CHANGED seeds Wave 4 cache (Spec 4 Task 5)", () => {
  it("切回历史 jobId 时从 cachedFields 恢复 artifactEntries / artifactReplays / artifactFeedback", () => {
    const initial = buildInitialReducerState("job-2", undefined, null);
    const cachedEntries = [{ id: "entry-cached" }] as never;
    const cachedReplays = [{ id: "replay-cached" }] as never;
    const cachedFeedback = [{ id: "feedback-cached" }] as never;

    const next = rightRailDataReducer(initial, {
      type: "JOB_CHANGED",
      jobId: "job-1",
      initialData: undefined,
      cachedFields: {
        artifactEntries: cachedEntries,
        artifactReplays: cachedReplays,
        artifactFeedback: cachedFeedback,
      },
    });

    expect(next.artifactEntries.data).toBe(cachedEntries);
    expect(next.artifactEntries.loading).toBe(false);
    expect(next.artifactReplays.data).toBe(cachedReplays);
    expect(next.artifactFeedback.data).toBe(cachedFeedback);
    expect(next.artifactEntries.pendingRequestId).toBeNull();
    expect(next.artifactReplays.pendingRequestId).toBeNull();
    expect(next.artifactFeedback.pendingRequestId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WAVE_4_FETCH_FIELDS 常量断言
// ---------------------------------------------------------------------------

describe("WAVE_4_FETCH_FIELDS (Spec 4 Task 5)", () => {
  it("精确等于 2 个 Wave 4 fetch 字段（不含派生字段 artifactFeedback）", () => {
    expect([...WAVE_4_FETCH_FIELDS].sort()).toEqual(
      ["artifactEntries", "artifactReplays"].sort()
    );
    expect([...WAVE_4_FETCH_FIELDS]).not.toContain("artifactFeedback");
  });
});

// ---------------------------------------------------------------------------
// deriveArtifactFeedbackFromJob helper
// ---------------------------------------------------------------------------

describe("deriveArtifactFeedbackFromJob (Spec 4 Task 5)", () => {
  function makeJobWithArtifacts(
    artifacts: Array<{ type: string; payload: unknown }>
  ): BlueprintGenerationJob {
    return {
      id: "job-1",
      request: { userInput: "", sources: [] } as unknown as BlueprintGenerationJob["request"],
      status: "running",
      stage: "engineering_landing",
      version: "1",
      createdAt: "2026-05-11T00:00:00Z",
      updatedAt: "2026-05-11T00:00:00Z",
      artifacts: artifacts.map((a, i) => ({
        id: `artifact-${i}`,
        type: a.type,
        title: `title-${i}`,
        summary: `summary-${i}`,
        createdAt: "2026-05-11T00:00:00Z",
        payload: a.payload,
      })) as unknown as BlueprintGenerationJob["artifacts"],
      events: [],
    } as unknown as BlueprintGenerationJob;
  }

  it("job 为 null 时返回空数组", () => {
    expect(deriveArtifactFeedbackFromJob(null)).toEqual([]);
  });

  it("job 无 feedback artifact 时返回空数组", () => {
    const job = makeJobWithArtifacts([
      { type: "intake", payload: { anything: true } },
      { type: "agent_crew", payload: { id: "crew-1" } },
    ]);
    expect(deriveArtifactFeedbackFromJob(job)).toEqual([]);
  });

  it("job 有 feedback artifact 时返回对应 payload 列表", () => {
    const feedbackPayload = {
      id: "feedback-1",
      jobId: "job-1",
      entryId: "entry-1",
      artifactId: "artifact-1",
      artifactType: "spec_tree",
      kind: "feedback" as const,
      message: "looks good",
      summary: "approved",
      status: "recorded",
      recordedAt: "2026-05-11T00:00:00Z",
      actor: "agent-planner",
      tags: [],
    };
    const job = makeJobWithArtifacts([
      { type: "feedback", payload: feedbackPayload },
    ]);
    const result = deriveArtifactFeedbackFromJob(job);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("feedback-1");
    expect(result[0].jobId).toBe("job-1");
    expect(result[0].entryId).toBe("entry-1");
  });

  it("形状不合法的 payload 会被过滤掉（仅保留具备 id/jobId/entryId 的 feedback）", () => {
    const job = makeJobWithArtifacts([
      { type: "feedback", payload: { missing: "fields" } },
      {
        type: "feedback",
        payload: {
          id: "ok",
          jobId: "job-1",
          entryId: "entry-1",
          artifactId: "artifact-1",
          artifactType: "spec_tree",
          kind: "feedback" as const,
          message: "m",
          summary: "s",
          status: "recorded",
          recordedAt: "2026-05-11T00:00:00Z",
          actor: "agent",
          tags: [],
        },
      },
    ]);
    const result = deriveArtifactFeedbackFromJob(job);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ok");
  });

  it("按 createdAt 升序排序多个 feedback payload", () => {
    const olderFeedback = {
      id: "older",
      jobId: "job-1",
      entryId: "entry-1",
      artifactId: "artifact-1",
      artifactType: "spec_tree",
      kind: "feedback" as const,
      message: "m",
      summary: "s",
      status: "recorded",
      recordedAt: "2026-05-10T00:00:00Z",
      actor: "agent",
      tags: [],
      createdAt: "2026-05-10T00:00:00Z",
    };
    const newerFeedback = {
      ...olderFeedback,
      id: "newer",
      createdAt: "2026-05-12T00:00:00Z",
    };
    const job = makeJobWithArtifacts([
      { type: "feedback", payload: newerFeedback },
      { type: "feedback", payload: olderFeedback },
    ]);
    const result = deriveArtifactFeedbackFromJob(job);
    expect(result.map(item => item.id)).toEqual(["older", "newer"]);
  });
});

// ---------------------------------------------------------------------------
// Task 6：SSE + polling 生命周期 helpers
// ---------------------------------------------------------------------------

const {
  isJobAutoRefreshEnabled,
  computePollingBackoff,
  extractStageFromSSEPayload,
} = __testing__;

describe("isJobAutoRefreshEnabled (Spec 4 Task 6)", () => {
  it("undefined 时启用(默认间隔)", () => {
    expect(isJobAutoRefreshEnabled(undefined)).toBe(true);
  });

  it("正整数时启用", () => {
    expect(isJobAutoRefreshEnabled(15000)).toBe(true);
    expect(isJobAutoRefreshEnabled(1)).toBe(true);
  });

  it("0 / 负数 / NaN / Infinity 时禁用", () => {
    expect(isJobAutoRefreshEnabled(0)).toBe(false);
    expect(isJobAutoRefreshEnabled(-1)).toBe(false);
    expect(isJobAutoRefreshEnabled(-15000)).toBe(false);
    expect(isJobAutoRefreshEnabled(Number.NaN)).toBe(false);
    expect(isJobAutoRefreshEnabled(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("computePollingBackoff (Spec 4 Task 6)", () => {
  it("attempt < 3 时使用 base interval", () => {
    expect(computePollingBackoff(15000, 0)).toBe(15000);
    expect(computePollingBackoff(15000, 1)).toBe(15000);
    expect(computePollingBackoff(15000, 2)).toBe(15000);
  });

  it("attempt >= 3 时按 base * 2^(attempt - 2) 退避", () => {
    expect(computePollingBackoff(15000, 3)).toBe(30000);
    expect(computePollingBackoff(15000, 4)).toBe(60000);
    expect(computePollingBackoff(15000, 5)).toBe(120000);
  });

  it("达到 120s 上限后截断", () => {
    expect(computePollingBackoff(15000, 6)).toBe(120000);
    expect(computePollingBackoff(15000, 10)).toBe(120000);
    expect(computePollingBackoff(30000, 3)).toBe(60000);
    expect(computePollingBackoff(30000, 4)).toBe(120000);
  });

  it("非法 base interval 返回 0", () => {
    expect(computePollingBackoff(0, 0)).toBe(0);
    expect(computePollingBackoff(-1000, 3)).toBe(0);
    expect(computePollingBackoff(Number.NaN, 3)).toBe(0);
  });

  it("maxIntervalMs 可自定义", () => {
    expect(computePollingBackoff(1000, 4, 10000)).toBe(4000);
    expect(computePollingBackoff(1000, 6, 10000)).toBe(10000);
  });
});

describe("extractStageFromSSEPayload (Spec 4 Task 6)", () => {
  it("顶层 stage 字段", () => {
    expect(extractStageFromSSEPayload({ stage: "spec_tree" })).toBe("spec_tree");
    expect(
      extractStageFromSSEPayload({ stage: "engineering_landing", other: 1 })
    ).toBe("engineering_landing");
  });

  it("嵌套 job.stage 字段", () => {
    expect(
      extractStageFromSSEPayload({ job: { stage: "prompt_packaging" } })
    ).toBe("prompt_packaging");
  });

  it("顶层 stage 优先于 job.stage", () => {
    expect(
      extractStageFromSSEPayload({
        stage: "preview",
        job: { stage: "input" },
      })
    ).toBe("preview");
  });

  it("无 stage / 非字符串 stage / 非对象 payload → null", () => {
    expect(extractStageFromSSEPayload(null)).toBeNull();
    expect(extractStageFromSSEPayload(undefined)).toBeNull();
    expect(extractStageFromSSEPayload("not-an-object")).toBeNull();
    expect(extractStageFromSSEPayload(42)).toBeNull();
    expect(extractStageFromSSEPayload({})).toBeNull();
    expect(extractStageFromSSEPayload({ stage: 123 })).toBeNull();
    expect(extractStageFromSSEPayload({ job: null })).toBeNull();
    expect(extractStageFromSSEPayload({ job: { stage: 123 } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 6：JOB_CHANGED 清空 pendingRequestId 的护栏（确保 SSE refetch 之后切换 job
// 不会让老 job 的 in-flight 请求污染新 job 字段）。
// ---------------------------------------------------------------------------

describe("rightRailDataReducer · JOB_CHANGED clears pending requests (Spec 4 Task 6)", () => {
  it("切换 jobId 后所有字段的 pendingRequestId 归零", () => {
    const initial = buildInitialReducerState("job-1", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-1",
      fields: WAVE_1_FIELDS,
      requestId: 42,
    });
    expect(started.job.pendingRequestId).toBe(42);
    expect(started.job.loading).toBe(true);

    const changed = rightRailDataReducer(started, {
      type: "JOB_CHANGED",
      jobId: "job-2",
      initialData: undefined,
      cachedFields: null,
    });

    expect(changed.currentJobId).toBe("job-2");
    for (const field of WAVE_1_FIELDS) {
      expect(changed[field].pendingRequestId).toBeNull();
      expect(changed[field].loading).toBe(false);
    }
  });

  it("切回历史 jobId 时仍重置 pendingRequestId 并从 cachedFields seed data", () => {
    const initial = buildInitialReducerState("job-2", undefined, null);
    const started = rightRailDataReducer(initial, {
      type: "FETCH_STARTED",
      jobId: "job-2",
      fields: ["capabilities"],
      requestId: 99,
    });
    expect(started.capabilities.pendingRequestId).toBe(99);

    const changed = rightRailDataReducer(started, {
      type: "JOB_CHANGED",
      jobId: "job-1",
      initialData: undefined,
      cachedFields: {
        job: makeJob("job-1"),
        capabilities: [{ id: "cap-1" } as never],
      },
    });

    expect(changed.currentJobId).toBe("job-1");
    expect(changed.job.data?.id).toBe("job-1");
    expect(changed.capabilities.data).toEqual([{ id: "cap-1" }]);
    expect(changed.capabilities.pendingRequestId).toBeNull();
    expect(changed.capabilities.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 7：Per-field retry helper — shouldTriggerPerFieldRetry
// ---------------------------------------------------------------------------

describe("shouldTriggerPerFieldRetry（Task 7：per-field retry 门限判定）", () => {
  const baseParams = {
    hasJob: true,
    currentSubStage: "artifact_memory" as const,
    jobStage: "engineering_landing" as BlueprintGenerationJob["stage"],
    skipLazyLoad: false,
    pendingRequestId: null,
  };

  it("jobId 为空（hasJob=false）时所有字段 retry 均为 no-op", () => {
    for (const field of ALL_FIELD_NAMES) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          ...baseParams,
          hasJob: false,
        })
      ).toBe(false);
    }
  });

  it("W1 字段（job/routeSet/selection/specTree）始终不受懒加载 gate 影响", () => {
    for (const field of ["job", "routeSet", "selection", "specTree"] as const) {
      // gate 明显关闭（input 阶段且无 sub-stage），仍应允许 retry。
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: undefined,
          jobStage: "input" as BlueprintGenerationJob["stage"],
          skipLazyLoad: false,
          pendingRequestId: null,
        })
      ).toBe(true);
    }
  });

  it("W1 派生字段（agentCrew、artifactFeedback）也不受懒加载 gate 影响", () => {
    for (const field of ["agentCrew", "artifactFeedback"] as const) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: undefined,
          jobStage: "input" as BlueprintGenerationJob["stage"],
          skipLazyLoad: false,
          pendingRequestId: null,
        })
      ).toBe(true);
    }
  });

  it("W1 字段在 pendingRequestId !== null 时 retry 为 no-op（in-flight guard）", () => {
    for (const field of ["job", "routeSet", "selection", "specTree"] as const) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: undefined,
          jobStage: "input" as BlueprintGenerationJob["stage"],
          skipLazyLoad: false,
          pendingRequestId: 42,
        })
      ).toBe(false);
    }
  });

  it("W2 fetch 字段在 gate 打开且 in-flight guard 通过时允许 retry", () => {
    for (const field of WAVE_2_FETCH_FIELDS) {
      expect(shouldTriggerPerFieldRetry(field, baseParams)).toBe(true);
    }
  });

  it("W2 fetch 字段在 gate 关闭时 retry 为 no-op（非 fabric 阶段）", () => {
    for (const field of WAVE_2_FETCH_FIELDS) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: undefined,
          jobStage: "input" as BlueprintGenerationJob["stage"],
          skipLazyLoad: false,
          pendingRequestId: null,
        })
      ).toBe(false);
    }
  });

  it("W2 fetch 字段在 pendingRequestId !== null 时 retry 为 no-op（in-flight guard）", () => {
    for (const field of WAVE_2_FETCH_FIELDS) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          ...baseParams,
          pendingRequestId: 17,
        })
      ).toBe(false);
    }
  });

  it("W3 fetch 字段按子阶段 gate 判定（effect_preview 打开 effectPreviews，但不打开 landingPlans）", () => {
    expect(
      shouldTriggerPerFieldRetry("effectPreviews", {
        hasJob: true,
        currentSubStage: "effect_preview",
        jobStage: "effect_preview" as BlueprintGenerationJob["stage"],
        skipLazyLoad: false,
        pendingRequestId: null,
      })
    ).toBe(true);
    expect(
      shouldTriggerPerFieldRetry("landingPlans", {
        hasJob: true,
        currentSubStage: "effect_preview",
        jobStage: "effect_preview" as BlueprintGenerationJob["stage"],
        skipLazyLoad: false,
        pendingRequestId: null,
      })
    ).toBe(false);
  });

  it("W4 fetch 字段在 artifact_memory 子阶段或 engineering_landing stage 下允许 retry", () => {
    for (const field of WAVE_4_FETCH_FIELDS) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: "artifact_memory",
          jobStage: "engineering_landing" as BlueprintGenerationJob["stage"],
          skipLazyLoad: false,
          pendingRequestId: null,
        })
      ).toBe(true);
    }
  });

  it("skipLazyLoad=true 时即使子阶段/stage 不到阈值也允许 retry W2-W4 fetch 字段", () => {
    const allFetchFields = [
      ...WAVE_2_FETCH_FIELDS,
      ...WAVE_3_FETCH_FIELDS,
      ...WAVE_4_FETCH_FIELDS,
    ] as const;
    for (const field of allFetchFields) {
      expect(
        shouldTriggerPerFieldRetry(field, {
          hasJob: true,
          currentSubStage: undefined,
          jobStage: "input" as BlueprintGenerationJob["stage"],
          skipLazyLoad: true,
          pendingRequestId: null,
        })
      ).toBe(true);
    }
  });
});
