import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBlankSessionMeta } from "../SidebarSessions";

/**
 * 用户报「点新建会话，右侧的显示有问题」。追下去两条独立的因：
 *  1. 舞台最大化后对话栏塌成 0%，新会话继承 → 打不了字
 *     （判据在 sliderule/__tests__/studio-layout.test.ts）。
 *  2. 新建会话**根本没新建**——本文件这条。
 *
 * 真机实测（1500×950，同一账号）：点「新建会话」后 DOM 里仍有
 * turnAnswers=3 / userBubbles=3，说明复用了上一条会话。
 *
 * E28 的空判据是 `!meta.goal`，而 PR-4 之后便宜轮刻意不写 goal（KD17）。
 * 变异：把 isBlankSessionMeta 里的 phase 判断删掉，本文件必须红。
 */
describe("isBlankSessionMeta（新建会话该复用谁）", () => {
  it("真正全新的会话可复用：goal 空 + phase=idle", () => {
    expect(isBlankSessionMeta({ goal: "", phase: "idle" })).toBe(true);
  });

  it("不在列表里（刚建未落盘）当作空", () => {
    expect(isBlankSessionMeta(undefined)).toBe(true);
    expect(isBlankSessionMeta(null)).toBe(true);
  });

  it("phase 缺失也当作空（老会话/降级读，别把人卡在建不了新会话）", () => {
    expect(isBlankSessionMeta({ goal: "" })).toBe(true);
    expect(isBlankSessionMeta({ goal: "", phase: null })).toBe(true);
  });

  it("关键反向：有便宜轮历史的会话不许被复用（goal 空但 phase=awaiting）", () => {
    expect(
      isBlankSessionMeta({ goal: "", phase: "awaiting" }),
      "问候/搜索/ask_user 都不写 goal——只看 goal 就会把用户丢回上一条会话"
    ).toBe(false);
  });

  it("反向：跑过工厂的会话不许被复用", () => {
    expect(isBlankSessionMeta({ goal: "", phase: "done" })).toBe(false);
    expect(isBlankSessionMeta({ goal: "", phase: "failed" })).toBe(false);
    expect(isBlankSessionMeta({ goal: "连锁宠物医院", phase: "idle" })).toBe(false);
  });

  it("通电：两个复用分支都得走这条判据，不许还留着裸 !s.goal", () => {
    const src = readFileSync(
      new URL("../SidebarSessions.tsx", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // ⚠ 从 testid 往后找按钮文案：`新建会话` 这四个字在文件更早处的
    //   createSessionId 错误文案里也出现（"请先登录后再新建会话"），
    //   直接 indexOf 会把切片切空——空串 toContain 永远失败，看着像功能没接。
    const from = src.indexOf('data-testid="sidebar-session-new"');
    expect(from, "找不到新建会话按钮").toBeGreaterThan(-1);
    const to = src.indexOf("新建会话", from);
    expect(to, "找不到按钮文案收尾").toBeGreaterThan(from);
    const handler = src.slice(from, to);
    expect(handler).toContain("isBlankSessionMeta");
    expect(handler).toContain("DEFAULT_SESSION_ID");
    expect(
      /\.find\(\s*\(?s\)?\s*=>\s*!s\.goal\s*\)/.test(handler),
      "还留着 `list.find(s => !s.goal)`：那条分支会挑中有便宜轮历史的会话"
    ).toBe(false);
  });
});
