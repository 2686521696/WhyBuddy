/**
 * flow-executor / flow-definition 单测（编排二期）。
 *
 * 执行器移植自用户 MIT 项目的拓扑排序引擎，锁五件事：
 * 拓扑序 + 端口传值、重试后成功、fail-fast、环路拒执行、条件分支跳过；
 * 投影锁：管线 → 图（端口=字段 ref）+ 手工输入推导。零网络（注入 fake runNode）。
 */
import { describe, it, expect } from "vitest";
import {
  executeFlow,
  topologicalSort,
  type FlowDefinition,
  type FlowNode,
} from "../live-runtime/flow-executor";
import { derivePipelineFlow } from "../live-runtime/flow-definition";
import type { AigcCapability } from "../system-screens/five-system-model";

const CAPS: AigcCapability[] = [
  {
    id: "cap_a",
    name: "简介生成",
    inputFields: ["course.title"],
    outputField: "course.desc",
  },
  {
    id: "cap_b",
    name: "口号生成",
    inputFields: ["course.desc", "course.title"],
    outputField: "course.slogan",
  },
];

const linearFlow = (
  variables: Record<string, unknown> = {}
): FlowDefinition => ({
  nodes: [
    { node_id: "cap_a", node_type: "aigc-capability", name: "简介生成" },
    { node_id: "cap_b", node_type: "aigc-capability", name: "口号生成" },
  ],
  edges: [
    {
      source_node_id: "cap_a",
      target_node_id: "cap_b",
      source_port: "course.desc",
      target_port: "course.desc",
    },
  ],
  variables,
});

describe("flow-executor（移植：拓扑执行引擎）", () => {
  it("拓扑序执行 + 端口传值：下游节点收到上游 outputField 产出", async () => {
    const seen: Array<{ id: string; inputs: Record<string, unknown> }> = [];
    const res = await executeFlow(
      linearFlow({ "course.title": "Python 入门" }),
      async (node, inputs) => {
        seen.push({ id: node.node_id, inputs });
        return {
          [node.node_id === "cap_a" ? "course.desc" : "course.slogan"]:
            `${node.node_id}产出`,
        };
      }
    );
    expect(res.status).toBe("completed");
    expect(seen.map(s => s.id)).toEqual(["cap_a", "cap_b"]);
    expect(seen[0].inputs["course.title"]).toBe("Python 入门"); // 无入边 → 手工变量
    expect(seen[1].inputs["course.desc"]).toBe("cap_a产出"); // 端口传值
    expect(seen[1].inputs["course.title"]).toBe("Python 入门"); // 变量补齐边未覆盖的输入
    expect(res.logs.map(l => l.status)).toEqual(["success", "success"]);
  });

  it("重试后成功：单次瞬时失败不终止链路", async () => {
    let attempts = 0;
    const res = await executeFlow(linearFlow(), async node => {
      if (node.node_id === "cap_a" && attempts++ === 0)
        throw new Error("transient");
      return { "course.desc": "ok" };
    });
    expect(res.status).toBe("completed");
    expect(attempts).toBe(2); // 失败 1 次 + 重试成功
  });

  it("fail-fast：重试仍失败 → 停止执行，不伪造下游节点", async () => {
    const ran: string[] = [];
    const statuses: Array<[string, string]> = [];
    const res = await executeFlow(
      linearFlow(),
      async node => {
        ran.push(node.node_id);
        throw new Error("LLM_GENERATE_FAILED: rate limited");
      },
      { onNodeStatus: (id, s) => statuses.push([id, s]) }
    );
    expect(res.status).toBe("failed");
    expect(ran).toEqual(["cap_a", "cap_a"]); // 原始 + 1 次重试，无 cap_b
    expect(res.logs).toHaveLength(1);
    expect(res.logs[0].status).toBe("failed");
    expect(statuses.at(-1)).toEqual(["cap_a", "failed"]);
  });

  it("环路 → 拒绝执行（拓扑排序抛错，如实返回）", async () => {
    const cyclic: FlowDefinition = {
      nodes: linearFlow().nodes,
      edges: [
        { source_node_id: "cap_a", target_node_id: "cap_b" },
        { source_node_id: "cap_b", target_node_id: "cap_a" },
      ],
    };
    expect(() => topologicalSort(cyclic)).toThrow("环路");
    const res = await executeFlow(cyclic, async () => ({}));
    expect(res.status).toBe("failed");
    expect(res.error).toContain("环路");
  });

  it("条件分支：未选中分支整链 skipped（保留原实现语义）", async () => {
    const flow: FlowDefinition = {
      nodes: [
        { node_id: "cond", node_type: "condition" },
        { node_id: "yes", node_type: "aigc-capability" },
        { node_id: "no", node_type: "aigc-capability" },
      ],
      edges: [
        { source_node_id: "cond", target_node_id: "yes", source_port: "true" },
        { source_node_id: "cond", target_node_id: "no", source_port: "false" },
      ],
    };
    const ran: string[] = [];
    const res = await executeFlow(flow, async (node: FlowNode) => {
      ran.push(node.node_id);
      return node.node_id === "cond" ? { branch: "true" } : { output: "x" };
    });
    expect(res.status).toBe("completed");
    expect(ran).toEqual(["cond", "yes"]); // no 分支未执行
    expect(res.logs.find(l => l.node_id === "no")?.status).toBe("skipped");
  });
});

describe("derivePipelineFlow（管线 → 图投影）", () => {
  it("端口 = 字段 ref；手工输入 = 全链输入减衔接字段", () => {
    const p = derivePipelineFlow({ id: "p1", steps: ["cap_a", "cap_b"] }, CAPS);
    expect(p.reason).toBeNull();
    expect(p.flow.nodes.map(n => n.node_id)).toEqual(["cap_a", "cap_b"]);
    expect(p.flow.edges).toEqual([
      {
        source_node_id: "cap_a",
        target_node_id: "cap_b",
        source_port: "course.desc",
        target_port: "course.desc",
      },
    ]);
    expect(p.manualInputRefs).toEqual(["course.title"]); // course.desc 是衔接字段
  });

  it("不足 2 步 / 步骤未解析 → reason 非空（面板禁跑，不伪造）", () => {
    expect(
      derivePipelineFlow({ id: "p", steps: ["cap_a"] }, CAPS).reason
    ).toContain("不足 2 步");
    expect(
      derivePipelineFlow({ id: "p", steps: ["cap_a", "ghost"] }, CAPS).reason
    ).toContain("未解析");
  });
});
