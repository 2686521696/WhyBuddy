/**
 * flow-executor — 图编排执行器（编排二期）。
 *
 * 移植自用户的 MIT 开源项目 backend/src/ai/orchestration/executor.ts
 * （Kahn 拓扑排序 + 节点执行 + 条件分支跳过 + 重试 + 执行日志），适配点：
 * - 节点执行改为注入 runNode（SlideRule 里每个节点 = 一项 AIGC 能力，
 *   真跑走 /aigc-tryrun 单步通道）；
 * - 端口语义 = 数据模型字段 ref（与门禁 handoff 校验同一规则）：
 *   上游节点输出以 {outputField: 产出} 记账，下游经边的 port 取值；
 * - onNodeStatus 回调驱动图面实时点亮（running/success/failed/skipped）；
 * - MAX_RETRIES 降为 1（每次尝试都是真 LLM 调用，成本可感）。
 * 纯 TS、零依赖、可单测（注入 fake runNode 即零网络）。
 */

export interface FlowNode {
  node_id: string;
  node_type: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface FlowEdge {
  source_node_id: string;
  target_node_id: string;
  /** 源端口 = 上游能力的 outputField ref（缺省 "output"） */
  source_port?: string;
  /** 目标端口 = 下游能力的对应 inputField ref（缺省 "input"） */
  target_port?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 手工输入（无入边节点的初始输入，按字段 ref 键控） */
  variables?: Record<string, unknown>;
}

export type NodeRunStatus = "running" | "success" | "failed" | "skipped";

export interface NodeExecutionLog {
  node_id: string;
  node_type: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  status: "success" | "failed" | "skipped";
  error?: string;
  duration_ms?: number;
}

export interface FlowResult {
  status: "completed" | "failed";
  logs: NodeExecutionLog[];
  outputs?: Record<string, Record<string, unknown>>;
  error?: string;
}

/** 注入的节点执行函数：失败以抛异常表达（执行器负责重试与记账）。 */
export type RunNode = (
  node: FlowNode,
  inputs: Record<string, unknown>
) => Promise<Record<string, unknown>>;

const MAX_RETRIES = 1;

class FlowContext {
  readonly variables: Record<string, unknown>;
  private nodeOutputs = new Map<string, Record<string, unknown>>();

  constructor(variables: Record<string, unknown>) {
    this.variables = variables;
  }

  setNodeOutput(nodeId: string, outputs: Record<string, unknown>): void {
    this.nodeOutputs.set(nodeId, outputs);
  }

  getPortValue(nodeId: string, port: string): unknown {
    return this.nodeOutputs.get(nodeId)?.[port];
  }

  get allOutputs(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.nodeOutputs.entries());
  }
}

/** Kahn 拓扑排序；有环抛错（loop 自环跳过，与原实现一致）。 */
export function topologicalSort(flowDef: FlowDefinition): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of flowDef.nodes) {
    inDegree.set(node.node_id, 0);
    adj.set(node.node_id, []);
  }
  for (const edge of flowDef.edges) {
    if (edge.source_node_id === edge.target_node_id) continue;
    adj.get(edge.source_node_id)?.push(edge.target_node_id);
    inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    result.push(u);
    for (const v of adj.get(u) ?? []) {
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }
  if (result.length !== flowDef.nodes.length) {
    throw new Error("流程定义中存在环路，无法进行拓扑排序");
  }
  return result;
}

/** 解析节点输入：入边按端口取上游产出；无入边节点用 variables（手工输入）。 */
function resolveInputs(
  nodeId: string,
  flowDef: FlowDefinition,
  ctx: FlowContext
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const incoming = flowDef.edges.filter((e) => e.target_node_id === nodeId);
  for (const edge of incoming) {
    const value = ctx.getPortValue(edge.source_node_id, edge.source_port ?? "output");
    if (value !== undefined) {
      inputs[edge.target_port ?? "input"] = value;
    }
  }
  if (incoming.length === 0) {
    Object.assign(inputs, ctx.variables);
  } else {
    // 有入边的节点：手工变量仍可补齐边未覆盖的输入（如下游能力的第二个输入字段）
    for (const [k, v] of Object.entries(ctx.variables)) {
      if (!(k in inputs)) inputs[k] = v;
    }
  }
  return inputs;
}

/** 条件分支：未选中分支的下游整链标记 skipped（保留原实现，条件节点属后续期）。 */
function markBranchSkipped(
  condNodeId: string,
  skipPort: string,
  flowDef: FlowDefinition,
  skipped: Set<string>
): void {
  const branchEdges = flowDef.edges.filter(
    (e) => e.source_node_id === condNodeId && (skipPort === "" || e.source_port === skipPort)
  );
  for (const edge of branchEdges) {
    if (!skipped.has(edge.target_node_id)) {
      skipped.add(edge.target_node_id);
      markBranchSkipped(edge.target_node_id, "", flowDef, skipped);
    }
  }
}

export async function executeFlow(
  flowDef: FlowDefinition,
  runNode: RunNode,
  opts: {
    onNodeStatus?: (nodeId: string, status: NodeRunStatus) => void;
  } = {}
): Promise<FlowResult> {
  let order: string[];
  try {
    order = topologicalSort(flowDef);
  } catch (e) {
    return { status: "failed", logs: [], error: e instanceof Error ? e.message : String(e) };
  }

  const ctx = new FlowContext(flowDef.variables ?? {});
  const logs: NodeExecutionLog[] = [];
  const skipped = new Set<string>();

  for (const nodeId of order) {
    const nodeDef = flowDef.nodes.find((n) => n.node_id === nodeId)!;
    if (skipped.has(nodeId)) {
      logs.push({ node_id: nodeId, node_type: nodeDef.node_type, inputs: {}, status: "skipped" });
      opts.onNodeStatus?.(nodeId, "skipped");
      continue;
    }

    const inputs = resolveInputs(nodeId, flowDef, ctx);
    const start = Date.now();
    opts.onNodeStatus?.(nodeId, "running");

    let outputs: Record<string, unknown> | undefined;
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        outputs = await runNode(nodeDef, inputs);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt === MAX_RETRIES) {
          logs.push({
            node_id: nodeId,
            node_type: nodeDef.node_type,
            inputs,
            status: "failed",
            error: lastError,
            duration_ms: Date.now() - start,
          });
          opts.onNodeStatus?.(nodeId, "failed");
          // fail-fast：下游缺上游产物，跑了也是伪造（与链路试跑同语义）
          return { status: "failed", logs, error: `节点 ${nodeId} 执行失败: ${lastError}` };
        }
      }
    }

    ctx.setNodeOutput(nodeId, outputs!);
    logs.push({
      node_id: nodeId,
      node_type: nodeDef.node_type,
      inputs,
      outputs,
      status: "success",
      duration_ms: Date.now() - start,
    });
    opts.onNodeStatus?.(nodeId, "success");

    if (nodeDef.node_type === "condition" && outputs) {
      const branch = outputs.branch as "true" | "false";
      const skipBranch = branch === "true" ? "false" : "true";
      markBranchSkipped(nodeId, skipBranch, flowDef, skipped);
    }
  }

  return { status: "completed", logs, outputs: ctx.allOutputs };
}
