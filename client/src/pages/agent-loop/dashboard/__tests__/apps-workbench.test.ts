/**
 * E14 我的应用画廊：卡片推导/筛选纯函数。
 * 纪律回归：不发明数据——模型缺失就是 draft，证据数如实。
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import {
  deriveAppCardDetail,
  deriveDetailFromAppSummary,
  deriveDetailFromAppRecord,
  mergeGalleryItems,
  filterCards,
  formatUpdatedAt,
  formatRelativeTime,
  type SessionListItem,
} from "../AppsWorkbench";
import type { AppStoreSummary } from "../app-store-client";

const runnableState = {
  publishClosure: {
    evidencePresentCount: 6,
    blocked: false,
    perSkillEvidence: {
      datamodel: {
        modelSection: {
          entities: [
            { name: "患者", fields: [{ name: "姓名" }] },
            { name: "预约单", fields: [] },
          ],
        },
      },
      page: {
        modelSection: {
          pages: [{ id: "p1", name: "工作台" }, { id: "p2", name: "预约日历" }],
        },
      },
      rbac: { modelSection: { roles: ["dentist", "front_desk"] } },
      workflow: {
        modelSection: { nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }], transitions: [] },
      },
    },
  },
};

describe("deriveAppCardDetail", () => {
  it("闭环 6/6 + 模型齐 → runnable，计数取真模型", () => {
    const d = deriveAppCardDetail(runnableState);
    expect(d.status).toBe("runnable");
    expect(d.evidenceCount).toBe(6);
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(2);
    expect(d.flowNodes).toBe(3);
    expect(d.roles).toBe(2);
    expect(d.pageNames).toEqual(["工作台", "预约日历"]);
    expect(d.entityNames).toContain("患者");
  });

  it("证据 6/6 但无模型（确定性域）→ 不冒充可运行", () => {
    const d = deriveAppCardDetail({
      publishClosure: { evidencePresentCount: 6, blocked: false },
    });
    expect(d.status).toBe("draft");
    expect(d.entities).toBe(0);
  });

  it("停泊等待（awaitReason）→ awaiting；空状态 → draft 零计数", () => {
    expect(
      deriveAppCardDetail({ awaitReason: "route_selection", publishClosure: {} }).status
    ).toBe("awaiting");
    const empty = deriveAppCardDetail({});
    expect(empty.status).toBe("draft");
    expect(empty.evidenceCount).toBe(0);
  });

  it("blocked 闭环不算可运行", () => {
    const d = deriveAppCardDetail({
      ...runnableState,
      publishClosure: { ...runnableState.publishClosure, blocked: true },
    });
    expect(d.status).not.toBe("runnable");
  });
});

describe("filterCards", () => {
  const item = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });
  const cards = [
    { item: item("a", "宠物医院预约"), detail: deriveAppCardDetail(runnableState) },
    { item: item("b", "健身房排期"), detail: deriveAppCardDetail({}) },
    { item: item("c", "还没拉到详情"), detail: null },
  ];

  it("all 全放行；runnable/draft 按状态；详情未到不武断归类", () => {
    expect(filterCards(cards, "all", "")).toHaveLength(3);
    expect(filterCards(cards, "runnable", "").map(c => c.item.sessionId)).toEqual(["a"]);
    expect(filterCards(cards, "draft", "").map(c => c.item.sessionId)).toEqual(["b"]);
  });

  it("搜索按话题子串过滤", () => {
    expect(filterCards(cards, "all", "宠物")).toHaveLength(1);
    expect(filterCards(cards, "all", "不存在")).toHaveLength(0);
  });
});

const summary = (over: Partial<AppStoreSummary> = {}): AppStoreSummary => ({
  id: "app1",
  root_id: "app1",
  parent_id: null,
  version: 1,
  session_id: "s1",
  goal: "咖啡店管理",
  gate_passed: true,
  created_at: "2026-07-24T10:00:00Z",
  product_name: "咖营通",
  theme_id: "forest",
  theme_label: "松绿·测试",
  device: "desktop",
  landing_page_ref: "p0",
  entity_count: 3,
  page_count: 4,
  ...over,
});

describe("deriveDetailFromAppSummary", () => {
  it("App Store 摘要 → 即时 runnable 占位，计数取摘要、模型待懒拉", () => {
    const d = deriveDetailFromAppSummary(summary());
    expect(d.status).toBe("runnable"); // App Store 只存闭环应用
    expect(d.entities).toBe(3);
    expect(d.pages).toBe(4);
    expect(d.model).toBeNull(); // 摘要不含模型，进视口再拉
    expect(d.identity?.productName).toBe("咖营通");
    expect(d.identity?.theme).toBe("forest");
  });
});

describe("deriveDetailFromAppRecord", () => {
  it("完整 model_json → 全指标 + 活渲染模型（与会话卡同源口径）", () => {
    const model = {
      datamodel: { entities: [{ name: "订单" }, { name: "商品" }] },
      page: { pages: [{ id: "p0", name: "监控台" }] },
      workflow: { nodes: [{ id: "n1" }] },
      rbac: { roles: ["店长", "店员"] },
      aigc: { capabilities: [{ id: "c1" }] },
      appbundle: { appIdentity: { productName: "咖营通", theme: "forest", icon: "cart" } },
    };
    const d = deriveDetailFromAppRecord(model);
    expect(d.status).toBe("runnable");
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(1);
    expect(d.roles).toBe(2);
    expect(d.aiCaps).toBe(1);
    expect(d.identity?.icon).toBe("cart");
    expect(d.model).not.toBeNull();
  });

  it("坏 model_json（非对象）→ 不崩，退成空指标 draft", () => {
    expect(deriveDetailFromAppRecord(null).model).toBeNull();
    expect(deriveDetailFromAppRecord("nope").entities).toBe(0);
  });
});

describe("mergeGalleryItems", () => {
  const sess = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });

  it("App Store 应用 + 未落库会话草稿合流，按 session_id 去重", () => {
    const apps = [summary({ id: "app1", session_id: "s1" })];
    const sessions = [sess("s1", "咖啡店（已闭环）"), sess("s2", "健身房（在推演）")];
    const items = mergeGalleryItems(apps, sessions);
    // s1 已被 App Store 卡承载 → 不再出会话草稿卡；只剩 app1 + s2
    expect(items.map(i => i.key).sort()).toEqual(["app:app1", "session:s2"]);
    const appItem = items.find(i => i.source === "app")!;
    expect(appItem.appId).toBe("app1");
    expect(appItem.version).toBe(1);
    const draft = items.find(i => i.source === "session")!;
    expect(draft.sessionId).toBe("s2");
  });

  it("无 App Store（空）→ 全是会话卡，零回退", () => {
    const items = mergeGalleryItems([], [sess("s1", "a"), sess("s2", "b")]);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.source === "session")).toBe(true);
  });
});

describe("filterCards（含 App Store 卡）", () => {
  it("App Store 摘要卡即时算 runnable，进 runnable 筛选", () => {
    const cards = [
      { item: { goal: "咖营通" }, detail: deriveDetailFromAppSummary(summary()) },
      { item: { goal: "草稿" }, detail: deriveAppCardDetail({}) },
    ];
    expect(filterCards(cards, "runnable", "")).toHaveLength(1);
    expect(filterCards(cards, "draft", "")).toHaveLength(1);
  });
});

describe("formatUpdatedAt", () => {
  it("ISO → 本地紧凑格式；坏输入回空串", () => {
    expect(formatUpdatedAt("2026-07-15T06:17:00Z")).toMatch(/^2026-07-15 \d{2}:\d{2}$/);
    expect(formatUpdatedAt("garbage")).toBe("");
    expect(formatUpdatedAt(null)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-26T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

  it("按跨度给人话，绝对时间由调用方兜底", () => {
    expect(formatRelativeTime(ago(10 * S), now)).toBe("刚刚");
    expect(formatRelativeTime(ago(5 * M), now)).toBe("5 分钟前");
    expect(formatRelativeTime(ago(3 * H), now)).toBe("3 小时前");
    expect(formatRelativeTime(ago(1 * D), now)).toBe("昨天");
    expect(formatRelativeTime(ago(4 * D), now)).toBe("4 天前");
    expect(formatRelativeTime(ago(2 * 7 * D), now)).toBe("2 周前");
    expect(formatRelativeTime(ago(90 * D), now)).toBe("3 个月前");
    expect(formatRelativeTime(ago(400 * D), now)).toBe("1 年前");
  });

  it("空/坏输入回空串", () => {
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("garbage", now)).toBe("");
  });
});

// ── 顶栏吸顶 + 卡片墙（2026-07-31）─────────────────────────────────────
// 纯 className 的改动最容易在后续重构里被无声改掉（不报错、测试也不红，
// 只是回到"筛选 chip 跟着滚没"）。这里读源码钉住几条必要条件。
describe("应用中心顶栏吸顶", () => {
  const src = readFileSync(
    new URL("../AppsWorkbench.tsx", import.meta.url),
    "utf8"
  );

  it("标题/搜索/tab/筛选整块 sticky 在滚动容器顶部", () => {
    expect(src).toMatch(/className="sticky top-0 z-30 /);
  });

  it("吸顶块必须自带背景——sticky 元素默认透明，卡片会从字底下穿过去", () => {
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("bg-[var(--sr-shell-bg,#eef2f7)]");
  });

  it("负 margin + 同值 padding 抵掉根节点内边距，背景铺满整宽", () => {
    // 不这么做的话卡片会从左右内边距那两条缝里透出来。
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/)![0];
    for (const cls of ["-mx-6", "px-6", "-mt-5", "pt-5", "md:-mx-8", "md:px-8"]) {
      expect(m).toContain(cls);
    }
  });

  it("z-30 高于卡片菜单(z-10)与健康浮层(z-20)", () => {
    // 健康浮层在吸顶块**里面**，跟着一起吸顶；卡片菜单在下面，被盖住是对的。
    expect(src).toContain("top-11 z-20"); // 健康浮层
    expect(src).toContain("top-8 z-10"); // 卡片菜单
  });

  it("卡片墙用绝对定位容器，不再是等尺寸 grid", () => {
    expect(src).toContain('data-testid="apps-wall"');
    // 旧写法：grid-cols-2 + 每卡 aspect-video，手机档被硬拉成 16:9
    expect(src).not.toMatch(/grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">\s*\{pagedMine/);
  });
});
