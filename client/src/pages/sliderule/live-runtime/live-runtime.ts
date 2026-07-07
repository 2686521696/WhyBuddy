/**
 * live-runtime — 浏览器运行时内核（"像 ECharts 一样渲染系统"）。
 *
 * 五系统模型（gate 通过的 JSON）→ 可操作的运行时状态：
 *   - entities: 每实体一组内存行（动态表的浏览器版）
 *   - instances: 审批流程实例（沿 workflow.transitions 推进的状态机）
 *
 * 执行语义参考 rbac-backend 引擎的已验证实现（workflowEngine.moveToNextNode /
 * dynamicDataService），但零数据库、零服务：状态就是 JSON，持久化走会话存档。
 * 诚实边界：不做会签/或签百分比、子流程、自动节点外呼——排练运行时以
 * "业务闭环可走通"为目标，不冒充企业级完备。
 *
 * 纯函数模块：所有变更返回新对象，无副作用，便于单测与撤销。
 */

import type { FiveSystemModel, WorkflowTransition } from "../system-screens/five-system-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuntimeRow = {
  id: string;
  values: Record<string, unknown>;
  createdAt: string;
};

export interface WorkflowInstanceLog {
  at: string;
  nodeId: string;
  action: "start" | "approve" | "reject" | "complete";
  byRole?: string;
  note?: string;
}

export interface WorkflowInstance {
  id: string;
  title: string;
  /** 当前停留节点；终态后保留最后节点 */
  currentNodeId: string;
  status: "running" | "completed" | "rejected";
  /** 关联的实体行（Page 提交联动时使用，可空） */
  entityRef?: { entityId: string; rowId: string };
  log: WorkflowInstanceLog[];
}

export interface RuntimeState {
  /** entityId → rows */
  entities: Record<string, RuntimeRow[]>;
  instances: WorkflowInstance[];
  /** 单调递增，生成稳定 id 用（避免 Date.now 依赖注入烦恼仍需时间戳时由调用方传入） */
  seq: number;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initRuntimeState(model: FiveSystemModel | null | undefined): RuntimeState {
  const entities: Record<string, RuntimeRow[]> = {};
  for (const entity of model?.datamodel?.entities ?? []) {
    if (entity.id) entities[entity.id] = [];
  }
  return { entities, instances: [], seq: 0 };
}

// ---------------------------------------------------------------------------
// 行 CRUD（动态表的浏览器版）
// ---------------------------------------------------------------------------

export function addRow(
  state: RuntimeState,
  entityId: string,
  values: Record<string, unknown>,
  now: string
): { state: RuntimeState; row: RuntimeRow } {
  const seq = state.seq + 1;
  const row: RuntimeRow = { id: `row-${seq}`, values, createdAt: now };
  const rows = [...(state.entities[entityId] ?? []), row];
  return {
    state: { ...state, seq, entities: { ...state.entities, [entityId]: rows } },
    row,
  };
}

export function updateRow(
  state: RuntimeState,
  entityId: string,
  rowId: string,
  values: Record<string, unknown>
): RuntimeState {
  const rows = (state.entities[entityId] ?? []).map((r) =>
    r.id === rowId ? { ...r, values: { ...r.values, ...values } } : r
  );
  return { ...state, entities: { ...state.entities, [entityId]: rows } };
}

export function deleteRow(state: RuntimeState, entityId: string, rowId: string): RuntimeState {
  const rows = (state.entities[entityId] ?? []).filter((r) => r.id !== rowId);
  return { ...state, entities: { ...state.entities, [entityId]: rows } };
}

/** 必填/类型的轻校验（语义参考 dynamicDataService 的 validation 接入点）。 */
export function validateRowValues(
  model: FiveSystemModel | null | undefined,
  entityId: string,
  values: Record<string, unknown>
): string[] {
  const entity = (model?.datamodel?.entities ?? []).find((e) => e.id === entityId);
  const problems: string[] = [];
  for (const field of entity?.fields ?? []) {
    const v = values[field.id];
    if (field.type === "number" && v !== undefined && v !== "" && Number.isNaN(Number(v))) {
      problems.push(`${field.name || field.id} 应为数字`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 审批状态机（语义对齐 workflowEngine.moveToNextNode）
// ---------------------------------------------------------------------------

/** 流程起点：没有任何入边的节点（多个则取模型顺序第一个）。 */
export function startNodeId(model: FiveSystemModel | null | undefined): string | null {
  const nodes = model?.workflow?.nodes ?? [];
  if (nodes.length === 0) return null;
  const hasInbound = new Set((model?.workflow?.transitions ?? []).map((t) => t.to));
  return nodes.find((n) => !hasInbound.has(n.id))?.id ?? nodes[0].id;
}

/** 当前节点的出边（分支时由 UI 给用户选择）。 */
export function outgoingTransitions(
  model: FiveSystemModel | null | undefined,
  nodeId: string
): WorkflowTransition[] {
  return (model?.workflow?.transitions ?? []).filter((t) => t.from === nodeId);
}

export function nodeById(model: FiveSystemModel | null | undefined, nodeId: string) {
  return (model?.workflow?.nodes ?? []).find((n) => n.id === nodeId) ?? null;
}

export function startInstance(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  title: string,
  now: string,
  entityRef?: WorkflowInstance["entityRef"]
): { state: RuntimeState; instance: WorkflowInstance | null } {
  const start = startNodeId(model);
  if (!start) return { state, instance: null };
  const seq = state.seq + 1;
  const instance: WorkflowInstance = {
    id: `inst-${seq}`,
    title,
    currentNodeId: start,
    status: "running",
    entityRef,
    log: [{ at: now, nodeId: start, action: "start" }],
  };
  return {
    state: { ...state, seq, instances: [...state.instances, instance] },
    instance,
  };
}

/**
 * 推进实例：approve 沿出边走（多出边必须指定 viaTransition 下标，UI 负责让用户选）；
 * 无出边即 completed。reject 直接终态 rejected（对齐引擎语义：reject 即终态）。
 */
export function advanceInstance(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  instanceId: string,
  action: "approve" | "reject",
  now: string,
  opts: { byRole?: string; viaTransitionIndex?: number } = {}
): { state: RuntimeState; error?: string } {
  const idx = state.instances.findIndex((i) => i.id === instanceId);
  if (idx < 0) return { state, error: "实例不存在" };
  const instance = state.instances[idx];
  if (instance.status !== "running") return { state, error: "实例已终态" };

  const log = [...instance.log];
  let next: WorkflowInstance;

  if (action === "reject") {
    log.push({ at: now, nodeId: instance.currentNodeId, action: "reject", byRole: opts.byRole });
    next = { ...instance, status: "rejected", log };
  } else {
    const outs = outgoingTransitions(model, instance.currentNodeId);
    log.push({ at: now, nodeId: instance.currentNodeId, action: "approve", byRole: opts.byRole });
    if (outs.length === 0) {
      log.push({ at: now, nodeId: instance.currentNodeId, action: "complete" });
      next = { ...instance, status: "completed", log };
    } else {
      const chosen =
        outs.length === 1 ? outs[0] : outs[opts.viaTransitionIndex ?? -1];
      if (!chosen) return { state, error: "存在分支，需要选择走向" };
      next = { ...instance, currentNodeId: chosen.to, log };
    }
  }

  const instances = [...state.instances];
  instances[idx] = next;
  return { state: { ...state, instances } };
}
