/**
 * flow-design — AIGC 编排三期：自由画布的设计数据层（纯函数 + localStorage）。
 *
 * 对标用户 MIT 项目 web-aigc 的编排设计器（节点面板 + 图画布 + 属性面板），
 * SlideRule 适配三原则：
 *   1. 节点 = 模型声明的 AIGC 能力（+ 条件节点）——不是自由文本节点，
 *      画布上的每个节点都锚在五系统模型上；
 *   2. 连线校验 = 门禁 handoff 同款规则（源能力 outputField ∈ 目标能力
 *      inputFields），非法连线在 onConnect 就被拒——防呆在源头；
 *   3. 设计存本地层（会话级 localStorage，与页面设计覆盖同哲学），
 *      不改推演产出的模型本体；执行走已移植的 FlowExecutor。
 */

import type { AigcCapability } from "../system-screens/five-system-model";
import type { FlowDefinition } from "./flow-executor";

/** 画布节点：能力实例或条件节点（同一能力可摆多个实例） */
export interface DesignNode {
  id: string;
  /** "capability" | "condition" */
  kind: "capability" | "condition";
  /** kind=capability 时指向模型能力 id */
  capabilityId?: string;
  /** kind=condition 时的判断配置 */
  condition?: ConditionConfig;
  position: { x: number; y: number };
}

/** 条件节点配置：对某输入 ref 的产出做包含/等值判断（本地求值，零 LLM） */
export interface ConditionConfig {
  /** 参与判断的输入 ref（上游产出注入的字段） */
  inputRef?: string;
  /** contains | equals | nonempty */
  operator?: "contains" | "equals" | "nonempty";
  value?: string;
}

export interface DesignEdge {
  id: string;
  source: string;
  target: string;
  /** 能力节点出边 = outputField ref；条件节点出边 = "true" | "false" */
  sourcePort?: string;
  targetPort?: string;
}

export interface FlowDesign {
  id: string;
  name: string;
  nodes: DesignNode[];
  edges: DesignEdge[];
}

const KEY_PREFIX = "sliderule:aigc-flow-design:";

export function loadFlowDesign(sessionId: string): FlowDesign | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    return raw ? (JSON.parse(raw) as FlowDesign) : null;
  } catch {
    return null;
  }
}

export function saveFlowDesign(sessionId: string, design: FlowDesign): void {
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(design));
  } catch {
    /* 存储不可用 → 内存态仍生效 */
  }
}

export function clearFlowDesign(sessionId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + sessionId);
  } catch {
    /* noop */
  }
}

/** 连线合法性：门禁 handoff 同款规则（+ 条件节点的分支语义）。 */
export function canConnect(
  source: DesignNode,
  target: DesignNode,
  capById: Map<string, AigcCapability>
): { ok: boolean; port?: string; reason?: string } {
  if (source.id === target.id) return { ok: false, reason: "不能连接自身" };
  // 条件节点出边：true/false 分支，目标任意（分支语义由端口表达）
  if (source.kind === "condition") return { ok: true };
  const sourceCap = source.capabilityId ? capById.get(source.capabilityId) : undefined;
  if (!sourceCap) return { ok: false, reason: "源节点未解析到能力" };
  const out = sourceCap.outputField ?? "";
  if (!out) return { ok: false, reason: "源能力未声明输出字段" };
  if (target.kind === "condition") {
    // 进条件节点：任何产出都可作为判断输入
    return { ok: true, port: out };
  }
  const targetCap = target.capabilityId ? capById.get(target.capabilityId) : undefined;
  if (!targetCap) return { ok: false, reason: "目标节点未解析到能力" };
  if (!(targetCap.inputFields ?? []).includes(out)) {
    return {
      ok: false,
      reason: `字段衔接断裂：源输出 ${out} 不在目标输入 [${(targetCap.inputFields ?? []).join(", ")}] 中`,
    };
  }
  return { ok: true, port: out };
}

/** 画布设计 → 执行器契约（FlowDefinition）。条件节点 node_type="condition"。 */
export function designToFlowDefinition(
  design: FlowDesign,
  variables: Record<string, unknown> = {}
): FlowDefinition {
  return {
    nodes: design.nodes.map((n) => ({
      node_id: n.id,
      node_type: n.kind === "condition" ? "condition" : "aigc-capability",
      name: n.kind === "condition" ? "条件判断" : n.capabilityId,
      config: n.kind === "condition" ? { ...n.condition } : { capabilityId: n.capabilityId },
    })),
    edges: design.edges.map((e) => ({
      source_node_id: e.source,
      target_node_id: e.target,
      source_port: e.sourcePort,
      target_port: e.targetPort ?? e.sourcePort,
    })),
    variables,
  };
}

/** 条件求值（本地零 LLM）：对注入的输入做 contains/equals/nonempty 判断。 */
export function evalCondition(
  config: ConditionConfig | undefined,
  inputs: Record<string, unknown>
): "true" | "false" {
  const ref = config?.inputRef ?? "";
  const raw = ref ? inputs[ref] : Object.values(inputs)[0];
  const text = raw === undefined || raw === null ? "" : String(raw);
  switch (config?.operator ?? "nonempty") {
    case "contains":
      return text.includes(config?.value ?? "") ? "true" : "false";
    case "equals":
      return text === (config?.value ?? "") ? "true" : "false";
    case "nonempty":
    default:
      return text.trim() ? "true" : "false";
  }
}

/** 画布设计的手工输入推导：能力节点全部输入 − 被入边覆盖的端口。 */
export function designManualInputRefs(
  design: FlowDesign,
  capById: Map<string, AigcCapability>
): string[] {
  const covered = new Set<string>();
  for (const e of design.edges) {
    if (e.targetPort) covered.add(`${e.target}:${e.targetPort}`);
  }
  const refs = new Set<string>();
  for (const n of design.nodes) {
    if (n.kind !== "capability") continue;
    const cap = n.capabilityId ? capById.get(n.capabilityId) : undefined;
    for (const ref of cap?.inputFields ?? []) {
      if (!covered.has(`${n.id}:${ref}`)) refs.add(ref);
    }
  }
  return [...refs];
}
