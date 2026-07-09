/**
 * flow-definition — 线性管线（aigc.pipelines）→ 图编排契约（FlowDefinition）投影
 * + AIGC 能力节点执行适配（编排二期）。
 *
 * 图契约与用户 MIT 项目的前后端共用 FlowDefinition 同构（nodes + 端口连边 +
 * variables）；本期图由管线派生（LLM 生成线性管线更可靠），图编辑属设计器期。
 * 端口 = 数据模型字段 ref：与门禁 handoff 校验同一规则，投影零 LLM 纯函数。
 */

import type { AigcCapability, AigcPipeline } from "../system-screens/five-system-model";
import type { FlowDefinition, FlowNode } from "./flow-executor";

export interface PipelineFlowProjection {
  flow: FlowDefinition;
  /** 首步需要人填的输入 ref（衔接字段之外） */
  manualInputRefs: string[];
  /** 派生失败原因（步骤缺失/能力未解析）；null = 可执行 */
  reason: string | null;
  /** node_id → 能力（图渲染与节点执行共用） */
  capByNodeId: Map<string, AigcCapability>;
}

export function derivePipelineFlow(
  pipeline: AigcPipeline | null | undefined,
  capabilities: AigcCapability[]
): PipelineFlowProjection {
  const capById = new Map<string, AigcCapability>();
  for (const cap of capabilities) {
    if (cap.id) capById.set(cap.id, cap);
  }
  const stepIds = (pipeline?.steps ?? []).map(String).filter(Boolean);
  const steps = stepIds.map((id) => capById.get(id)).filter((c): c is AigcCapability => Boolean(c));
  if (stepIds.length < 2 || steps.length !== stepIds.length) {
    return {
      flow: { nodes: [], edges: [], variables: {} },
      manualInputRefs: [],
      reason: stepIds.length < 2 ? "管线不足 2 步" : "管线步骤未解析到能力（门禁应已拦截）",
      capByNodeId: capById,
    };
  }

  const nodes: FlowNode[] = steps.map((cap) => ({
    node_id: cap.id!,
    node_type: "aigc-capability",
    name: cap.name || cap.id,
  }));

  // 边：上一步 outputField ⭢ 下一步同 ref 输入（端口 = 字段 ref）
  const edges = steps.slice(0, -1).map((prev, i) => ({
    source_node_id: prev.id!,
    target_node_id: steps[i + 1].id!,
    source_port: prev.outputField || "output",
    target_port: prev.outputField || "input",
  }));

  // 手工输入：全链所有输入里，减去衔接字段（由上游注入）
  const handoff = new Set(edges.map((e) => e.source_port));
  const manualInputRefs = [
    ...new Set(
      steps.flatMap((cap) => cap.inputFields ?? []).filter((ref) => !handoff.has(ref))
    ),
  ];

  return { flow: { nodes, edges, variables: {} }, manualInputRefs, reason: null, capByNodeId: capById };
}

/**
 * 节点执行适配：每个节点真跑一次 /aigc-tryrun（与单步试跑同一诚实边界）。
 * 输出以 {outputField: 产出} 记账 → 执行器按端口取值传给下游。
 * 失败抛异常（执行器负责重试/fail-fast/日志）。
 */
export function makeAigcNodeRunner(
  capByNodeId: Map<string, AigcCapability>,
  goal?: string
) {
  return async (
    node: FlowNode,
    inputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const cap = capByNodeId.get(node.node_id);
    if (!cap) throw new Error(`未知能力节点: ${node.node_id}`);
    const res = await fetch("/api/sliderule/aigc-tryrun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: {
          id: cap.id,
          name: cap.name,
          inputFields: cap.inputFields,
          outputField: cap.outputField,
        },
        inputs,
        goal,
      }),
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { ok: boolean; output?: string; code?: string; detail?: string };
    if (!body.ok) throw new Error(`${body.code ?? "UNKNOWN"}: ${body.detail ?? ""}`.slice(0, 300));
    return { [cap.outputField || "output"]: body.output ?? "" };
  };
}
