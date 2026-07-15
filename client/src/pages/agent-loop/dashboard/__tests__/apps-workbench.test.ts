/**
 * E14 我的应用画廊：卡片推导/筛选纯函数。
 * 纪律回归：不发明数据——模型缺失就是 draft，证据数如实。
 */
import { describe, it, expect } from "vitest";
import {
  deriveAppCardDetail,
  filterCards,
  formatUpdatedAt,
  type SessionListItem,
} from "../AppsWorkbench";

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

describe("formatUpdatedAt", () => {
  it("ISO → 本地紧凑格式；坏输入回空串", () => {
    expect(formatUpdatedAt("2026-07-15T06:17:00Z")).toMatch(/^2026-07-15 \d{2}:\d{2}$/);
    expect(formatUpdatedAt("garbage")).toBe("");
    expect(formatUpdatedAt(null)).toBe("");
  });
});
