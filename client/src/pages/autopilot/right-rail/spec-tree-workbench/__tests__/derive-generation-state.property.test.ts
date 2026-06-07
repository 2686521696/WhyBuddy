/**
 * Property-based tests for `deriveGenerationState`
 * (spec-generation-perceived-performance, Tasks 1.2 - 1.8).
 *
 * Each `it` block implements exactly one numbered correctness property from
 * design.md ("Correctness Properties"). Generators cover the full input space:
 *   - scope ∈ {"all","single"}
 *   - inFlight ∈ {"all","single", null}
 *   - error ∈ {null, {message?, detail?}}
 *   - optimistic ∈ {null, {scope, startedAt}}
 *   - boolean authoritative projection fields
 *   - now / startedAt integers crossing both sides of the timeoutMs boundary
 *
 * Every property runs with fast-check `numRuns >= 100`.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  deriveGenerationState,
  DEFAULT_GENERATION_TIMEOUT_MS,
  type DeriveGenerationStateInput,
  type GenerationScope,
} from "../derive-generation-state";

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const scopeArb: fc.Arbitrary<GenerationScope> = fc.constantFrom("all", "single");

const inFlightArb: fc.Arbitrary<GenerationScope | null> = fc.constantFrom(
  "all",
  "single",
  null,
);

const optionalString = fc.option(fc.string(), { nil: undefined });

const errorArb: fc.Arbitrary<{ message?: string; detail?: string } | null> =
  fc.oneof(
    fc.constant<{ message?: string; detail?: string } | null>(null),
    fc.record({ message: optionalString, detail: optionalString }),
  );

/**
 * Full input arbitrary with deliberate boundary coverage around `timeoutMs`.
 *
 * `now` is derived as `startedAt + elapsed`, where `elapsed` is drawn from
 * ranges and exact constants that straddle the timeout threshold so both
 * `elapsed < timeoutMs` and `elapsed >= timeoutMs` are exercised, including
 * the exact boundary (`timeoutMs - 1`, `timeoutMs`, `timeoutMs + 1`).
 */
const inputArb: fc.Arbitrary<DeriveGenerationStateInput> = fc
  .record({
    timeoutMs: fc.integer({ min: 1, max: 120_000 }),
    inFlight: inFlightArb,
    error: errorArb,
    authoritativeHasDocs: fc.boolean(),
    authoritativeSpecTreeReady: fc.boolean(),
    authoritativeSettled: fc.boolean(),
    startedAt: fc.integer({ min: 0, max: 1_000_000 }),
    hasOptimistic: fc.boolean(),
    optimisticScope: scopeArb,
  })
  .chain((base) =>
    fc
      .oneof(
        fc.integer({ min: -2_000, max: base.timeoutMs - 1 }),
        fc.integer({ min: base.timeoutMs, max: base.timeoutMs + 100_000 }),
        fc.constantFrom(
          base.timeoutMs - 1,
          base.timeoutMs,
          base.timeoutMs + 1,
        ),
      )
      .map((elapsed) => {
        const optimistic = base.hasOptimistic
          ? { scope: base.optimisticScope, startedAt: base.startedAt }
          : null;
        return {
          inFlight: base.inFlight,
          error: base.error,
          optimistic,
          authoritativeHasDocs: base.authoritativeHasDocs,
          authoritativeSpecTreeReady: base.authoritativeSpecTreeReady,
          authoritativeSettled: base.authoritativeSettled,
          now: base.startedAt + elapsed,
          timeoutMs: base.timeoutMs,
        } satisfies DeriveGenerationStateInput;
      }),
  );

// ---------------------------------------------------------------------------
// Predicate helpers (mirror the function's documented bracket semantics)
// ---------------------------------------------------------------------------

function timeoutOf(input: DeriveGenerationStateInput): number {
  return input.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
}

function hasUntimedOptimistic(input: DeriveGenerationStateInput): boolean {
  return (
    input.optimistic !== null &&
    input.now - input.optimistic.startedAt < timeoutOf(input)
  );
}

function hasTimedOutOptimistic(input: DeriveGenerationStateInput): boolean {
  return (
    input.optimistic !== null &&
    input.now - input.optimistic.startedAt >= timeoutOf(input)
  );
}

// ---------------------------------------------------------------------------

describe("deriveGenerationState — correctness properties", () => {
  // Feature: spec-generation-perceived-performance, Property 1: 乐观反馈同步置入即 pending — 对任意 deriveGenerationState 输入，只要存在未超时的乐观标记（optimistic !== null 且 now - optimistic.startedAt < timeoutMs）且无 error，派生 phase 恒为 pending，与权威投影字段、并发锁是否传播无关。
  // Validates: Requirements 1.1, 4.1
  it("Property 1: un-timed-out optimistic mark with no error always yields pending", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        fc.pre(input.error === null && hasUntimedOptimistic(input));
        const result = deriveGenerationState(input);
        expect(result.phase).toBe("pending");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 2: in-flight 期间恒 pending（反闪烁核心）— 对任意权威投影字段组合，当存在未超时的乐观标记或 inFlight !== null 且无 error 时，派生 phase 恒为 pending，绝不为 idle 或 empty。
  // Validates: Requirements 4.2, 4.4
  it("Property 2: in-flight bracket with no error never flickers to idle/empty (and is pending while not timed out)", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        fc.pre(
          input.error === null &&
            (hasUntimedOptimistic(input) || input.inFlight !== null),
        );
        const result = deriveGenerationState(input);
        // Anti-flicker core: never silently fall back to idle or empty.
        expect(result.phase).not.toBe("idle");
        expect(result.phase).not.toBe("empty");
        // While not timed out, the in-flight bracket is strictly pending.
        if (!hasTimedOutOptimistic(input)) {
          expect(result.phase).toBe("pending");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 3: error 优先级 → 恒 failure — 对任意输入，只要 error !== null，派生 phase 恒为 failure，与乐观标记、并发锁、权威投影字段均无关。
  // Validates: Requirements 2.3, 2.5, 4.6, 5.6
  it("Property 3: error present always yields failure regardless of other fields", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        fc.pre(input.error !== null);
        const result = deriveGenerationState(input);
        expect(result.phase).toBe("failure");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 4: settled 决定终态、绝不 idle — 对任意输入，当 authoritativeSettled === true 时，派生 phase 必属于 {pending, success, failure, empty} 而绝不为 idle；进一步地，当此时不存在 in-flight / 未超时乐观标记且无 error 时，phase 由 authoritativeHasDocs 唯一决定（true → success，false → empty）。
  // Validates: Requirements 2.1, 2.2, 2.8, 4.3, 5.4
  it("Property 4: settled never yields idle and uniquely determines the terminal phase", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        fc.pre(input.authoritativeSettled === true);
        const result = deriveGenerationState(input);
        expect(result.phase).not.toBe("idle");
        expect(["pending", "success", "failure", "empty"]).toContain(
          result.phase,
        );
        // No in-flight, no optimistic at all, no error → terminal decided by docs.
        if (
          input.error === null &&
          input.optimistic === null &&
          input.inFlight === null
        ) {
          expect(result.phase).toBe(
            input.authoritativeHasDocs ? "success" : "empty",
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 5: 超时边界 → failure（timedOut）— 对任意乐观标记与时间戳，当 optimistic !== null 且 now - optimistic.startedAt >= timeoutMs 时，派生 phase 为 failure 且 timedOut === true；当 now - optimistic.startedAt < timeoutMs 时不因超时落入 failure。
  // Validates: Requirements 4.5, 5.5
  it("Property 5: timeout boundary drives failure with timedOut, below boundary does not", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        fc.pre(input.optimistic !== null && input.error === null);
        const elapsed = input.now - input.optimistic!.startedAt;
        const result = deriveGenerationState(input);
        if (elapsed >= timeoutOf(input)) {
          expect(result.phase).toBe("failure");
          expect(result.timedOut).toBe(true);
        } else {
          // Below threshold: must not fall into failure due to timeout.
          expect(result.timedOut).toBe(false);
          expect(result.phase).not.toBe("failure");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 6: pending 与终态互斥 — 对任意输入，派生 phase === "pending" 当且仅当处于 in-flight / 未超时乐观档（且无 error）；因此进行中信号在任一终态（success / failure / empty）下必然关闭，不存在 pending 与终态并存的派生结果。
  // Validates: Requirements 2.9
  it("Property 6: phase is pending iff in the active (non-timed-out) in-flight bracket", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = deriveGenerationState(input);
        const inActiveBracket =
          input.error === null &&
          (input.optimistic !== null || input.inFlight !== null) &&
          !hasTimedOutOptimistic(input);
        expect(result.phase === "pending").toBe(inActiveBracket);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: spec-generation-perceived-performance, Property 7: failure → retry → 同范围 pending — 对任意处于 failure(scope = s) 的状态，触发重试（清除 error 并以范围 s 置入乐观标记）后，下一次派生为 pending 且 scope === s。
  // Validates: Requirements 2.7
  it("Property 7: retrying a failure(scope=s) yields pending with the same scope", () => {
    fc.assert(
      fc.property(
        scopeArb,
        inFlightArb,
        fc.integer({ min: 1, max: 120_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (s, inFlight, timeoutMs, startedAt, hasDocs, treeReady, settled) => {
          // A failure(scope = s) state: error present, optimistic scope pins scope = s.
          const failureInput: DeriveGenerationStateInput = {
            inFlight,
            error: { message: "boom" },
            optimistic: { scope: s, startedAt },
            authoritativeHasDocs: hasDocs,
            authoritativeSpecTreeReady: treeReady,
            authoritativeSettled: settled,
            now: startedAt + 1,
            timeoutMs,
          };
          const failed = deriveGenerationState(failureInput);
          expect(failed.phase).toBe("failure");
          expect(failed.scope).toBe(s);

          // Retry: clear error, set a fresh (un-timed-out) optimistic mark with scope s.
          const retryStartedAt = startedAt + 5;
          const retryInput: DeriveGenerationStateInput = {
            ...failureInput,
            error: null,
            optimistic: { scope: s, startedAt: retryStartedAt },
            now: retryStartedAt, // elapsed 0 < timeoutMs → not timed out
          };
          const retried = deriveGenerationState(retryInput);
          expect(retried.phase).toBe("pending");
          expect(retried.scope).toBe(s);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
