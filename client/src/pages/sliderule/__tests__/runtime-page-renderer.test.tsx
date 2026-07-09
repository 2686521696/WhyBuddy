/**
 * 设计树运行时渲染回归（renderToStaticMarkup）。
 *
 * 锁：数据表格出真实行数据（不是设计态示例行）、数据表单按绑定字段
 * 铺控件、审批进度显示最近实例的真实位置与状态、hidden 节点不渲染、
 * 图表卡走懒加载（静态渲染出 fallback，选项构建由 build-echarts-option
 * 单测锁定）。事件动作（打开页面/发起审批）是回调注入，纯逻辑在
 * AppRuntimeScreen 的管线里复用既有 addRow/startInstance——此处锁渲染面。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RuntimePageRenderer } from "../live-runtime/designer/RuntimePageRenderer";
import type { ComponentNode } from "../live-runtime/designer/component-schema";
import type { RuntimeState } from "../live-runtime/live-runtime";
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
      { id: "n_done", name: "归档" },
    ],
    transitions: [
      { from: "n_submit", to: "n_review" },
      { from: "n_review", to: "n_done" },
    ],
  },
  page: { pages: [{ id: "page_course", name: "课程管理", fieldBindings: ["course.title"] }] },
};

const STATE: RuntimeState = {
  entities: {
    course: [
      { id: "r1", createdAt: "2026-07-09T00:00:00Z", values: { title: "Python 入门实战", price: 199, status: "上架" } },
      { id: "r2", createdAt: "2026-07-09T00:00:00Z", values: { title: "AI 音乐制作", price: 299, status: "审核中" } },
    ],
  },
  instances: [
    {
      id: "inst-1",
      title: "课程管理 · 画布发起",
      currentNodeId: "n_review",
      status: "running",
      log: [],
    },
  ],
  seq: 3,
};

const node = (partial: Partial<ComponentNode> & { type: string }): ComponentNode => ({
  id: `n_${partial.type}_${Math.random().toString(36).slice(2, 6)}`,
  props: {},
  ...partial,
});

const TREE: ComponentNode = node({
  type: "container",
  props: { gap: 12 },
  children: [
    node({ type: "text", props: { content: "画布页标题", variant: "title" } }),
    node({
      type: "data-table",
      props: { entityId: "course", columnFieldIds: ["title", "price"], pageSize: 5 },
    }),
    node({
      type: "data-form",
      props: { entityId: "course", formFieldIds: ["title", "price"], submitLabel: "登记课程" },
    }),
    node({
      type: "chart",
      props: { title: "状态分布", chartType: "pie", dimension: "course.status", metric: "count" },
    }),
    node({ type: "approval-progress", props: { title: "上架审批" } }),
    node({
      type: "button",
      props: { label: "去详情页", buttonType: "primary", actionKind: "openPage", actionPageId: "page_course" },
    }),
    node({ type: "text", props: { content: "被隐藏的内容不该出现" }, hidden: true }),
  ],
});

const CTX = {
  model: MODEL,
  state: STATE,
  onAddRow: () => true,
  onOpenPage: () => {},
  onStartApproval: () => {},
};

describe("RuntimePageRenderer", () => {
  it("数据组件出真数据：表格行值/表单字段/审批实例位置；hidden 不渲染", () => {
    const html = renderToStaticMarkup(<RuntimePageRenderer tree={TREE} ctx={CTX} />);
    expect(html).toContain('data-testid="runtime-designed-page"');
    expect(html).toContain("画布页标题");
    // 表格：真实行数据（两行）
    expect(html).toContain("Python 入门实战");
    expect(html).toContain("AI 音乐制作");
    // 表单：绑定字段 + 自定义提交文案
    expect(html).toContain("登记课程");
    // 审批进度：实例标题 + 真实状态 + 流程节点名
    expect(html).toContain("课程管理 · 画布发起");
    expect(html).toContain("进行中");
    expect(html).toContain("审核");
    // 图表卡（懒加载 → 静态渲染出 fallback）
    expect(html).toContain("状态分布");
    // 事件按钮
    expect(html).toContain("去详情页");
    // hidden 节点不渲染
    expect(html).not.toContain("被隐藏的内容不该出现");
  });

  it("空绑定诚实降级：未绑实体的表格/表单给指引文案而非假数据", () => {
    const bare: ComponentNode = node({
      type: "container",
      children: [node({ type: "data-table" }), node({ type: "data-form" })],
    });
    const html = renderToStaticMarkup(<RuntimePageRenderer tree={bare} ctx={CTX} />);
    expect(html).toContain("数据表格未绑定实体/列");
    expect(html).toContain("数据表单未绑定实体/字段");
    expect(html).not.toContain("Python 入门实战");
  });
});
