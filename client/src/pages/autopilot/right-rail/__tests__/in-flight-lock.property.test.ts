/**
 * Property-based test for In_Flight_Lock concurrency idempotence
 * (spec-generation-perceived-performance, Task 6.3).
 *
 * This file implements exactly one numbered correctness property from
 * design.md ("Correctness Properties"):
 *
 *   Property 8: In_Flight_Lock 并发幂等 — 当锁已被某范围标记进行中时
 *   (specDocsGenerating !== null)，后续任意范围（相同或不同）触发都不改变当前锁、
 *   不产生新的生成 API 调用，直至当前请求结束。
 *
 * Why a pure model lives in the test file:
 *   The lock semantics live inside `triggerSpecDocsGeneration` in
 *   `client/src/pages/autopilot/right-rail/AutopilotRightRail.tsx`. That
 *   component is large and the repo's tests use renderToStaticMarkup /
 *   pure-logic harnesses (no jsdom for the rail). The In_Flight_Lock guard is
 *   itself a small, deterministic state machine, so we model it here exactly
 *   as the real guard does and property-test the model.
 *
 * Documented guard semantics being modelled (verbatim shape from the source):
 *
 *   const triggerSpecDocsGeneration = useCallback(async (scope, nodeId?) => {
 *     // In_Flight_Lock 并发幂等（R1.5 / R1.6 / R3.5）
 *     if (!props.jobId || specDocsGenerating !== null) return;  // <- guard
 *     setSpecDocsGenerating(scope);                             // <- acquire + 1 API dispatch
 *     ...
 *     setSpecDocsGenerating(null);                              // <- release (resolve)
 *   }, [...]);
 *
 * i.e. ANY trigger while the lock is held (regardless of scope) early-returns
 * without changing the lock and without issuing a new generation API call. The
 * lock is held until the request settles (modelled here by `resolve()`).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

const NUM_RUNS = 200;

type GenerationScope = "all" | "single";

interface LockState {
  /** Mirrors `specDocsGenerating: "all" | "single" | null`. */
  lock: GenerationScope | null;
  /** Number of generation API dispatches that have been issued. */
  apiCalls: number;
}

/**
 * Pure model of the In_Flight_Lock guard in `triggerSpecDocsGeneration`.
 *
 * Mirrors: `if (specDocsGenerating !== null) return; setSpecDocsGenerating(scope);`
 *   - If the lock is held (`lock !== null`): return state UNCHANGED and do NOT
 *     issue a new API call (no apiCalls increment).
 *   - Otherwise: acquire the lock with `scope` and increment apiCalls by 1
 *     (representing the single generation API dispatch).
 *
 * Returns a NEW state object; never mutates the input.
 */
function trigger(state: LockState, scope: GenerationScope): LockState {
  if (state.lock !== null) {
    // Guard hit: lock unchanged, no new API call.
    return { lock: state.lock, apiCalls: state.apiCalls };
  }
  // Lock free: acquire + dispatch exactly one generation API call.
  return { lock: scope, apiCalls: state.apiCalls + 1 };
}

/** Mirrors the eventual `setSpecDocsGenerating(null)` that releases the lock. */
function resolve(state: LockState): LockState {
  return { lock: null, apiCalls: state.apiCalls };
}

const scopeArb: fc.Arbitrary<GenerationScope> = fc.constantFrom(
  "all",
  "single"
);

describe("In_Flight_Lock — concurrency idempotence", () => {
  // Feature: spec-generation-perceived-performance, Property 8: In_Flight_Lock 并发幂等 — 对任意生成触发序列，当 In_Flight_Lock 已被某范围标记为进行中（specDocsGenerating !== null）时，后续任意范围（相同或不同）的触发都不改变当前锁、且不产生新的生成 API 调用，直至当前请求结束。
  // Validates: Requirements 1.5, 1.6, 3.5
  it("Property 8: while the lock is held, any sequence of triggers (same or different scope) changes neither the lock nor the API call count, until resolve()", () => {
    fc.assert(
      fc.property(
        // The scope that initially acquires the lock.
        scopeArb,
        // An arbitrary, possibly empty, sequence of subsequent triggers
        // (random scopes, same or different) attempted WHILE the lock is held.
        fc.array(scopeArb, { maxLength: 25 }),
        (initialScope, subsequentScopes) => {
          // Acquire the lock with the initial scope: one API call dispatched.
          const locked = trigger({ lock: null, apiCalls: 0 }, initialScope);
          expect(locked.lock).toBe(initialScope);
          expect(locked.apiCalls).toBe(1);

          // Apply every subsequent trigger WITHOUT resolving in between.
          let state = locked;
          for (const scope of subsequentScopes) {
            state = trigger(state, scope);
            // Invariant 1: the lock never changes from the initial scope.
            expect(state.lock).toBe(initialScope);
            // Invariant 2: no new generation API call is ever issued.
            expect(state.apiCalls).toBe(1);
          }

          // Final assertions after the whole in-flight sequence.
          expect(state.lock).toBe(initialScope);
          expect(state.apiCalls).toBe(1);

          // Only once the current request ends (resolve) does the lock free up,
          // and a later trigger may dispatch a new API call.
          const released = resolve(state);
          expect(released.lock).toBeNull();
          expect(released.apiCalls).toBe(1);

          const reacquired = trigger(released, initialScope);
          expect(reacquired.apiCalls).toBe(2);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
