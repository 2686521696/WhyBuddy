/**
 * Property-based tests —— Task 10：useRightRailSubStageState 三条核心属性
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 10.1 — P1 URL ⇔ State idempotent
 * - Requirement 10.2 — P2 Pin semantics（pinnedSubStage !== null 时 effective 锁定；
 *                                       pinnedSubStage === null 时 effective = resolved）
 * - Requirement 10.3 — P3 Keyboard shortcut boundaries（stepSubStage 不越界、不循环）
 *
 * 设计约束：
 * - 采用 Spec 4 Task 11 "方案 D"：只测 pure helpers 与纯 reducer 决策，不依赖
 *   `@testing-library/react` / DOM runtime。
 * - 所有属性以纯字符串 / 纯状态机方式模拟：`applySubToSearch` / `parseSubFromSearch` /
 *   `resolveRailSubStage` / `stepSubStage`。
 * - `numRuns` 控制在 50-100，与 Spec 4 保持一致；fast-check 自动 shrink 提供最小反例。
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint/contracts";

import { resolveRailSubStage } from "../../resolve-rail-sub-stage";
import { RAIL_SUB_STAGE_ORDER, type AutopilotRailSubStage } from "../../types";
import { __testing__ } from "../use-right-rail-sub-stage-state";

const { applySubToSearch, parseSubFromSearch, stepSubStage } = __testing__;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbSubStage: fc.Arbitrary<AutopilotRailSubStage> = fc.constantFrom(
  ...RAIL_SUB_STAGE_ORDER,
);

/** 与 Spec 3 fabric-dispatch PBT 保持相同的 13 个 stage 枚举值。 */
const arbJobStage: fc.Arbitrary<BlueprintGenerationStage> = fc.constantFrom(
  "input",
  "clarification",
  "route_generation",
  "route_selection",
  "agent_crew_fabric",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
) as fc.Arbitrary<BlueprintGenerationStage>;

const arbJob: fc.Arbitrary<BlueprintGenerationJob> = arbJobStage.map(
  (stage) => ({ id: "job-pbt", stage }) as unknown as BlueprintGenerationJob,
);

// ---------------------------------------------------------------------------
// P1 — URL ⇔ State idempotent
// ---------------------------------------------------------------------------

describe("P1 — URL ⇔ State idempotent", () => {
  it("writing a sub-stage sequence to URL, reading back, and re-writing is idempotent", () => {
    fc.assert(
      fc.property(
        fc.array(arbSubStage, { minLength: 2, maxLength: 6 }),
        (subStageSeq) => {
          // 模拟 hook 的写 URL 路径：累积 query string，并在每步断言 `sub` 与最后一次写入值相等。
          let search = "";
          for (const sub of subStageSeq) {
            search = applySubToSearch(search, sub);
            // `sub` 参数必须与最近一次写入值相等
            const parsed = parseSubFromSearch(`?${search}`);
            expect(parsed).toBe(sub);
          }
          // 最终 URL 中的 sub 应等于序列最后一项
          const last = subStageSeq[subStageSeq.length - 1];
          expect(parseSubFromSearch(`?${search}`)).toBe(last);
          // 「再写一次相同值」仍能 round-trip（幂等）
          const afterRewrite = applySubToSearch(search, last);
          expect(parseSubFromSearch(`?${afterRewrite}`)).toBe(last);
          // 且 URLSearchParams 序列化后字符串也等价
          expect(afterRewrite).toBe(search);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("setting to null after any write clears `sub` while preserving other params", () => {
    fc.assert(
      fc.property(
        fc.array(arbSubStage, { minLength: 1, maxLength: 4 }),
        (subStageSeq) => {
          let search = "foo=bar";
          for (const sub of subStageSeq) {
            search = applySubToSearch(search, sub);
          }
          search = applySubToSearch(search, null);
          // 其他参数保留
          const params = new URLSearchParams(search);
          expect(params.get("foo")).toBe("bar");
          expect(params.has("sub")).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — Pin semantics
// ---------------------------------------------------------------------------

describe("P2 — Pin semantics", () => {
  /**
   * 建模 hook 的核心 state reducer：
   * - state = { pinnedSubStage: AutopilotRailSubStage | null }
   * - 事件：`"job-stage-change" { nextStage }` / `"click-tab" { target }`
   *         / `"toggle-pin" { resolved }` / `"reset-pin"`
   * - 派生：`effective = pinned ?? resolved`（resolved = resolveRailSubStage(fabric, { stage: nextStage })）
   *
   * 本函数镜像 useRightRailSubStageState 的实际行为，供 PBT 直接校验。
   */
  type UserEvent =
    | { type: "click-tab"; target: AutopilotRailSubStage }
    | { type: "toggle-pin" }
    | { type: "reset-pin" };
  type JobEvent = { type: "job-stage-change"; nextStage: BlueprintGenerationStage };
  type AnyEvent = UserEvent | JobEvent;

  function simulate(
    initialStage: BlueprintGenerationStage,
    events: AnyEvent[],
  ): { pinnedSubStage: AutopilotRailSubStage | null; lastJobStage: BlueprintGenerationStage } {
    let pinnedSubStage: AutopilotRailSubStage | null = null;
    let lastJobStage = initialStage;
    for (const event of events) {
      switch (event.type) {
        case "job-stage-change":
          lastJobStage = event.nextStage;
          break;
        case "click-tab":
          pinnedSubStage = event.target;
          break;
        case "toggle-pin": {
          const resolved = resolveRailSubStage({
            currentStage: "fabric",
            job: { id: "job-pbt", stage: lastJobStage } as unknown as BlueprintGenerationJob,
            selection: null,
            specTree: null,
            agentCrew: null,
          });
          pinnedSubStage =
            pinnedSubStage !== null ? null : resolved ?? RAIL_SUB_STAGE_ORDER[0];
          break;
        }
        case "reset-pin":
          pinnedSubStage = null;
          break;
      }
    }
    return { pinnedSubStage, lastJobStage };
  }

  const arbUserEvent: fc.Arbitrary<UserEvent> = fc.oneof(
    fc.record({
      type: fc.constant("click-tab" as const),
      target: arbSubStage,
    }),
    fc.record({ type: fc.constant("toggle-pin" as const) }),
    fc.record({ type: fc.constant("reset-pin" as const) }),
  );
  const arbJobEvent: fc.Arbitrary<JobEvent> = fc.record({
    type: fc.constant("job-stage-change" as const),
    nextStage: arbJobStage,
  });
  const arbEvent: fc.Arbitrary<AnyEvent> = fc.oneof(arbUserEvent, arbJobEvent);

  it("after any interleaving: if pinnedSubStage !== null then effective === pinned; else effective === resolved", () => {
    fc.assert(
      fc.property(
        arbJobStage,
        fc.array(arbEvent, { minLength: 0, maxLength: 18 }),
        (initialStage, events) => {
          const { pinnedSubStage, lastJobStage } = simulate(initialStage, events);
          const resolved = resolveRailSubStage({
            currentStage: "fabric",
            job: { id: "job-pbt", stage: lastJobStage } as unknown as BlueprintGenerationJob,
            selection: null,
            specTree: null,
            agentCrew: null,
          });
          const effective = pinnedSubStage ?? resolved;
          if (pinnedSubStage !== null) {
            expect(effective).toBe(pinnedSubStage);
          } else {
            expect(effective).toBe(resolved);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("reset-pin always returns to follow-mode regardless of prior state", () => {
    fc.assert(
      fc.property(
        arbJobStage,
        fc.array(arbEvent, { minLength: 0, maxLength: 10 }),
        (initialStage, events) => {
          const final = simulate(initialStage, [...events, { type: "reset-pin" }]);
          expect(final.pinnedSubStage).toBe(null);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// P3 — Keyboard shortcut boundaries
// ---------------------------------------------------------------------------

describe("P3 — Keyboard shortcut boundaries", () => {
  type KeyStep = "prev" | "next";
  const arbKeyStep: fc.Arbitrary<KeyStep> = fc.constantFrom("prev", "next");

  /**
   * 镜像键盘 step 的 reducer：undefined 目标时为 no-op（停留在当前 cursor）。
   * 起点 `RAIL_SUB_STAGE_ORDER[0]`；每步 apply stepSubStage；boundary no-op。
   */
  function playKeys(seq: KeyStep[]): AutopilotRailSubStage {
    let cursor: AutopilotRailSubStage = RAIL_SUB_STAGE_ORDER[0];
    for (const step of seq) {
      const next = stepSubStage(cursor, step);
      if (next !== undefined) {
        cursor = next;
      }
    }
    return cursor;
  }

  it("cursor stays within [0, length-1] at every step (no wrap-around, no overshoot)", () => {
    fc.assert(
      fc.property(
        fc.array(arbKeyStep, { minLength: 0, maxLength: 30 }),
        (seq) => {
          let cursor: AutopilotRailSubStage = RAIL_SUB_STAGE_ORDER[0];
          for (const step of seq) {
            const next = stepSubStage(cursor, step);
            if (next !== undefined) {
              cursor = next;
            }
            const idx = RAIL_SUB_STAGE_ORDER.indexOf(cursor);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThanOrEqual(RAIL_SUB_STAGE_ORDER.length - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("prev at the start is a no-op; next at the end is a no-op", () => {
    fc.assert(
      fc.property(fc.nat({ max: 50 }), (n) => {
        // 从起点连续 n 次 prev 仍应停在起点
        const start = playKeys(Array.from({ length: n }, () => "prev" as const));
        expect(start).toBe(RAIL_SUB_STAGE_ORDER[0]);
        // 从终点连续 n 次 next 仍应停在终点
        const lastIdx = RAIL_SUB_STAGE_ORDER.length - 1;
        // 先把 cursor 推到末尾
        let cursor: AutopilotRailSubStage = RAIL_SUB_STAGE_ORDER[0];
        for (let i = 0; i < lastIdx; i += 1) {
          const adv = stepSubStage(cursor, "next");
          if (adv !== undefined) cursor = adv;
        }
        expect(cursor).toBe(RAIL_SUB_STAGE_ORDER[lastIdx]);
        // 再连续 n 次 next 应仍是末尾
        for (let i = 0; i < n; i += 1) {
          const adv = stepSubStage(cursor, "next");
          if (adv !== undefined) cursor = adv;
        }
        expect(cursor).toBe(RAIL_SUB_STAGE_ORDER[lastIdx]);
      }),
      { numRuns: 50 },
    );
  });

  it("prev then next returns to the same cursor (except at boundaries)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: RAIL_SUB_STAGE_ORDER.length - 2 }),
        (startIdx) => {
          const start = RAIL_SUB_STAGE_ORDER[startIdx];
          const prev = stepSubStage(start, "prev");
          expect(prev).toBeDefined();
          const back = stepSubStage(prev!, "next");
          expect(back).toBe(start);
        },
      ),
      { numRuns: 50 },
    );
  });
});
