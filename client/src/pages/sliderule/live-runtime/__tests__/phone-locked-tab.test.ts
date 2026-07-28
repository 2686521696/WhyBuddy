/**
 * 手机档：无权限 tab 要出声，提示要落在手机框里（2026-07-28）。
 *
 * 两条都是真机查出来的：
 *
 * ① 点无权限的 tab 原本是**静默 no-op**——图标灰掉、挂一个 title。title 是
 *    鼠标悬停才出的东西，触屏上根本不存在；手机用户点一下什么都不发生，
 *    只会以为应用卡了。灰掉是"看得出不能点"，点了还得说明为什么。
 *
 * ② Toast 默认 portal 到 document.body。手机档是在一个缩放过的画布里预览的，
 *    提示会飘到整个浏览器窗口中央、压根不在手机框内。真机实测：Toast 节点
 *    存在（count=1）但画面上找不到。传 getContainer 指到画布后，实测坐标
 *    落在手机框内（x≈1105, y≈420），文案完整。
 *
 * 这一条同时是"别把 notify 的容器参数顺手删掉"的哨兵——删了不会报错、
 * 测试也不会红，只会在手机预览里再次看不到任何提示。
 */
import { describe, it, expect } from "vitest";

const tabBarSrc = await import("../phone-mobile/PhoneTabBar.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const feedbackSrc = await import("../phone-mobile/phone-feedback.ts?raw").then(
  m => (m as unknown as { default: string }).default
);
const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("无权限 tab", () => {
  it("点了要回调，不是静默吞掉", () => {
    expect(tabBarSrc).toContain("onLockedTap");
    expect(tabBarSrc).toContain("onLockedTap?.(item)");
    // 仍然不允许切页——出声不等于放行
    expect(tabBarSrc).toContain("if (item.locked)");
  });

  it("父层把它接到 notify 上，并带上角色和页名", () => {
    expect(screenSrc).toContain("onLockedTap={item =>");
    expect(screenSrc).toContain("无「${item.label}」权限");
  });
});

describe("手机档提示的落点", () => {
  it("notify 支持 getContainer", () => {
    expect(feedbackSrc).toContain("getContainer");
  });

  it("每一处手机档 notify 都传了画布容器", () => {
    // 漏传的那处不会报错，只会在手机预览里静默看不见——所以逐处锁
    const calls = screenSrc.match(/notify\(/g) ?? [];
    const withContainer = screenSrc.match(/\(\)\s*=>\s*canvasEl/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(withContainer.length).toBeGreaterThanOrEqual(calls.length);
  });
});
