/**
 * Autopilot 驾驶舱右栏数据层 Hook — fast-check 属性测试
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-data-hook/`
 * - Requirement 10.1 — P1 Idempotent fetch dedupe
 * - Requirement 10.2 — P2 Cache coherence on jobId change
 * - Requirement 10.3 — P3 Race safety on rapid job.stage updates
 * - Requirement 10.5 — `numRuns` 50-100 + 最小化 shrink 输出
 * - Requirement 10.6 — 不依赖真实网络 / 真实 SSE
 * - Requirement 10.7 — 本文件位置固定
 *
 * 实现口径（Task 11 方案 D — 纯 reducer + state-machine level PBT）:
 *
 *   本 repo 尚未集成 `@testing-library/react`、`jsdom` 或 `happy-dom`；`useEffect` 只在
 *   具备 DOM runtime 的测试环境下执行，而当前测试都走 `renderToStaticMarkup` SSR 路径。
 *   因此若直接在 hook 实例化层断言 dedupe / cache coherence / race safety，需要引入新的
 *   test environment 依赖，超出本 spec `Requirement 12.7` 对改动文件集合的限定。
 *
 *   改用「pure reducer + state-machine」PBT：fast-check 生成随机 requestId / jobId / stage
 *   序列，通过 `rightRailDataReducer` 推演状态机，断言 `Ignore_Stale_Policy` 两道护栏在
 *   各种乱序 / late-resolve / 切回历史 jobId 场景下都能保证「最新请求 win」「切换 jobId
 *   不泄漏」「切回历史 jobId 从 cache 复用」三条不变量。
 *
 *   DOM runtime 行为（例如真实 `useEffect` 执行、`EventSource` 订阅、`AbortController.abort`
 *   调用计数）目前由现有 SSR snapshot 测试（`AutopilotRoutePage.test.tsx` /
 *   `BlueprintProgressPanel.test.tsx`）与 Wave 1-4 的单元测试间接覆盖；未来 Phase B 引入
 *   `@testing-library/react` 后，本文件可以升级为真实 DOM-level PBT。
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import {
  __testing__,
  type UseAutopilotRightRailDataOptions,
} from "../use-autopilot-right-rail-data";

const { rightRailDataReducer, buildInitialReducerState, WAVE_1_FIELDS } =
  __testing__;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(
  id: string,
  stage: BlueprintGenerationJob["stage"] = "input"
): BlueprintGenerationJob {
  return {
    id,
    request: {
      userInput: "",
      sources: [],
    } as unknown as BlueprintGenerationJob["request"],
    status: "running",
    stage,
    version: "1",
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    artifacts: [],
    events: [],
  } as unknown as BlueprintGenerationJob;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * 非空 jobId：过滤掉纯空白字符串，确保与 hook 「`jobId === ""` 零 fetch」的契约一致。
 */
const arbJobId = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((value) => value.trim().length > 0);

/**
 * 从 `{ "a", "b", "c", "d" }` 中取值构造 jobId 序列，便于 P2 生成含重复元素的切换序列。
 */
const arbJobIdShort = fc.constantFrom("a", "b", "c", "d");

/**
 * 覆盖 resolver switch 中的 11 个 job.stage 取值（对齐 `BlueprintGenerationStage` 联合）。
 */
const arbJobStage: fc.Arbitrary<BlueprintGenerationJob["stage"]> =
  fc.constantFrom(
    "input",
    "clarification",
    "route_generation",
    "spec_tree",
    "spec_docs",
    "preview",
    "effect_preview",
    "prompt_packaging",
    "runtime_capability",
    "engineering_handoff",
    "engineering_landing"
  );

// ---------------------------------------------------------------------------
// P1 — Idempotent fetch dedupe（reducer 层）
//
// 语义：N 个并发 consumer 对同一 jobId 发起多次 FETCH_STARTED，每次 dispatch 使用不同的
// requestId；reducer 必须保证：
//   1. `pendingRequestId` 始终指向最后一次 dispatch 的 id；
//   2. 当这 N 个请求按任意乱序顺序 resolve（FETCH_FULFILLED）时,只有 pendingRequestId
//      匹配的那次 resolve 能真正写入 data（Ignore_Stale_Policy 第二道护栏）。
//
// 在 DOM runtime 场景下，hook 的 `useEffect(..., [jobId])` 在单次 render cycle 内只会发起
// 一次 fetch（通过 abort + 新 controller 模式），N+1 dedupe 本质上依赖这条 reducer 护栏。
// ---------------------------------------------------------------------------

describe("Spec 4 PBT · P1 Idempotent fetch dedupe (reducer-level)", () => {
  it("只有最新 requestId 对应的 FETCH_FULFILLED 才能写入 data", () => {
    fc.assert(
      fc.property(
        arbJobId,
        // 同一 jobId 下 N 个并发 in-flight request 的 id 序列：2-5 个不重复 id。
        fc
          .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
            minLength: 2,
            maxLength: 5,
          })
          .filter((ids) => ids.length >= 2),
        (jobId, requestIds) => {
          let state = buildInitialReducerState(jobId, undefined, null);

          // 依次 dispatch N 次 FETCH_STARTED，模拟 N 个并发 consumer 对同一字段的 re-fire。
          for (const requestId of requestIds) {
            state = rightRailDataReducer(state, {
              type: "FETCH_STARTED",
              jobId,
              fields: WAVE_1_FIELDS,
              requestId,
            });
          }
          const latestId = requestIds[requestIds.length - 1];
          expect(state.job.pendingRequestId).toBe(latestId);

          // 乱序 resolve：把 ids shuffle 后顺序 dispatch FETCH_FULFILLED。
          const shuffled = [...requestIds].reverse();
          for (const requestId of shuffled) {
            state = rightRailDataReducer(state, {
              type: "FETCH_FULFILLED",
              jobId,
              requestId,
              fieldUpdates: {
                job: makeJob(`job-req-${requestId}`),
              },
            });
          }

          // 最终 data 必须对应 latestId 的 update，其它早期 in-flight 的 resolve 被 ignore。
          expect(state.job.data).not.toBeNull();
          expect(state.job.data?.id).toBe(`job-req-${latestId}`);
          expect(state.job.pendingRequestId).toBeNull();
          expect(state.job.loading).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — Cache coherence on jobId change
//
// 语义：切换 `jobId` 时 reducer 必须：
//   1. `JOB_CHANGED` 后 `currentJobId` 立即指向新 id；
//   2. 所有字段 data 被重置为 `initialData?.[field] ?? cachedFields?.[field] ?? null`；
//   3. 在 `[a, b, a]` 场景下切回 `a` 时，cacheRef 提供的 cachedFields 优先级高于 initialData，
//      reducer 直接从 cachedFields seed 已缓存字段（本测试模拟 hook 侧 cacheRef.get(jobId)
//      返回值，断言 reducer 能正确消费）。
//
// 说明：hook 真实实现中 cacheRef 挂在 `useRef<Map>`，切换 jobId 时写入上一个 jobId 的字段
// snapshot 到 Map，切回时读取并传给 `JOB_CHANGED.cachedFields`。本测试手工模拟这一 Map 行为
// 推演 reducer。
// ---------------------------------------------------------------------------

describe("Spec 4 PBT · P2 Cache coherence on jobId change", () => {
  it("切换后所有字段重置；切回历史 jobId 时 cachedFields 优先于 initialData", () => {
    fc.assert(
      fc.property(
        fc.array(arbJobIdShort, { minLength: 4, maxLength: 8 }),
        (jobIdSeq) => {
          // 构造一个可复用的 Map，模拟 hook 的 `useRef<Map<jobId, CacheEntry>>`
          const cache = new Map<
            string,
            Partial<Record<"job", BlueprintGenerationJob>>
          >();
          let state = buildInitialReducerState(jobIdSeq[0], undefined, null);
          // seed 首个 job 以便后续比较。
          state = rightRailDataReducer(state, {
            type: "FETCH_STARTED",
            jobId: jobIdSeq[0],
            fields: WAVE_1_FIELDS,
            requestId: 1,
          });
          state = rightRailDataReducer(state, {
            type: "FETCH_FULFILLED",
            jobId: jobIdSeq[0],
            requestId: 1,
            fieldUpdates: {
              job: makeJob(`job-${jobIdSeq[0]}`),
            },
          });
          cache.set(jobIdSeq[0], { job: state.job.data ?? undefined });

          for (let i = 1; i < jobIdSeq.length; i += 1) {
            const previousJobId = jobIdSeq[i - 1];
            const nextJobId = jobIdSeq[i];
            if (previousJobId === nextJobId) {
              // 同一 jobId 相邻重复（fast-check 可能生成 [a, a, ...]）视作 no-op。
              continue;
            }

            // 切换到新 jobId：把当前 state 的字段快照写回 cache。
            cache.set(previousJobId, { job: state.job.data ?? undefined });

            const cachedFields = cache.get(nextJobId)
              ? {
                  job: cache.get(nextJobId)?.job ?? null,
                }
              : null;

            state = rightRailDataReducer(state, {
              type: "JOB_CHANGED",
              jobId: nextJobId,
              initialData: undefined,
              cachedFields,
            });

            // 不变量 1：currentJobId 立即切换。
            expect(state.currentJobId).toBe(nextJobId);
            // 不变量 2：切到未见过的 jobId 时 data 必为 null（无 cache 也无 initial）。
            if (!cachedFields) {
              expect(state.job.data).toBeNull();
            } else {
              // 不变量 3：切回历史 jobId 时 cache 复用。
              expect(state.job.data?.id).toBe(`job-${nextJobId}`);
            }

            // 为新 jobId 发起一次新 fetch 写回数据，保持 cache 与 state 同步。
            state = rightRailDataReducer(state, {
              type: "FETCH_STARTED",
              jobId: nextJobId,
              fields: WAVE_1_FIELDS,
              requestId: i + 1,
            });
            state = rightRailDataReducer(state, {
              type: "FETCH_FULFILLED",
              jobId: nextJobId,
              requestId: i + 1,
              fieldUpdates: {
                job: makeJob(`job-${nextJobId}`),
              },
            });
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// P3 — Race safety on rapid job.stage updates
//
// 语义：当 SSE 在极短时间内连续推送 N 个 stage 转换事件，hook 会对新 stage 对应的下游字段
// 触发 targeted refetch；各 fetch 的 resolve 顺序不固定（网络延迟不同）。reducer 的
// Ignore_Stale_Policy 必须保证：
//   - 对同一字段，同一 jobId 下多次 FETCH_STARTED → 多次 FETCH_FULFILLED 乱序到达时，只有
//     pendingRequestId（最新那次）对应的 resolve 能写入 data；
//   - 早期 stage 的 in-flight 请求 late resolve 时被丢弃，不覆盖 latest stage 的结果。
//
// 这条性质直接支撑 Requirement 4.5：「快速连续 stage 推进时最后一次 stage 对应的 refetch
// 结果 win」。
// ---------------------------------------------------------------------------

describe("Spec 4 PBT · P3 Race safety on rapid job.stage updates", () => {
  it("快速连续 FETCH_STARTED + 乱序 FETCH_FULFILLED 只有最新 pendingRequestId win", () => {
    fc.assert(
      fc.property(
        arbJobId,
        fc.array(arbJobStage, { minLength: 2, maxLength: 5 }),
        (jobId, stageSeq) => {
          let state = buildInitialReducerState(jobId, undefined, null);
          // 为每个 stage 分配唯一 requestId，模拟 hook 每次 stage 推进后触发 refetch 拿到
          // 一个递增的 requestId。
          const requests = stageSeq.map((stage, index) => ({
            requestId: index + 1,
            stage,
          }));

          // 先连续 dispatch 全部 FETCH_STARTED（模拟 SSE 在极短时间内推出 N 个 stage 事件，
          // hook 在同一 microtask batch 中依次发起 fetch）。
          for (const { requestId } of requests) {
            state = rightRailDataReducer(state, {
              type: "FETCH_STARTED",
              jobId,
              fields: WAVE_1_FIELDS,
              requestId,
            });
          }
          const latestRequestId = requests[requests.length - 1].requestId;
          const latestStage = requests[requests.length - 1].stage;
          expect(state.job.pendingRequestId).toBe(latestRequestId);

          // 乱序 dispatch FETCH_FULFILLED（模拟各 stage 对应 fetch 的 resolve 顺序与触发顺序
          // 无关：用一个固定 reversal + 旋转混合打乱）。
          const shuffled = [
            ...requests.slice(1),
            requests[0],
          ].reverse();
          for (const { requestId, stage } of shuffled) {
            state = rightRailDataReducer(state, {
              type: "FETCH_FULFILLED",
              jobId,
              requestId,
              fieldUpdates: {
                job: makeJob(`${jobId}-req-${requestId}`, stage),
              },
            });
          }

          // 不变量：最终 data 对应 latestRequestId（即最后一次 stage 推进触发的 refetch），
          // 所有早期 in-flight 的 late resolve 被 Ignore_Stale_Policy 丢弃。
          expect(state.job.data?.id).toBe(`${jobId}-req-${latestRequestId}`);
          expect(state.job.data?.stage).toBe(latestStage);
          expect(state.job.pendingRequestId).toBeNull();
          expect(state.job.loading).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("跨 jobId 的 late resolve 同样被忽略（Ignore_Stale_Policy 第一道护栏）", () => {
    fc.assert(
      fc.property(
        arbJobIdShort,
        arbJobIdShort.filter((id) => id !== "a"),
        (firstJobId, secondJobId) => {
          fc.pre(firstJobId !== secondJobId);
          let state = buildInitialReducerState(firstJobId, undefined, null);

          // 为 firstJobId 发起 fetch，然后切换到 secondJobId。
          state = rightRailDataReducer(state, {
            type: "FETCH_STARTED",
            jobId: firstJobId,
            fields: WAVE_1_FIELDS,
            requestId: 1,
          });
          state = rightRailDataReducer(state, {
            type: "JOB_CHANGED",
            jobId: secondJobId,
            initialData: undefined,
            cachedFields: null,
          });

          // firstJobId 的 fetch 这时 late resolve。reducer 必须忽略这一 update。
          state = rightRailDataReducer(state, {
            type: "FETCH_FULFILLED",
            jobId: firstJobId,
            requestId: 1,
            fieldUpdates: {
              job: makeJob(`job-stale-${firstJobId}`),
            },
          });

          expect(state.currentJobId).toBe(secondJobId);
          expect(state.job.data).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Type-level sanity: Options type 必须暴露 `initialData` 的可选字段
// ---------------------------------------------------------------------------

describe("UseAutopilotRightRailDataOptions type surface (sanity)", () => {
  it("接受 Partial<initialData> 子集", () => {
    const options: UseAutopilotRightRailDataOptions = {
      initialData: { job: makeJob("job-1") },
    };
    expect(options.initialData?.job?.id).toBe("job-1");
  });
});
