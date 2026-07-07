import { describe, it, expect } from "vitest";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "member_card",
        name: "会员卡",
        fields: [
          { id: "id", name: "编号", type: "string" },
          { id: "holder", name: "持卡人", type: "string" },
          { id: "balance", name: "余额", type: "number" },
          { id: "coach_ref", name: "私教", type: "ref" },
        ],
      },
      { id: "coach", name: "私教", fields: [{ id: "name", name: "姓名", type: "string" }] },
    ],
  },
  rbac: { roles: ["member", "manager"], permissions: ["card:create"], menus: [] },
  workflow: {
    nodes: [{ id: "submit", name: "提交核销" }, { id: "approve", name: "经理审批" }],
    transitions: [{ from: "submit", to: "approve" }],
  },
  page: {
    pages: [
      {
        id: "card_page",
        name: "会员卡核销",
        fieldBindings: ["member_card.holder", "member_card.balance", "coach.name"],
        actionPermissions: ["card:create"],
      },
      { id: "empty_page", name: "无绑定页", fieldBindings: [] },
    ],
  },
  aigc: { capabilities: [] },
  appbundle: {
    pageBindings: [{ pageRef: "card_page", workflowRef: "wf" }],
    roleRefs: ["member"],
    dataModelRefs: ["member_card"],
  },
};

describe("deriveAppRuntimeSchema（应用运行 option）", () => {
  it("页面主实体 = fieldBindings 中占多数的实体；表单项 = 绑定字段", () => {
    const schema = deriveAppRuntimeSchema(MODEL, "健身房系统")!;
    expect(schema.appName).toBe("健身房系统");
    expect(schema.roles).toEqual(["member", "manager"]);
    expect(schema.menus.map((m) => m.label)).toEqual(["工作台", "会员卡核销", "无绑定页"]);

    const page = schema.pages[0];
    expect(page.entityId).toBe("member_card");
    expect(page.formFields.map((f) => f.id)).toEqual(["holder", "balance"]);
    expect(page.columns.map((f) => f.id)).toContain("coach_ref");
    expect(page.workflowLinked).toBe(true);
    expect(page.actions).toEqual(["card:create"]);
  });

  it("工作台（home）JSON 化：统计卡声明来源，菜单首项指向 home", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.home.id).toBe("home");
    expect(schema.home.title).toBe("工作台");
    expect(schema.menus[0].pageId).toBe("home");
    // 前两实体行数 + 进行中/累计审批，共 4 张卡
    expect(schema.home.stats.map((s) => s.source)).toEqual([
      "entity:member_card",
      "entity:coach",
      "instances:running",
      "instances:total",
    ]);
    // 图表也 JSON 声明：实体数据量条形 + 审批状态环图
    expect(schema.home.charts.map((c) => `${c.type}:${c.source}`)).toEqual([
      "bar:entities:rowcount",
      "donut:instances:status",
    ]);
  });

  it("详情抽屉字段 = 主实体全字段（不截断）", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.pages[0].detailFields.map((f) => f.id)).toEqual([
      "id",
      "holder",
      "balance",
      "coach_ref",
    ]);
  });

  it("ref 字段解析目标实体（coach_ref → coach）供下拉渲染", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const refField = schema.pages[0].columns.find((f) => f.id === "coach_ref")!;
    expect(refField.type).toBe("ref");
    expect(refField.refEntityId).toBe("coach");
  });

  it("无绑定页 entityId=null；缺页面/实体时整体返回 null（不伪造）", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.pages[1].entityId).toBeNull();
    expect(schema.pages[1].workflowLinked).toBe(false);
    expect(deriveAppRuntimeSchema({})).toBeNull();
    expect(deriveAppRuntimeSchema({ ...MODEL, page: { pages: [] } })).toBeNull();
  });
});
