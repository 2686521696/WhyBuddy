/**
 * E14 我的应用画廊：卡片推导/筛选纯函数。
 * 纪律回归：不发明数据——模型缺失就是 draft，证据数如实。
 */
import { describe, it, expect } from "vitest";
import {
  deriveAppCardDetail,
  deriveDetailFromAppSummary,
  deriveDetailFromAppRecord,
  mergeGalleryItems,
  filterCards,
  formatUpdatedAt,
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
