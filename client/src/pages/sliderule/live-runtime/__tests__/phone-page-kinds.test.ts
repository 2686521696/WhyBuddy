/**
 * pageKind 的派生与手机档骨架（2026-07-28）。
 *
 * 真机上撞到的事：咖啡工坊那个应用声明了 kanban / calendar 页，运行时却
 * 全部渲染成 workbench。派生层对这两种范式有硬要求——绑定解析不到就诚实
 * 降级——所以先把"什么样的声明能活下来"钉死，再谈手机档怎么渲染它。
 *
 * 这几条同时是排查工具：将来再遇到"看板页变成普通列表"，对着这里就能
 * 判断是声明的问题还是渲染的问题。
 */
import { describe, it, expect } from "vitest";

import { deriveAppRuntimeSchema } from "../app-runtime-schema";

/** 最小可用模型：一个实体 + 一个页面，页面的 kind/绑定由参数决定。 */
function modelWith(pageExtra: Record<string, unknown>) {
  return {
    datamodel: {
      entities: [
        {
          id: "roast_batch",
          name: "烘焙批次",
          fields: [
            { id: "batch_code", name: "批次号", type: "string" },
            {
              id: "status",
              name: "批次状态",
              type: "enum",
              options: [
                { id: "planned", label: "待烘焙" },
                { id: "roasting", label: "烘焙中" },
                { id: "done", label: "已完成" },
              ],
            },
            { id: "planned_date", name: "计划日期", type: "date" },
          ],
        },
      ],
    },
    rbac: { roles: [], permissions: [], menus: [] },
    workflow: { workflows: [] },
    page: {
      pages: [
        {
          id: "board",
          name: "烘焙看板",
          fieldBindings: [
            "roast_batch.batch_code",
            "roast_batch.status",
            "roast_batch.planned_date",
          ],
          ...pageExtra,
        },
      ],
    },
    aigc: { capabilities: [] },
    appbundle: { landingPageRef: "board", pageBindings: [] },
  } as unknown as Parameters<typeof deriveAppRuntimeSchema>[0];
}

const viewOf = (extra: Record<string, unknown>) =>
  deriveAppRuntimeSchema(modelWith(extra))?.pages[0]?.view;

describe("kanban 的派生条件", () => {
  it("statusField 指到本页实体的 enum 字段 → 活下来", () => {
    expect(viewOf({ kind: "kanban", statusField: "roast_batch.status" }))
      .toEqual({ kind: "kanban", statusFieldId: "status" });
  });

  it("字段名对不上 → 诚实降级 workbench，而不是渲染坏视图", () => {
    // 真机遇到的形态：迭代把字段名写成了实体里不存在的那个
    expect(
      viewOf({ kind: "kanban", statusField: "roast_batch.roast_status" })?.kind
    ).toBe("workbench");
  });

  it("类型不是 enum → 降级（日期字段当不了看板列）", () => {
    expect(
      viewOf({ kind: "kanban", statusField: "roast_batch.planned_date" })?.kind
    ).toBe("workbench");
  });

  it("statusField 整个缺失 → 降级", () => {
    expect(viewOf({ kind: "kanban" })?.kind).toBe("workbench");
  });

  it("指向别的实体 → 降级（看板列必须来自本页主实体）", () => {
    expect(
      viewOf({ kind: "kanban", statusField: "cupping_record.status" })?.kind
    ).toBe("workbench");
  });
});

describe("calendar 的派生条件", () => {
  it("dateField 指到本页实体的 date 字段 → 活下来", () => {
    expect(
      viewOf({ kind: "calendar", dateField: "roast_batch.planned_date" })
    ).toMatchObject({ kind: "calendar", dateFieldId: "planned_date" });
  });

  it("类型不是 date → 降级", () => {
    expect(
      viewOf({ kind: "calendar", dateField: "roast_batch.status" })?.kind
    ).toBe("workbench");
  });
});

describe("主实体的确定方式", () => {
  it("页面主实体取 fieldBindings 里出现最多的实体，不是单独声明的字段", () => {
    // 这一条是排查的关键：页面对象上没有 entity 字段，主实体是从
    // fieldBindings 数出来的。绑定串写歪了，view 绑定跟着一起失效。
    const view = deriveAppRuntimeSchema(
      modelWith({
        kind: "kanban",
        statusField: "roast_batch.status",
        fieldBindings: ["other_entity.a", "other_entity.b", "roast_batch.status"],
      })
    )?.pages[0]?.view;
    // 主实体被算成 other_entity → roast_batch.status 不再属于本页实体 → 降级
    expect(view?.kind).toBe("workbench");
  });
});
