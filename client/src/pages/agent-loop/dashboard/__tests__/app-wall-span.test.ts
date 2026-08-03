/**
 * 跨列规则：哪些卡该占两列。
 *
 * 这里守的是**诚实性**，不是好看：跨列必须由真实信息决定，同一份数据两次调用
 * 必须给同一个集合。随机跨列能立刻做出错落感，但那是假信息——用户会以为宽卡
 * 代表什么，而且刷新一次就换一批。
 */

import { describe, it, expect } from "vitest";
import { computeSpanKeys, spanForColumnCount } from "../app-wall-span";
import type { GalleryItem } from "../AppsWorkbench";

function appItem(key: string, device: string, pageCount: number): GalleryItem {
  return {
    key,
    source: "app",
    goal: key,
    appId: key,
    summary: {
      id: key,
      root_id: key,
      parent_id: null,
      version: 1,
      session_id: null,
      goal: key,
      gate_passed: true,
      created_at: "2026-07-31T00:00:00Z",
      product_name: key,
      theme_id: "t",
      theme_label: "T",
      device,
      landing_page_ref: "p",
      entity_count: 3,
      page_count: pageCount,
    },
  } as GalleryItem;
}

function sessionItem(key: string): GalleryItem {
  return { key, source: "session", goal: key, sessionId: key } as GalleryItem;
}

describe("computeSpanKeys", () => {
  it("只有桌面档有资格跨列", () => {
    // 手机档是 405×720（9:16）的竖比例，跨两列会算出 1000px 以上的巨条。
    const items = [
      appItem("phone-1", "phone", 99),
      appItem("phone-2", "phone", 98),
      appItem("desk-1", "desktop", 5),
      appItem("desk-2", "desktop", 4),
      appItem("desk-3", "desktop", 3),
      appItem("desk-4", "desktop", 2),
    ];
    const keys = computeSpanKeys(items);
    // 手机档页面数最多也不该入选
    expect(keys.has("phone-1")).toBe(false);
    expect(keys.has("phone-2")).toBe(false);
    expect([...keys].every(k => k.startsWith("desk"))).toBe(true);
  });

  it("device 为空串按桌面处理（跟 aspectForDevice 取向一致）", () => {
    const items = Array.from({ length: 8 }, (_, i) => appItem(`a${i}`, "", 8 - i));
    const keys = computeSpanKeys(items);
    expect(keys.size).toBe(2); // floor(8 * 0.25)
    expect(keys.has("a0")).toBe(true); // 页面数最多
  });

  it("按页面数降序取前 ratio", () => {
    const items = [
      appItem("few", "desktop", 1),
      appItem("most", "desktop", 9),
      appItem("mid", "desktop", 5),
      appItem("least", "desktop", 0),
    ];
    const keys = computeSpanKeys(items); // floor(4*0.25) = 1
    expect([...keys]).toEqual(["most"]);
  });

  it("会话卡（无摘要）不参与", () => {
    const items = [sessionItem("s1"), sessionItem("s2"), sessionItem("s3"), sessionItem("s4")];
    expect(computeSpanKeys(items).size).toBe(0);
  });

  it("同一份数据两次调用给同一个集合（不能随机）", () => {
    const items = Array.from({ length: 12 }, (_, i) => appItem(`a${i}`, "desktop", i % 4));
    const a = [...computeSpanKeys(items)].sort();
    const b = [...computeSpanKeys(items)].sort();
    expect(a).toEqual(b);
  });

  it("页面数并列时按 key 破平——换个入参顺序结果不变", () => {
    // 不加破平的话，Array.sort 对相等元素的处理不保证跨引擎一致，
    // 同一份数据换个来源顺序可能给出不同的跨列集合。
    const mk = () => [
      appItem("b", "desktop", 5),
      appItem("a", "desktop", 5),
      appItem("d", "desktop", 5),
      appItem("c", "desktop", 5),
    ];
    const forward = [...computeSpanKeys(mk())].sort();
    const reversed = [...computeSpanKeys(mk().reverse())].sort();
    expect(forward).toEqual(reversed);
  });

  it("卡片太少时一张都不跨（floor 到 0）", () => {
    expect(computeSpanKeys([appItem("only", "desktop", 5)]).size).toBe(0);
    expect(computeSpanKeys([]).size).toBe(0);
  });

  it("ratio 可调，且落在有资格的卡上", () => {
    const items = Array.from({ length: 20 }, (_, i) => appItem(`a${i}`, "desktop", 20 - i));
    expect(computeSpanKeys(items, 0.25).size).toBe(5);
    expect(computeSpanKeys(items, 0.5).size).toBe(10);
  });
});

describe("spanForColumnCount", () => {
  it("列数不足 3 时跨列退回 1 —— 窄屏不能让一张卡吃掉整行", () => {
    expect(spanForColumnCount(true, 1)).toBe(1);
    expect(spanForColumnCount(true, 2)).toBe(1);
    expect(spanForColumnCount(true, 3)).toBe(2);
    expect(spanForColumnCount(true, 5)).toBe(2);
  });

  it("非跨列卡任何列数下都是 1", () => {
    expect(spanForColumnCount(false, 5)).toBe(1);
    expect(spanForColumnCount(false, 1)).toBe(1);
  });
});
