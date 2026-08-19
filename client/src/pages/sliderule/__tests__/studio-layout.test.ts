import { describe, expect, it } from "vitest";
import {
  canCollapsePart,
  isStageMaximized,
  isStagePageShown,
  isStudioChromeShown,
  maximizeIntent,
  nextStagePageHidden,
} from "../studio-layout";

describe("studio-layout（VS Code 分栏对照）", () => {
  it("两侧不能同时折没：折一个时另一个不许再折", () => {
    expect(
      canCollapsePart("chat", { chat: false, stage: false })
    ).toBe(true);
    expect(
      canCollapsePart("stage", { chat: false, stage: false })
    ).toBe(true);
    expect(
      canCollapsePart("chat", { chat: false, stage: true })
    ).toBe(false);
    expect(
      canCollapsePart("stage", { chat: true, stage: false })
    ).toBe(false);
  });

  it("最大化 = 只留舞台；舞台已经没了则不能最大化", () => {
    expect(isStageMaximized({ chat: true, stage: false })).toBe(true);
    expect(isStageMaximized({ chat: false, stage: false })).toBe(false);
    expect(isStageMaximized({ chat: false, stage: true })).toBe(false);
    expect(maximizeIntent({ chat: false, stage: false })).toBe("maximize");
    expect(maximizeIntent({ chat: true, stage: false })).toBe("restore");
    expect(maximizeIntent({ chat: false, stage: true })).toBe("noop");
  });

  it("预览页是显隐：藏起来整块不渲染，不是把宽度收成 0", () => {
    expect(nextStagePageHidden(false)).toBe(true);
    expect(nextStagePageHidden(true)).toBe(false);
    expect(isStagePageShown(true, false)).toBe(true);
    expect(isStagePageShown(true, true)).toBe(false);
    expect(isStagePageShown(false, false)).toBe(false);
    expect(isStagePageShown(false, true)).toBe(false);
    expect(isStudioChromeShown(true)).toBe(false);
    expect(isStudioChromeShown(false)).toBe(true);
  });
});
