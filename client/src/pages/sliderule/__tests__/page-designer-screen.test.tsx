/**
 * 设计器二期 UI 静态渲染回归（renderToStaticMarkup，仓库约定不引 jsdom/RTL）。
 *
 * 锁三件事：
 *   1. 三栏范式齐活：组件面板（17 组件四分类）+ 大纲树 + 画布默认树
 *      （推演页面投影：图表/表格/表单/审批进度）+ 属性面板 + 诚实标注；
 *   2. localStorage 已有设计树 → 优先加载（不重推默认树）；
 *   3. 绑定悬挂 → 顶栏校验徽标如实报数。
 * 交互逻辑（插入/删除/移动/撤销）由 component-schema.test.ts 纯函数层锁定。
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// node 测试环境无 localStorage：内存 shim（模块加载前装好）
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import { PageDesignerScreen } from "../live-runtime/designer/PageDesignerScreen";
import {
  createNode,
  insertNode,
  updateNode,
  type ComponentNode,
} from "../live-runtime/designer/component-schema";
import { getComponentDefinition } from "../live-runtime/designer/component-registry";
import { deriveDefaultPageTree, savePageTrees, clearPageTrees } from "../live-runtime/designer/page-tree";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "course",
        name: "课程",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "price", name: "价格", type: "number" },
          { id: "status", name: "状态", type: "enum" },
        ],
      },
    ],
  },
  workflow: {
    nodes: [
      { id: "n_submit", name: "提交申请" },
      { id: "n_review", name: "审核" },
    ],
    transitions: [{ from: "n_submit", to: "n_review" }],
  },
  page: {
    pages: [
      {
        id: "page_course",
        name: "课程管理",
        fieldBindings: ["course.title", "course.price"],
        charts: [{ id: "c1", name: "状态分布", type: "pie", dimension: "course.status", metric: "count" }],
      },
    ],
  },
  appbundle: { pageBindings: [{ pageRef: "page_course", workflowRef: "wf_main" }] },
};

const render = (sessionId: string) =>
  renderToStaticMarkup(
    <PageDesignerScreen model={MODEL} pageId="page_course" sessionId={sessionId} onClose={() => {}} />
  );

describe("PageDesignerScreen 静态渲染", () => {
  beforeEach(() => memStore.clear());

  it("三栏范式：组件面板四分类 + 大纲树 + 默认树画布 + 属性面板 + 诚实标注", () => {
    const html = render("sess-default");
    // 顶栏
    expect(html).toContain("画布设计 · 课程管理");
    expect(html).toContain("本地设计层 · 不改模型本体");
    expect(html).toContain('data-testid="designer-breadcrumb"');
    // 左栏组件面板：四分类与代表组件
    for (const label of ["布局", "基础", "输入", "数据"]) expect(html).toContain(label);
    for (const type of ["container", "text", "input", "data-table", "chart", "approval-progress"]) {
      expect(html).toContain(`data-testid="palette-item-${type}"`);
    }
    // 大纲树
    expect(html).toContain('data-testid="designer-outline"');
    // 画布默认树 = 推演页面投影：图表 + 数据表格（真实字段列）+ 表单 + 审批进度
    expect(html).toContain('data-node-type="chart"');
    expect(html).toContain('data-node-type="data-table"');
    expect(html).toContain('data-node-type="data-form"');
    expect(html).toContain('data-node-type="approval-progress"');
    expect(html).toContain("标题"); // 实体字段名进了表格列
    expect(html).toContain("提交申请"); // 流程节点进了审批进度
    // 右栏属性面板（初始选中根容器）
    expect(html).toContain('data-testid="designer-props-panel"');
    // 默认树无绑定问题 → 无校验徽标
    expect(html).not.toContain('data-testid="designer-issues"');
  });

  it("localStorage 已有设计树优先加载（含用户自定义文本节点）", () => {
    const base = deriveDefaultPageTree(MODEL.page!.pages![0], MODEL);
    const text = createNode(getComponentDefinition("text")!);
    const withText = insertNode(base, base.id, text, getComponentDefinition, 0);
    if (!withText.ok) throw new Error("unreachable");
    const marked = updateNode(withText.root, text.id, { props: { content: "用户画布定制标记XYZ" } });
    if (!marked.ok) throw new Error("unreachable");
    savePageTrees("sess-saved", { page_course: marked.root });

    const html = render("sess-saved");
    expect(html).toContain("用户画布定制标记XYZ");
    clearPageTrees("sess-saved");
  });

  it("绑定悬挂 → 顶栏校验徽标如实报数", () => {
    const base = deriveDefaultPageTree(MODEL.page!.pages![0], MODEL);
    const tableId = (base.children ?? []).find((n) => n.type === "data-table")?.id;
    if (!tableId) throw new Error("默认树缺数据表格");
    const broken = updateNode(base, tableId, { props: { entityId: "ghost_entity" } });
    if (!broken.ok) throw new Error("unreachable");
    savePageTrees("sess-broken", { page_course: broken.root });

    const html = render("sess-broken");
    expect(html).toContain('data-testid="designer-issues"');
    expect(html).toContain("处绑定问题");
    clearPageTrees("sess-broken");
  });
});

// 类型面：ComponentNode 结构可被 JSON 序列化承载（localStorage 契约）
it("ComponentNode 序列化 round-trip", () => {
  const tree = deriveDefaultPageTree(MODEL.page!.pages![0], MODEL);
  const back = JSON.parse(JSON.stringify(tree)) as ComponentNode;
  expect(back.type).toBe("container");
  expect((back.children ?? []).length).toBeGreaterThan(0);
});
