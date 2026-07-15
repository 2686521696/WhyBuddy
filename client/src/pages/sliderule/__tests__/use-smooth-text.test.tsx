/**
 * E16 平滑缓冲：速率曲线 + 前缀延续判定 + 单帧推进纯函数
 * （仓库约定：不引 jsdom/RTL，泵语义全在纯函数 advanceShown 里测）。
 */
import { describe, it, expect } from "vitest";
import {
  drainStep,
  isPrefixContinuation,
  advanceShown,
} from "../use-smooth-text";

describe("drainStep 速率曲线", () => {
  it("小积压慢放（下限 2）、大积压按比例快放（无封顶）", () => {
    expect(drainStep(0)).toBe(0);
    expect(drainStep(1)).toBe(2);
    expect(drainStep(12)).toBe(2);
    expect(drainStep(120)).toBe(15);
    expect(drainStep(8000)).toBe(1000);
  });

  it("任意积压在 ~90 帧（1.5s）内追平", () => {
    for (const start of [50, 500, 5000, 50000]) {
      let backlog = start;
      let frames = 0;
      while (backlog > 0 && frames < 200) {
        backlog -= drainStep(backlog);
        frames++;
      }
      expect(frames).toBeLessThanOrEqual(90);
    }
  });
});

describe("isPrefixContinuation", () => {
  it("延续为真；重置/回退/换内容为假", () => {
    expect(isPrefixContinuation("abc", "abcdef")).toBe(true);
    expect(isPrefixContinuation("", "abc")).toBe(true);
    expect(isPrefixContinuation("abc", "ab")).toBe(false);
    expect(isPrefixContinuation("abc", "xbcdef")).toBe(false);
  });
});

describe("advanceShown 单帧推进", () => {
  it("突发大块逐帧放出，不一次上屏；最终追平", () => {
    const target = "字".repeat(600);
    let shown = "";
    shown = advanceShown(shown, target);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(600);
    let frames = 1;
    while (shown !== target && frames < 200) {
      shown = advanceShown(shown, target);
      frames++;
    }
    expect(shown).toBe(target);
    expect(frames).toBeLessThanOrEqual(90);
  });

  it("推进过程严格保持前缀关系（不闪烁不跳字）", () => {
    const target = "abcdefghijklmnopqrstuvwxyz".repeat(20);
    let shown = "";
    while (shown !== target) {
      const next = advanceShown(shown, target);
      expect(next.startsWith(shown)).toBe(true);
      expect(next.length).toBeGreaterThan(shown.length);
      shown = next;
    }
  });

  it("换轮重置（非前缀）瞬时对齐，不做删除动画", () => {
    expect(advanceShown("旧话题的输出", "新")).toBe("新");
    expect(advanceShown("abc", "abX")).toBe("abX");
  });

  it("已追平时是恒等（泵可安全停）", () => {
    expect(advanceShown("stable", "stable")).toBe("stable");
  });

  it("追赶期间目标继续增长也收敛", () => {
    let target = "x".repeat(100);
    let shown = "";
    for (let i = 0; i < 50; i++) {
      shown = advanceShown(shown, target);
      if (i % 5 === 0) target += "y".repeat(40); // 模拟持续到达的 delta
    }
    while (shown !== target) shown = advanceShown(shown, target);
    expect(shown).toBe(target);
  });
});
