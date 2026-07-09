/**
 * flow-design 纯函数测试（编排三期自由画布的数据层）。
 * 锁：连线校验（门禁 handoff 同款规则 + 条件节点分支语义）、
 * 设计 → 执行器契约转换、条件本地求值、手工输入推导。
 */
import { describe, it, expect } from "vitest";
import {
  canConnect,
  designToFlowDefinition,
  designManualInputRefs,
  evalCondition,
  type DesignNode,
  type FlowDesign,
} from "../live-runtime/flow-design";
import type { AigcCapability } from "../system-screens/five-system-model";

const CAPS: AigcCapability[] = [
  { id: "cap_a", name: "简介生成", inputFields: ["course.title"], outputField: "course.desc" },
  { id: "cap_b", name: "口号生成", inputFields: ["course.desc"], outputField: "course.slogan" },
  { id: "cap_c", name: "无关能力", inputFields: ["other.x"], outputField: "other.y" },
];
const capById = new Map(CAPS.map((c) => [c.id!, c]));

const node = (id: string, capabilityId?: string): DesignNode =>
  capabilityId
    ? { id, kind: "capability", capabilityId, position: { x: 0, y: 0 } }
    : { id, kind: "condition", condition: { operator: "nonempty" }, position: { x: 0, y: 0 } };

describe("canConnect（连线即校验）", () => {
  it("字段衔接成立 → 允许并给出端口；断裂 → 拒绝并给原因", () => {
    const ok = canConnect(node("n1", "cap_a"), node("n2", "cap_b"), capById);
    expect(ok).toEqual({ ok: true, port: "course.desc" });
    const bad = canConnect(node("n1", "cap_a"), node("n3", "cap_c"), capById);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain("字段衔接断裂");
  });

  it("条件节点：出边任意（分支语义在端口）；入边接受任何产出", () => {
    expect(canConnect(node("c1"), node("n2", "cap_b"), capById).ok).toBe(true);
    expect(canConnect(node("n1", "cap_a"), node("c1"), capById)).toEqual({
      ok: true,
      port: "course.desc",
    });
  });

  it("自连拒绝", () => {
    expect(canConnect(node("n1", "cap_a"), node("n1", "cap_a"), capById).ok).toBe(false);
  });
});

describe("designToFlowDefinition + 执行语义", () => {
  const design: FlowDesign = {
    id: "d1",
    name: "测试画布",
    nodes: [node("n1", "cap_a"), node("c1"), node("n2", "cap_b")],
    edges: [
      { id: "e1", source: "n1", target: "c1", sourcePort: "course.desc", targetPort: "course.desc" },
      { id: "e2", source: "c1", target: "n2", sourcePort: "true", targetPort: "true" },
    ],
  };

  it("节点/边/变量映射到执行器契约；条件节点 node_type=condition", () => {
    const flow = designToFlowDefinition(design, { "course.title": "Python" });
    expect(flow.nodes.map((n) => n.node_type)).toEqual([
      "aigc-capability",
      "condition",
      "aigc-capability",
    ]);
    expect(flow.edges[0]).toMatchObject({ source_node_id: "n1", source_port: "course.desc" });
    expect(flow.variables).toEqual({ "course.title": "Python" });
  });

  it("evalCondition：nonempty/contains/equals 三种算子本地求值", () => {
    expect(evalCondition({ operator: "nonempty" }, { x: "有内容" })).toBe("true");
    expect(evalCondition({ operator: "nonempty" }, { x: "  " })).toBe("false");
    expect(evalCondition({ operator: "contains", value: "风险", inputRef: "r" }, { r: "存在风险点" })).toBe("true");
    expect(evalCondition({ operator: "contains", value: "风险", inputRef: "r" }, { r: "一切正常" })).toBe("false");
    expect(evalCondition({ operator: "equals", value: "是", inputRef: "r" }, { r: "是" })).toBe("true");
  });

  it("designManualInputRefs：被入边覆盖的输入不需要人填", () => {
    // n1 的 course.title 无入边 → 手工；n2 的 course.desc 经条件链路注入？
    // 注意：c1→n2 的端口是 "true" 分支标记，不覆盖 course.desc → 如实要求手填
    const refs = designManualInputRefs(design, capById);
    expect(refs).toContain("course.title");
    expect(refs).toContain("course.desc");
    // 直连时 course.desc 被覆盖
    const direct: FlowDesign = {
      ...design,
      nodes: [node("n1", "cap_a"), node("n2", "cap_b")],
      edges: [{ id: "e1", source: "n1", target: "n2", sourcePort: "course.desc", targetPort: "course.desc" }],
    };
    expect(designManualInputRefs(direct, capById)).toEqual(["course.title"]);
  });
});
