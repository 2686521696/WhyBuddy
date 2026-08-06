/**
 * SidebarSessions（Claude 式侧栏会话区）单测：纯函数 + 静态结构。
 * 列表数据靠 effect 拉取，静态渲染只断言骨架（新建按钮 + 最近标签 + 列表容器）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSessionId, SidebarSessions, sortSessionsByRecency } from "../SidebarSessions";

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
