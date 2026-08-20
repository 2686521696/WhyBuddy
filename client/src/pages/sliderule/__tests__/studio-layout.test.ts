import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canCollapsePart,
  guessStudioSplitWidthPx,
  isPhoneStudioDevice,
  isStageMaximized,
  isStagePageShown,
  isStudioChromeShown,
  maximizeIntent,
  nextStagePageHidden,
  STUDIO_CHAT_FALLBACK_PERCENT,
  STUDIO_CHAT_MAX_PERCENT,
  STUDIO_CHAT_MIN_PERCENT,
  STUDIO_CHAT_SIDEBAR_MULTIPLIER,
  studioChatDefaultPercent,
  studioChatDefaultPx,
  studioPhoneChatDefaultPercent,
  studioPhoneStageDefaultPercent,
  studioPhoneStageDefaultPx,
  studioStageDefaultPercent,
} from "../studio-layout";
import { SHELL_SIDEBAR_WIDTH_PX } from "../shell-sidebar-layout";

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

describe("对话栏默认 = 左侧菜单 ×2", () => {
  it("像素就是侧栏宽的二倍，不是拍的 38%", () => {
    /**
     * ⚠ 2026-08-20 City Walk：用户要默认等于左侧菜单宽度的二倍。
     * 改回 38 或倍数改成 1，这条必须红。
     */
    expect(STUDIO_CHAT_SIDEBAR_MULTIPLIER).toBe(2);
    expect(studioChatDefaultPx()).toBe(SHELL_SIDEBAR_WIDTH_PX * 2);
    expect(studioChatDefaultPx()).toBe(504);
  });

  it("CSS 侧栏宽和 TS 常量是同一个数", () => {
    const css = readFileSync(
      new URL("../../agent-loop/dashboard/dashboard.css", import.meta.url),
      "utf8"
    );
    const block = css.slice(
      css.indexOf(".native-agent-sidebar {"),
      css.indexOf(".native-agent-shell[data-sidebar-collapsed")
    );
    expect(block).toContain(`flex: 0 0 ${SHELL_SIDEBAR_WIDTH_PX}px`);
    expect(block).toContain(`width: ${SHELL_SIDEBAR_WIDTH_PX}px`);
  });

  it("百分比按分栏容器折，量不到就回落，不能越出拖动上下限", () => {
    const split = 1920 - SHELL_SIDEBAR_WIDTH_PX;
    expect(studioChatDefaultPercent(split)).toBeCloseTo((504 / split) * 100);
    expect(studioStageDefaultPercent(split)).toBeCloseTo(
      100 - studioChatDefaultPercent(split)
    );
    expect(studioChatDefaultPercent(0)).toBe(STUDIO_CHAT_FALLBACK_PERCENT);
    expect(studioChatDefaultPercent(-1)).toBe(STUDIO_CHAT_FALLBACK_PERCENT);
    expect(studioChatDefaultPercent(100)).toBe(STUDIO_CHAT_MAX_PERCENT);
    expect(studioChatDefaultPercent(10_000)).toBe(STUDIO_CHAT_MIN_PERCENT);
    expect(guessStudioSplitWidthPx(1920)).toBe(1920 - SHELL_SIDEBAR_WIDTH_PX);
    expect(guessStudioSplitWidthPx(1920, true)).toBe(1920);
  });
});

describe("手机预览列默认 = 左侧菜单 ×2", () => {
  it("跟桌面对话栏同一像素，只是换到舞台列", () => {
    /**
     * ⚠ 2026-08-20：用户要手机视图宽 = 菜单两倍且不可拖。
     * 跟桌面对话栏用同一个 504，对调面板；改回 38/62 或倍数改成 1 必须红。
     */
    const split = 1920 - SHELL_SIDEBAR_WIDTH_PX;
    expect(studioPhoneStageDefaultPx()).toBe(studioChatDefaultPx());
    expect(studioPhoneStageDefaultPx()).toBe(504);
    expect(studioPhoneStageDefaultPercent(split)).toBeCloseTo(
      studioChatDefaultPercent(split)
    );
    expect(studioPhoneChatDefaultPercent(split)).toBeCloseTo(
      studioStageDefaultPercent(split)
    );
    expect(isPhoneStudioDevice("phone")).toBe(true);
    expect(isPhoneStudioDevice("desktop")).toBe(false);
    expect(isPhoneStudioDevice(undefined)).toBe(false);
  });
});
