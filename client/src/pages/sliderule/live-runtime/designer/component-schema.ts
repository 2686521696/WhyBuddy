/**
 * component-schema — 页面设计器二期：递归组件树的数据层（纯函数）。
 *
 * 范式对标用户 MIT 项目 web-designer（src/types/component.d.ts）：
 *   ComponentSchema 递归树 + ComponentDefinition（category / isContainer /
 *   allowedChildren / defaultProps / propsSchema）驱动组件面板与属性面板。
 *
 * SlideRule 适配三原则（与一期覆盖层、编排画布同哲学）：
 *   1. 数据组件（数据表格/数据表单/图表/审批进度）锚在五系统模型上——
 *      绑定属性只指向真实存在的实体/字段/页面/流程，validateTree 可查悬挂；
 *   2. 树是本地设计层（会话级 localStorage），不改推演产出的模型本体；
 *   3. 全部树操作是纯函数（入参不变、返回新树），供撤销重做栈直接落历史。
 */

import type { FiveSystemModel, PageModelDef } from "../../system-screens/five-system-model";

// ---------------------------------------------------------------------------
// 树节点与组件定义
// ---------------------------------------------------------------------------

/** 画布上的组件实例节点（递归树） */
export interface ComponentNode {
  id: string;
  /** 注册表里的组件类型标识（如 "data-table"） */
  type: string;
  /** 实例显示名（大纲树用；缺省取定义名） */
  name?: string;
  /** 组件属性（键由该类型的 propsSchema 声明） */
  props: Record<string, unknown>;
  /** 子节点（仅容器组件持有） */
  children?: ComponentNode[];
  hidden?: boolean;
  locked?: boolean;
}

/** 属性面板控件类型：前 6 种通用，后 4 种数据感知（选项来自五系统模型） */
export type PropertyType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "entitySelect" // 选实体（datamodel.entities）
  | "fieldRefSelect" // 选全量字段 ref（"entity.field"）
  | "fieldIdMultiSelect" // 在 entityKey 指向的实体内多选字段 id
  | "metricSelect" // 图表指标：count | sum:<数值字段 ref>
  | "pageSelect"; // 选页面（page.pages，事件动作用）

export interface PropertySchema {
  key: string;
  label: string;
  type: PropertyType;
  defaultValue?: unknown;
  /** type=select 的静态选项 */
  options?: Array<{ value: string; label: string }>;
  /** type=fieldIdMultiSelect 时：实体 id 存在哪个 props 键上 */
  entityKey?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  tooltip?: string;
  /** 条件显示：所列 props 键等于指定值时才出现 */
  showWhen?: Record<string, unknown>;
}

export type ComponentCategory = "layout" | "basic" | "input" | "data";

export interface ComponentDefinition {
  type: string;
  name: string;
  category: ComponentCategory;
  /** @ant-design/icons 组件名（组件面板/大纲树用） */
  icon: string;
  description?: string;
  isContainer: boolean;
  /** 允许的子组件类型；undefined = 任意（仅容器组件生效） */
  allowedChildren?: string[];
  defaultProps: Record<string, unknown>;
  propsSchema: PropertySchema[];
}

// ---------------------------------------------------------------------------
// 节点构造
// ---------------------------------------------------------------------------

let nodeSeq = 0;

/** 生成节点 id：类型前缀 + 自增序 + 随机尾（同类型可摆多实例，跨会话不求全局唯一） */
export function nextNodeId(type: string): string {
  nodeSeq += 1;
  return `n_${type}_${nodeSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createNode(def: ComponentDefinition): ComponentNode {
  const node: ComponentNode = {
    id: nextNodeId(def.type),
    type: def.type,
    props: JSON.parse(JSON.stringify(def.defaultProps)) as Record<string, unknown>,
  };
  if (def.isContainer) node.children = [];
  return node;
}

// ---------------------------------------------------------------------------
// 树查询（只读）
// ---------------------------------------------------------------------------

export function findNode(root: ComponentNode, id: string): ComponentNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** 根到目标的节点路径（含两端）；未找到返回 null。面包屑用。 */
export function nodePath(root: ComponentNode, id: string): ComponentNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children ?? []) {
    const sub = nodePath(child, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

export function findParent(root: ComponentNode, id: string): ComponentNode | null {
  const path = nodePath(root, id);
  return path && path.length >= 2 ? path[path.length - 2] : null;
}

export function countNodes(root: ComponentNode): number {
  return 1 + (root.children ?? []).reduce((n, c) => n + countNodes(c), 0);
}

/** id 是否在 ancestorId 的子树内（防"移进自己后代"成环） */
export function isDescendant(root: ComponentNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId);
  return ancestor ? findNode(ancestor, id) !== null : false;
}

// ---------------------------------------------------------------------------
// 容器规则
// ---------------------------------------------------------------------------

export type TreeOpResult = { ok: true; root: ComponentNode } | { ok: false; reason: string };

/** 拖放合法性：目标必须是容器，且子类型在 allowedChildren 白名单内（若声明） */
export function canDropInto(
  parentDef: ComponentDefinition | undefined,
  childType: string
): { ok: boolean; reason?: string } {
  if (!parentDef) return { ok: false, reason: "目标组件类型未注册" };
  if (!parentDef.isContainer) return { ok: false, reason: `「${parentDef.name}」不是容器组件` };
  if (parentDef.allowedChildren && !parentDef.allowedChildren.includes(childType)) {
    return { ok: false, reason: `「${parentDef.name}」只接受：${parentDef.allowedChildren.join("、")}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 树变更（纯函数：返回新树，入参不动——撤销重做栈直接存前后快照）
// ---------------------------------------------------------------------------

function cloneTree(root: ComponentNode): ComponentNode {
  return JSON.parse(JSON.stringify(root)) as ComponentNode;
}

/** 在 parentId 的 children[index] 处插入节点（index 缺省追加到末尾） */
export function insertNode(
  root: ComponentNode,
  parentId: string,
  node: ComponentNode,
  getDef: (type: string) => ComponentDefinition | undefined,
  index?: number
): TreeOpResult {
  const next = cloneTree(root);
  const parent = findNode(next, parentId);
  if (!parent) return { ok: false, reason: "父节点不存在" };
  const drop = canDropInto(getDef(parent.type), node.type);
  if (!drop.ok) return { ok: false, reason: drop.reason ?? "不允许放入" };
  const children = parent.children ?? (parent.children = []);
  const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
  children.splice(at, 0, node);
  return { ok: true, root: next };
}

export function removeNode(root: ComponentNode, id: string): TreeOpResult {
  if (root.id === id) return { ok: false, reason: "根容器不可删除" };
  const next = cloneTree(root);
  const parent = findParent(next, id);
  if (!parent?.children) return { ok: false, reason: "节点不存在" };
  parent.children = parent.children.filter((c) => c.id !== id);
  return { ok: true, root: next };
}

/** 移动节点到 newParentId 的 index 位（拖拽排序/换容器共用） */
export function moveNode(
  root: ComponentNode,
  id: string,
  newParentId: string,
  getDef: (type: string) => ComponentDefinition | undefined,
  index?: number
): TreeOpResult {
  if (id === newParentId) return { ok: false, reason: "不能移入自身" };
  if (root.id === id) return { ok: false, reason: "根容器不可移动" };
  if (isDescendant(root, id, newParentId)) return { ok: false, reason: "不能移入自己的后代" };
  const moving = findNode(root, id);
  if (!moving) return { ok: false, reason: "节点不存在" };
  const removed = removeNode(root, id);
  if (!removed.ok) return removed;
  return insertNode(removed.root, newParentId, cloneTree(moving), getDef, index);
}

/** 局部更新节点 props（浅合并）与实例名/隐藏/锁定标记 */
export function updateNode(
  root: ComponentNode,
  id: string,
  patch: { props?: Record<string, unknown>; name?: string; hidden?: boolean; locked?: boolean }
): TreeOpResult {
  const next = cloneTree(root);
  const node = findNode(next, id);
  if (!node) return { ok: false, reason: "节点不存在" };
  if (patch.props) node.props = { ...node.props, ...patch.props };
  if (patch.name !== undefined) node.name = patch.name;
  if (patch.hidden !== undefined) node.hidden = patch.hidden;
  if (patch.locked !== undefined) node.locked = patch.locked;
  return { ok: true, root: next };
}

/** 复制子树（悬浮工具条"复制"）：深拷贝 + 全子树重发 id，插到原节点后面 */
export function duplicateNode(root: ComponentNode, id: string): TreeOpResult {
  if (root.id === id) return { ok: false, reason: "根容器不可复制" };
  const next = cloneTree(root);
  const parent = findParent(next, id);
  const source = findNode(next, id);
  if (!parent?.children || !source) return { ok: false, reason: "节点不存在" };
  const copy = cloneTree(source);
  const reId = (n: ComponentNode): void => {
    n.id = nextNodeId(n.type);
    (n.children ?? []).forEach(reId);
  };
  reId(copy);
  const at = parent.children.findIndex((c) => c.id === id);
  parent.children.splice(at + 1, 0, copy);
  return { ok: true, root: next };
}

// ---------------------------------------------------------------------------
// 模型级校验（数据组件绑定必须解析——与门禁悬挂引用语义一致）
// ---------------------------------------------------------------------------

export interface TreeIssue {
  nodeId: string;
  message: string;
}

function fieldRefExists(model: FiveSystemModel, ref: string): boolean {
  const dot = ref.indexOf(".");
  if (dot <= 0) return false;
  const entity = (model.datamodel?.entities ?? []).find((e) => e.id === ref.slice(0, dot));
  return Boolean(entity?.fields?.some((f) => f.id === ref.slice(dot + 1)));
}

function entityExists(model: FiveSystemModel, entityId: string): boolean {
  return (model.datamodel?.entities ?? []).some((e) => e.id === entityId);
}

function pageExists(model: FiveSystemModel, pageId: string): boolean {
  return (model.page?.pages ?? []).some((p) => p.id === pageId);
}

/**
 * 遍历树查问题：未注册类型、容器白名单越界、数据绑定悬挂。
 * 只报不改——设计器 UI 决定如何呈现（标红/禁用），渲染层决定如何降级。
 */
export function validateTree(
  root: ComponentNode,
  model: FiveSystemModel,
  getDef: (type: string) => ComponentDefinition | undefined
): TreeIssue[] {
  const issues: TreeIssue[] = [];
  const walk = (node: ComponentNode, parentDef?: ComponentDefinition): void => {
    const def = getDef(node.type);
    if (!def) {
      issues.push({ nodeId: node.id, message: `组件类型「${node.type}」未注册` });
      return;
    }
    if (parentDef?.allowedChildren && !parentDef.allowedChildren.includes(node.type)) {
      issues.push({
        nodeId: node.id,
        message: `「${def.name}」不允许放在「${parentDef.name}」内`,
      });
    }

    // 数据绑定悬挂检查（按类型的绑定语义逐一核对模型）
    const p = node.props;
    const entityId = typeof p.entityId === "string" ? p.entityId : "";
    if ((node.type === "data-table" || node.type === "data-form") && entityId) {
      if (!entityExists(model, entityId)) {
        issues.push({ nodeId: node.id, message: `绑定实体「${entityId}」不存在` });
      } else {
        const key = node.type === "data-table" ? "columnFieldIds" : "formFieldIds";
        for (const fid of (p[key] as string[] | undefined) ?? []) {
          if (!fieldRefExists(model, `${entityId}.${fid}`)) {
            issues.push({ nodeId: node.id, message: `绑定字段「${entityId}.${fid}」不存在` });
          }
        }
      }
    }
    if (node.type === "chart") {
      const dimension = typeof p.dimension === "string" ? p.dimension : "";
      const metric = typeof p.metric === "string" ? p.metric : "count";
      if (dimension && !fieldRefExists(model, dimension)) {
        issues.push({ nodeId: node.id, message: `图表维度「${dimension}」不存在` });
      }
      if (metric !== "count" && !fieldRefExists(model, metric.replace(/^sum:/, ""))) {
        issues.push({ nodeId: node.id, message: `图表指标「${metric}」不可解析` });
      }
    }
    if (node.type === "button" || node.type === "link-block") {
      const kind = typeof p.actionKind === "string" ? p.actionKind : "none";
      const pageId = typeof p.actionPageId === "string" ? p.actionPageId : "";
      if (kind === "openPage" && pageId && !pageExists(model, pageId)) {
        issues.push({ nodeId: node.id, message: `跳转页面「${pageId}」不存在` });
      }
    }

    (node.children ?? []).forEach((c) => walk(c, def));
  };
  walk(root);
  return issues;
}

// ---------------------------------------------------------------------------
// 撤销重做（HistoryManager 移植，简化为快照栈——树本身就是可序列化状态）
// ---------------------------------------------------------------------------

export class TreeHistory {
  private undoStack: ComponentNode[] = [];
  private redoStack: ComponentNode[] = [];
  private readonly limit: number;

  constructor(limit = 50) {
    this.limit = limit;
  }

  /** 每次变更前记录旧树（变更后的新树由调用方持有为当前态） */
  record(before: ComponentNode): void {
    this.undoStack.push(cloneTree(before));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 撤销：传入当前树，返回上一个快照（当前树进重做栈） */
  undo(current: ComponentNode): ComponentNode | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneTree(current));
    return prev;
  }

  redo(current: ComponentNode): ComponentNode | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneTree(current));
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

// re-export 给注册表/推导层共用（避免各文件重复实现 ref 解析）
export { fieldRefExists as designerFieldRefExists };
export type { PageModelDef };
