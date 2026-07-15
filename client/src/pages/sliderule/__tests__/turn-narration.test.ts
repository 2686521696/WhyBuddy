/**
 * E13 直播时间线持久化：打戳/回放纯函数 + derive-persisted-turn 集成。
 * 回归目标：刷新后时间线从「1 阶段 0 步」恢复为完整回放。
 */
import { describe, it, expect } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { stampTurnNarration, narrationStepsFor } from "../turn-narration";
import { deriveLatestTurnFromState } from "../derive-persisted-turn";
import type { TurnStep } from "../types";

const step = (id: string, text: string): TurnStep => ({
  id,
  kind: "narration",
  text,
  source: "llm",
});

const baseState = (extra: Partial<V5SessionState> = {}): V5SessionState =>
  ({
    sessionId: "s1",
    goal: { text: "宠物医院", status: "clear" },
    ...extra,
  }) as V5SessionState;

describe("stampTurnNarration", () => {
  it("打戳合并：同轮覆盖、只留最近 3 轮", () => {
    let state = baseState();
    for (const t of ["t1", "t2", "t3", "t4"]) {
      state = stampTurnNarration(state, {
        turnId: t,
        user: `问题 ${t}`,
        steps: [step(`${t}-s1`, `叙述 ${t}`)],
      });
    }
    expect(state.turnNarrations?.map(n => n.turnId)).toEqual(["t2", "t3", "t4"]);
    // 同轮重打覆盖而非追加
    state = stampTurnNarration(state, {
      turnId: "t4",
      steps: [step("t4-s1", "新叙述"), step("t4-s2", "第二步")],
    });
    const t4 = state.turnNarrations?.find(n => n.turnId === "t4");
    expect(t4?.steps).toHaveLength(2);
    expect(state.turnNarrations).toHaveLength(3);
  });

  it("空步骤不打戳；超长文本截断", () => {
    const untouched = baseState();
    expect(stampTurnNarration(untouched, { turnId: "t", steps: [] })).toBe(untouched);
    const stamped = stampTurnNarration(untouched, {
      turnId: "t",
      steps: [step("s", "长".repeat(5000))],
    });
    const text = (stamped.turnNarrations?.[0].steps[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(1201);
  });
});

describe("narrationStepsFor", () => {
  it("按 turnId 精确取；缺省取最新一轮；未知 kind 的脏数据被丢弃", () => {
    const state = baseState({
      turnNarrations: [
        { turnId: "t1", user: "u1", steps: [step("a", "第一轮")] },
        {
          turnId: "t2",
          user: "u2",
          steps: [
            step("b", "第二轮"),
            { id: "evil", kind: "hax", text: "注入" },
            "garbage",
            { kind: "narration", text: "缺 id" },
          ] as unknown[],
        },
      ],
    } as Partial<V5SessionState>);
    expect(narrationStepsFor(state, "t1")?.steps).toHaveLength(1);
    const latest = narrationStepsFor(state, null);
    expect(latest?.turnId).toBe("t2");
    expect(latest?.steps).toHaveLength(1); // 只有合法 narration 步幸存
    expect(narrationStepsFor(null)).toBeNull();
    expect(narrationStepsFor(baseState())).toBeNull();
  });
});

describe("deriveLatestTurnFromState + turnNarrations（刷新回放集成）", () => {
  const stateWithRun = (narr?: V5SessionState["turnNarrations"]) =>
    baseState({
      lastTurnId: "turn-99",
      capabilityRuns: [
        { capabilityId: "risk.analysis", roleId: "架构", turnId: "turn-99" },
      ] as never,
      turnNarrations: narr,
    } as Partial<V5SessionState>);

  it("有叙述：steps 完整回放 + user 恢复（不再是 0 步骨架）", () => {
    const turn = deriveLatestTurnFromState(
      stateWithRun([
        {
          turnId: "turn-99",
          user: "社区宠物医院预约问诊系统",
          steps: [step("s1", "第 1 轮 · 正在分析风险"), step("s2", "正在起草五系统模型")],
        },
      ])
    );
    expect(turn?.steps).toHaveLength(2);
    expect(turn?.user).toContain("宠物医院");
  });

  it("旧会话无叙述：回落骨架轮次（steps 空，不崩）", () => {
    const turn = deriveLatestTurnFromState(stateWithRun(undefined));
    expect(turn).not.toBeNull();
    expect(turn?.steps).toHaveLength(0);
  });
});
