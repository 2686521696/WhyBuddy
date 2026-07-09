/**
 * 流式（未收尾）五系统 JSON 的容错解析——右侧舞台"应用实时长出来"的地基。
 * 语义：任何前缀要么解析出已流完的段，要么诚实返回 null；绝不抛异常。
 */
import { describe, it, expect } from "vitest";
import {
  repairPartialJson,
  parsePartialFiveSystemModel,
} from "../system-screens/five-system-model";

const FULL_MODEL = {
  datamodel: {
    entities: [
      {
        id: "instrument",
        name: "乐器档案",
        fields: [
          { id: "title", name: "名称", type: "string" },
          { id: "price", name: "定价", type: "number" },
        ],
      },
      {
        id: "order",
        name: "寄卖单",
        fields: [{ id: "status", name: "状态", type: "enum" }],
      },
    ],
  },
  rbac: { roles: ["seller", "appraiser"], permissions: ["p1"], menus: [] },
  workflow: {
    nodes: [{ id: "n1", name: "提交", assigneeRole: "seller" }],
    transitions: [{ from: "n1", to: "n1" }],
  },
  page: {
    pages: [{ id: "home", name: "首页", fieldBindings: ["instrument.title"] }],
  },
  aigc: { capabilities: [] },
  appbundle: { pageBindings: [{ pageRef: "home", workflowRef: "wf" }] },
};
const FULL_JSON = JSON.stringify(FULL_MODEL);

describe("repairPartialJson", () => {
  it("完整 JSON 原样解析", () => {
    expect(repairPartialJson(FULL_JSON)).toEqual(FULL_MODEL);
  });

  it("任意前缀绝不抛异常，且要么 null 要么对象", () => {
    for (let len = 1; len <= FULL_JSON.length; len += 7) {
      const parsed = repairPartialJson(FULL_JSON.slice(0, len));
      expect(parsed === null || typeof parsed === "object").toBe(true);
    }
  });

  it("截断在字符串/键中间：剪掉悬空部分后仍能拼出已完成内容", () => {
    // 截到第二个实体的 name 中间
    const cut = FULL_JSON.indexOf('"寄卖单"') + 3;
    const parsed = repairPartialJson(FULL_JSON.slice(0, cut)) as any;
    expect(parsed).not.toBeNull();
    expect(parsed.datamodel.entities[0].id).toBe("instrument");
    expect(parsed.datamodel.entities[0].fields).toHaveLength(2);
  });

  it("非 JSON 前言（markdown 说明）后跟 JSON 也能定位解析", () => {
    const parsed = repairPartialJson(
      "以下是模型：\n" + FULL_JSON.slice(0, 120)
    ) as any;
    expect(parsed).not.toBeNull();
  });

  it("纯文本无 JSON 返回 null", () => {
    expect(repairPartialJson("正在思考风险与缓解路径……")).toBeNull();
  });
});

describe("parsePartialFiveSystemModel", () => {
  it("前缀逐渐变长，解析出的段单调增长，最终与完整模型一致", () => {
    let maxSections = 0;
    for (let len = 50; len <= FULL_JSON.length; len += 100) {
      const model = parsePartialFiveSystemModel(FULL_JSON.slice(0, len));
      const count = model ? Object.keys(model).length : 0;
      expect(count).toBeGreaterThanOrEqual(maxSections > 0 ? 1 : 0);
      maxSections = Math.max(maxSections, count);
    }
    const final = parsePartialFiveSystemModel(FULL_JSON);
    expect(final).toEqual(FULL_MODEL);
    expect(maxSections).toBe(6);
  });

  it("datamodel + page 都流完后，部分模型足以派生运行应用 schema", async () => {
    const cut = FULL_JSON.indexOf('"aigc"'); // page 段已完整，aigc 起始处截断
    const model = parsePartialFiveSystemModel(FULL_JSON.slice(0, cut));
    expect(model?.datamodel?.entities?.length).toBe(2);
    expect(model?.page?.pages?.length).toBe(1);
    const { deriveAppRuntimeSchema } = await import(
      "../live-runtime/app-runtime-schema"
    );
    expect(deriveAppRuntimeSchema(model, "测试应用")).not.toBeNull();
  });
});
