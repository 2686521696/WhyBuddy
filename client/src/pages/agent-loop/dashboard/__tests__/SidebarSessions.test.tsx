/**
 * SidebarSessions（Claude 式侧栏会话区）单测：纯函数 + 静态结构。
 * 列表数据靠 effect 拉取，静态渲染只断言骨架（新建按钮 + 最近标签 + 列表容器）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newSessionId, SidebarSessions, sortSessionsByRecency } from "../SidebarSessions";

describe("newSessionId", () => {
  it("sr- 前缀且两次生成不同", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^sr-[a-z0-9]+-[a-z0-9]{5}$/);
    expect(a).not.toBe(b);
  });
});

describe("sortSessionsByRecency", () => {
  it("按 lastActive 倒序，缺时间戳回退 createdAt，全缺沉底；不改原数组", () => {
    const input = [
      { sessionId: "old", goal: "旧", lastActive: "2026-07-01T10:00:00" },
      { sessionId: "none", goal: "无时间" },
      { sessionId: "new", goal: "新", lastActive: "2026-07-08T10:00:00" },
      { sessionId: "created-only", goal: "仅创建", createdAt: "2026-07-05T10:00:00" },
    ];
    const sorted = sortSessionsByRecency(input);
    expect(sorted.map((s) => s.sessionId)).toEqual(["new", "created-only", "old", "none"]);
    expect(input[0].sessionId).toBe("old"); // 原数组未被排序
  });
});

describe("SidebarSessions 静态渲染", () => {
  it("骨架：新建会话按钮 + 「最近」标签 + 列表容器", () => {
    const html = renderToStaticMarkup(<SidebarSessions />);
    expect(html).toContain('data-testid="sidebar-sessions"');
    expect(html).toContain('data-testid="sidebar-session-new"');
    expect(html).toContain("新建会话");
    expect(html).toContain("最近");
    expect(html).toContain('data-testid="sidebar-session-list"');
  });
});
