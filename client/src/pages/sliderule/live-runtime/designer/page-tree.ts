/**
 * page-tree — 页面设计器二期：默认组件树推导 + 本地持久化。
 *
 * 设计器打开的不是空画布，而是推演产出页面的组件树投影
 * （与 app-runtime-schema 同一套推导语义：主实体、前 6 字段做列、
 * 绑定字段做表单、charts 悬挂过滤、流程页带审批进度）——
 * 用户在真实页面的基础上做设计，而不是从零搭。
 *
 * 持久化沿用本地覆盖层哲学：会话级 localStorage，按 pageId 存树，
 * 不改 Python 权威模型本体；loadPageTree 未命中时调用方回退默认推导。
 */

import type { FiveSystemModel, PageModelDef } from "../../system-screens/five-system-model";
import { createNode, type ComponentNode } from "./component-schema";
import { getComponentDefinition } from "./component-registry";
import { dominantEntityIdOf } from "../page-design-overrides";

function mustCreate(type: string): ComponentNode {
  const def = getComponentDefinition(type);
  if (!def) throw new Error(`组件类型未注册: ${type}`);
  return createNode(def);
}

/**
 * 从五系统模型的单页声明推导默认组件树：
 *   根容器 [ 图表… , 数据表格 , 分组(数据表单) , (流程页)审批进度 ]
 * 绑定全部按模型真实字段落值；无主实体页退化为提示文本节点。
 */
export function deriveDefaultPageTree(
  page: PageModelDef,
  model: FiveSystemModel
): ComponentNode {
  const root = mustCreate("container");
  root.name = page.name || page.id || "页面";
  root.props = { ...root.props, gap: 16 };

  const entities = model.datamodel?.entities ?? [];
  const entityId = dominantEntityIdOf(page.fieldBindings);
  const entity = entityId ? entities.find((e) => e.id === entityId) : undefined;

  const fieldExists = (ref: string): boolean => {
    const dot = ref.indexOf(".");
    if (dot <= 0) return false;
    const e = entities.find((x) => x.id === ref.slice(0, dot));
    return Boolean(e?.fields?.some((f) => f.id === ref.slice(dot + 1)));
  };

  // 图表（悬挂声明不进树——与运行时同一过滤规则）
  const validCharts = (page.charts ?? []).filter(
    (c) =>
      fieldExists(String(c.dimension ?? "")) &&
      (String(c.metric ?? "count") === "count" ||
        fieldExists(String(c.metric ?? "").replace(/^sum:/, "")))
  );
  if (validCharts.length > 0) {
    const row = mustCreate("columns");
    row.name = "图表区";
    for (const chart of validCharts) {
      const node = mustCreate("chart");
      node.name = chart.name || "图表";
      node.props = {
        ...node.props,
        title: chart.name || "图表",
        chartType: ["bar", "line", "pie"].includes(String(chart.type)) ? chart.type : "bar",
        dimension: chart.dimension ?? "",
        metric: chart.metric ?? "count",
      };
      row.children!.push(node);
    }
    root.children!.push(row);
  }

  if (entity) {
    // 数据表格：运行时同款默认列（前 6 字段）
    const table = mustCreate("data-table");
    table.name = `${entity.name || entity.id}表格`;
    table.props = {
      ...table.props,
      entityId: entity.id,
      columnFieldIds: (entity.fields ?? []).slice(0, 6).map((f) => f.id),
    };
    root.children!.push(table);

    // 数据表单：页面绑定字段；一个都对不上回退实体全字段（运行时同款）
    const boundIds = (page.fieldBindings ?? [])
      .filter((b) => b.startsWith(`${entity.id}.`))
      .map((b) => b.slice(entity.id.length + 1))
      .filter((fid) => (entity.fields ?? []).some((f) => f.id === fid));
    const group = mustCreate("group");
    group.name = "录入区";
    group.props = { ...group.props, title: `新增${entity.name || entity.id}` };
    const form = mustCreate("data-form");
    form.name = `${entity.name || entity.id}表单`;
    form.props = {
      ...form.props,
      entityId: entity.id,
      formFieldIds: boundIds.length > 0 ? boundIds : (entity.fields ?? []).map((f) => f.id),
    };
    group.children!.push(form);
    root.children!.push(group);
  } else {
    const hint = mustCreate("text");
    hint.props = {
      ...hint.props,
      content: "该页面未绑定主实体，可从左侧拖入组件开始设计",
      variant: "caption",
    };
    root.children!.push(hint);
  }

  // 流程联动页附审批进度（appbundle.pageBindings 声明了 workflowRef 的页面）
  const workflowLinked = (model.appbundle?.pageBindings ?? []).some(
    (b) => b.workflowRef && b.pageRef === page.id
  );
  if (workflowLinked) {
    const progress = mustCreate("approval-progress");
    root.children!.push(progress);
  }

  return root;
}

// ---------------------------------------------------------------------------
// 本地持久化（按 pageId 存设计树；与一期覆盖层同 key 空间风格）
// ---------------------------------------------------------------------------

export type PageTrees = Record<string, ComponentNode>;

const KEY_PREFIX = "sliderule:page-designer:";

export function loadPageTrees(sessionId: string): PageTrees {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    const parsed = raw ? (JSON.parse(raw) as PageTrees) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePageTrees(sessionId: string, trees: PageTrees): void {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(trees));
  } catch {
    /* 存储不可用 → 内存态仍生效 */
  }
}

export function clearPageTrees(sessionId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + sessionId);
  } catch {
    /* noop */
  }
}

/** 已做过画布设计的页面数（诚实标注"本地设计 · N 页"用） */
export function countDesignedPages(trees: PageTrees): number {
  return Object.keys(trees).length;
}
