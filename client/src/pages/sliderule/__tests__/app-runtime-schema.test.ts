import { describe, it, expect } from "vitest";
import { buildAiActionInputs, deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
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
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "余额提醒文案",
        inputFields: ["member_card.holder", "member_card.balance", "coach.name"],
        outputField: "member_card.balance",
      },
      {
        id: "cap_write",
        name: "持卡人画像",
        inputFields: ["member_card.holder"],
        outputField: "member_card.holder",
      },
      {
        id: "cap_dangling",
        name: "悬空输出",
        inputFields: [],
        outputField: "member_card.not_a_field",
      },
    ],
  },
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

  it("AI 动作：outputField 落在本页主实体的能力进 aiActions；悬空输出不进", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const page = schema.pages[0];
    expect(page.aiActions.map((a) => a.capId)).toEqual(["cap_summary", "cap_write"]);
    const summary = page.aiActions[0];
    expect(summary.label).toBe("余额提醒文案");
    expect(summary.outputFieldId).toBe("balance");
    expect(summary.outputLabel).toBe("余额");
    // 悬空 outputField（member_card.not_a_field）被诚实排除
    expect(page.aiActions.some((a) => a.capId === "cap_dangling")).toBe(false);
    // 无主实体的页面没有 AI 动作
    expect(schema.pages[1].aiActions).toEqual([]);
  });

  it("buildAiActionInputs：同实体字段从行值预填，跨实体引用留空不猜", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const action = schema.pages[0].aiActions[0]; // cap_summary
    const inputs = buildAiActionInputs(action, "member_card", {
      holder: "张三",
      balance: 42,
    });
    expect(inputs).toEqual({
      "member_card.holder": "张三",
      "member_card.balance": "42",
      "coach.name": "", // 跨实体 → 留空
    });
  });

  it("无绑定页 entityId=null；缺页面/实体时整体返回 null（不伪造）", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    expect(schema.pages[1].entityId).toBeNull();
    expect(schema.pages[1].workflowLinked).toBe(false);
    expect(deriveAppRuntimeSchema({})).toBeNull();
    expect(deriveAppRuntimeSchema({ ...MODEL, page: { pages: [] } })).toBeNull();
  });
});
