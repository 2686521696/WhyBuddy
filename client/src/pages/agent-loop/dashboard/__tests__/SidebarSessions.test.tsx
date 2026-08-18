/**
 * SidebarSessions 单测：纯函数 + 静态结构。
 * 列表数据靠 effect 拉取，静态渲染只断言骨架（新建 + 搜索 + 列表容器）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createSessionId,
  filterSessionsByPhase,
  filterSessionsByQuery,
  groupSessionsByAge,
  sessionAgeGroup,
  sessionPhaseBucket,
  SidebarSessions,
  sortSessions,
  sortSessionsByRecency,
} from "../SidebarSessions";

describe("createSessionId", () => {
  // 2026-08-06：id 从本地生成改成**向服务端要**。
  //
  // 原来是 `sr-${Date.now().toString(36)}-${Math.random()...slice(2,7)}`——
  // 5 位 base36 ≈ 25 位熵，且 Math.random() 不是加密安全的；服务端那份是
  // 50 位 Crockford Base32 + 存在性检查。更要紧的是权威归属：id 由谁生成，
  // 就决定了"这条会话是谁的"由谁说了算。客户端生成时服务端只能被动接受，
  // 实测出过劫持漏洞（拿别人的 sessionId 发一次 POST 就能夺走整条会话）。
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("拿服务端返回的 sessionId，不在本地铸", async () => {
    let sentTo = "";
    await withFetch(
      (async (url: any, init: any) => {
        sentTo = String(url);
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ sessionId: "sr-20260806180527-K2Y58BC5EM" }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      async () => {
        expect(await createSessionId()).toBe("sr-20260806180527-K2Y58BC5EM");
      }
    );
    expect(sentTo).toBe("/api/sliderule/sessions");
  });

  it("401 给「请先登录」，不回落到本地生成", async () => {
    // 静默回落等于把刚拆掉的弱路径留个后门；而且失败的真实原因通常就是
    // 没登录（建会话已要求登录），给个用不了的本地 id 只会让用户在下一步
    // 撞得更莫名其妙。
    await withFetch(
      (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
      async () => {
        await expect(createSessionId()).rejects.toThrow(/登录/);
      }
    );
  });

  it("服务端没给 sessionId 也要抛，不能返回空串", async () => {
    await withFetch(
      (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
      async () => {
        await expect(createSessionId()).rejects.toThrow(/sessionId/);
      }
    );
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

describe("sortSessions · 创建时间", () => {
  it("按 createdAt 排，不被 lastActive 带偏（不该有：创建序仍走活跃时间）", () => {
    const input = [
      { sessionId: "old-but-hot", goal: "老", createdAt: "2026-07-01T10:00:00", lastActive: "2026-08-18T10:00:00" },
      { sessionId: "new-quiet", goal: "新", createdAt: "2026-08-10T10:00:00", lastActive: "2026-08-10T10:00:00" },
    ];
    expect(sortSessions(input, "active").map(s => s.sessionId)).toEqual(["old-but-hot", "new-quiet"]);
    expect(sortSessions(input, "created").map(s => s.sessionId)).toEqual(["new-quiet", "old-but-hot"]);
  });
});

describe("sessionPhaseBucket / filterSessionsByPhase", () => {
  it("只认 runtimePhase 三档，done/failed 不得混进推演中", () => {
    expect(sessionPhaseBucket("orchestrating")).toBe("running");
    expect(sessionPhaseBucket("awaiting")).toBe("running");
    expect(sessionPhaseBucket("idle")).toBe("running");
    expect(sessionPhaseBucket(null)).toBe("running");
    expect(sessionPhaseBucket("done")).toBe("done");
    expect(sessionPhaseBucket("concluded")).toBe("done");
    expect(sessionPhaseBucket("failed")).toBe("failed");

    const rows = [
      { sessionId: "r", goal: "跑", phase: "orchestrating" },
      { sessionId: "d", goal: "完", phase: "done" },
      { sessionId: "f", goal: "挂", phase: "failed" },
    ];
    expect(filterSessionsByPhase(rows, "all").map(s => s.sessionId)).toEqual(["r", "d", "f"]);
    expect(filterSessionsByPhase(rows, "running").map(s => s.sessionId)).toEqual(["r"]);
    expect(filterSessionsByPhase(rows, "done").map(s => s.sessionId)).toEqual(["d"]);
    expect(filterSessionsByPhase(rows, "failed").map(s => s.sessionId)).toEqual(["f"]);
    expect(filterSessionsByPhase(rows, "running").some(s => s.phase === "done")).toBe(false);
  });
});

describe("sessionAgeGroup / groupSessionsByAge", () => {
  it("按本地日历分桶，缺时间戳进更早；空桶不出现", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    const today0 = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const at = (days: number) => new Date(today0 + days * 86400000 + 3600000).toISOString();
    expect(sessionAgeGroup(at(0), now)).toBe("today");
    expect(sessionAgeGroup(at(-1), now)).toBe("yesterday");
    expect(sessionAgeGroup(at(-3), now)).toBe("week");
    expect(sessionAgeGroup(at(-10), now)).toBe("month");
    expect(sessionAgeGroup(at(-40), now)).toBe("older");
    expect(sessionAgeGroup(null, now)).toBe("older");

    const groups = groupSessionsByAge(
      [
        { sessionId: "t", goal: "今", lastActive: at(0) },
        { sessionId: "y", goal: "昨", lastActive: at(-1) },
        { sessionId: "w", goal: "周", lastActive: at(-3) },
        { sessionId: "none", goal: "无" },
      ],
      now,
    );
    expect(groups.map(g => [g.id, g.label, g.sessions.map(s => s.sessionId)])).toEqual([
      ["today", "今天", ["t"]],
      ["yesterday", "昨天", ["y"]],
      ["week", "近 7 天", ["w"]],
      ["older", "更早", ["none"]],
    ]);
    expect(groups.some(g => g.id === "month")).toBe(false);
  });
});

describe("filterSessionsByQuery", () => {
  const rows = [
    { sessionId: "a", goal: "社区快递代收" },
    { sessionId: "b", goal: "养老服务平台" },
  ];
  it("空串原样返回（不该有：空搜索搜出空表）", () => {
    expect(filterSessionsByQuery(rows, "  ").map(s => s.sessionId)).toEqual(["a", "b"]);
  });
  it("只按标题匹配，大小写不敏感", () => {
    expect(filterSessionsByQuery(rows, "养老").map(s => s.sessionId)).toEqual(["b"]);
    expect(filterSessionsByQuery(rows, "XYZ")).toEqual([]);
  });
});

describe("SidebarSessions 静态渲染", () => {
  it("骨架：新建会话 + 搜索 + 两档菜单，没有 PR/仓库空壳", () => {
    const html = renderToStaticMarkup(<SidebarSessions />);
    expect(html).toContain('data-testid="sidebar-sessions"');
    expect(html).toContain('data-testid="sidebar-session-new"');
    expect(html).toContain("新建会话");
    expect(html).toContain('data-testid="sidebar-session-search"');
    expect(html).toContain("搜索会话");
    expect(html).toContain('data-testid="sidebar-session-list"');
    expect(html).toContain('data-testid="sidebar-session-filter"');
    expect(html).toContain("最近活跃");
    expect(html).toContain("创建时间");
    expect(html).toContain("推演中");
    expect(html).toContain("已完成");
    expect(html).toContain("失败");
    // 旧扁平「最近」标签。分组标题要有数据才出现。
    expect(html).not.toMatch(/>最近</);
    expect(html).not.toContain("PR");
    expect(html).not.toContain("Environment");
    expect(html).not.toContain("Archived");
    expect(html).not.toContain("仓库");
  });

  it("渲染层真的调用排序和阶段筛（装在不通电的插座上会绿）", () => {
    const src = readFileSync(new URL("../SidebarSessions.tsx", import.meta.url), "utf8");
    expect(src).toContain("sortSessions(");
    expect(src).toContain("filterSessionsByPhase");
    expect(src).toContain("phaseFilter");
    expect(src).toContain("sortOrder");
    expect(src).not.toMatch(/setSessions\(sortSessionsByRecency/);
  });
});
