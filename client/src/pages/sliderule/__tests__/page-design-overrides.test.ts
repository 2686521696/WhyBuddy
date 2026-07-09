/**
 * page-design-overrides 纯函数测试（页面设计器一期）。
 * 锁：叠加语义（标题/列/表单/图表）、失效引用过滤（模型迭代后旧覆盖不悬挂）、
 * 无覆盖零变化、编辑计数。
 */
import { describe, it, expect } from "vitest";
import {
  applyPageDesignOverrides,
  countOverrideEdits,
  dominantEntityIdOf,
} from "../live-runtime/page-design-overrides";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "task",
        name: "任务",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "status", name: "状态", type: "enum" },
          { id: "cost", name: "成本", type: "number" },
        ],
      },
    ],
  },
  page: {
    pages: [
      {
        id: "p1",
        name: "任务管理",
        fieldBindings: ["task.title", "task.status"],
        charts: [{ id: "c0", name: "状态分布", type: "pie", dimension: "task.status", metric: "count" }],
      },
    ],
  },
};

describe("applyPageDesignOverrides", () => {
  it("无覆盖 → 原对象直返（零变化）", () => {
    expect(applyPageDesignOverrides(MODEL, {})).toBe(MODEL);
  });

  it("标题/列选择/图表整组替换全部叠加生效，且不改入参", () => {
    const out = applyPageDesignOverrides(MODEL, {
      p1: {
        title: "任务看板",
        columnFieldIds: ["status", "cost"],
        charts: [{ id: "c1", name: "成本对比", type: "bar", dimension: "task.status", metric: "sum:task.cost" }],
      },
    });
    const page = out.page!.pages![0];
    expect(page.name).toBe("任务看板");
    expect(page.fieldBindings).toEqual(["task.status", "task.cost"]);
    expect(page.charts).toEqual([
      { id: "c1", name: "成本对比", type: "bar", dimension: "task.status", metric: "sum:task.cost" },
    ]);
    // 入参不被修改
    expect(MODEL.page!.pages![0].name).toBe("任务管理");
  });

  it("失效引用被过滤：旧覆盖指向已不存在的字段不产生悬挂", () => {
    const out = applyPageDesignOverrides(MODEL, {
      p1: {
        columnFieldIds: ["status", "ghost_field"],
        charts: [
          { id: "c1", type: "bar", dimension: "task.ghost", metric: "count" }, // 维度失效 → 丢弃
          { id: "c2", type: "bar", dimension: "task.status", metric: "sum:task.ghost" }, // sum 失效 → 丢弃
          { id: "c3", type: "bar", dimension: "task.status", metric: "count" }, // 合法保留
        ],
      },
    });
    const page = out.page!.pages![0];
    expect(page.fieldBindings).toEqual(["task.status"]);
    expect(page.charts?.map((c) => c.id)).toEqual(["c3"]);
  });

  it("countOverrideEdits：按被改的面数计（不是按页计）", () => {
    expect(countOverrideEdits({})).toBe(0);
    expect(
      countOverrideEdits({
        p1: { title: "x", charts: [] },
        p2: { formFieldIds: ["a"] },
      })
    ).toBe(3);
  });

  it("dominantEntityIdOf：多数实体判定与运行时 schema 同规则", () => {
    expect(dominantEntityIdOf(["task.title", "task.status", "other.x"])).toBe("task");
    expect(dominantEntityIdOf([])).toBeNull();
  });
});
