/**
 * V5.3 P3/P4 投影单测
 *
 * P3 — 多角色辩论投影（collaboration 视图）
 * P4 — 思考链投影（reasoning / overview 视图）
 *
 * 覆盖范围：
 *  - collaboration 模式：含 panel events 的 state → N 个 role 子节点 + ≥1 challenges 边 + 1 verdict（含 convergenceScore）
 *  - G-ROOT-2 不变量：challenges 边 type 不是 depends_on；role 子节点无 depends_on 父边
 *  - reasoning 模式：cap 节点子步数 == 该 run 的 think/observe/tool 事件数
 *  - overview 模式：节点数 == turn 视图（无子步），且有 overviewBadge
 *  - 切换 viewMode 是纯函数：不 mutate state
 */

import { describe, it, expect } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import { deriveSlideRuleReasoningViewModel } from "../derive-reasoning-view-model";
import { makeEventSequence } from "@shared/blueprint/sliderule-reasoning-events";
import type { V5SessionState, Artifact } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormReasoningNode, BrainstormReasoningEdge } from "@shared/blueprint/brainstorm-reasoning-graph";

// ---------------------------------------------------------------------------
// 测试 fixtures
// ---------------------------------------------------------------------------

const PANEL_RUN_ID = "run-panel-t1";
const PANEL_ART_ID = "art-panel-t1";
const CAP_RUN_ID = "run-cap-t1";
const CAP_ART_ID = "art-cap-t1";

/** Build a minimal session state that includes a panel capability node + panel artifact + events. */
function buildPanelState(): V5SessionState {
  const base = createInitialSessionState("分析权限方案", "sess-p3-test");
  const rootNode = base.graph.nodes.find((n) => n.id.endsWith("-proposition"));
  const rootId = rootNode?.id ?? "root";

  // Graph node representing the panel capability run
  const panelNode: BrainstormReasoningNode = {
    id: "node-panel-t1",
    type: "risk",
    title: "多角色辩论面板",
    status: "resolved",
    capabilityId: "critique.generate",
    capabilityRunId: PANEL_RUN_ID,
    producedArtifactId: PANEL_ART_ID,
    roleId: "综合",
  };

  // Panel artifact with 3 positions + convergenceScore
  const panelArtifact: Artifact = {
    id: PANEL_ART_ID,
    kind: "risk",
    provenance: "ai_generated",
    trustLevel: "gated_pass",
    producedBy: {
      capabilityRunId: PANEL_RUN_ID,
      capabilityId: "critique.generate",
      roleId: "综合",
    },
    passedGates: ["commit"],
    title: "权限方案多角色辩论",
    summary: "三角色对 RBAC/ABAC 方案进行辩论后收敛。",
    payload: {
      panel: true,
      positions: [
        { roleId: "安全", v5Role: "安全", content: "优先 RBAC，数据范围过滤" },
        { roleId: "挑刺", v5Role: "挑刺", content: "ABAC 成本过高，MVP 阶段不引入" },
        { roleId: "架构", v5Role: "架构", content: "混合策略：RBAC + 策略扩展点" },
      ],
      convergenceScore: 0.82,
      consensusReached: true,
      dissent: [],
    },
  };

  // ReasoningEvents: 3 role_position + 1 role_critique (挑刺 → 安全) + panel_converge
  const events = makeEventSequence(
    { turnId: "t-p3", capabilityRunId: PANEL_RUN_ID, capabilityId: "critique.generate" },
    [
      { kind: "role_position", roleId: "安全", text: "优先 RBAC" },
      { kind: "role_position", roleId: "挑刺", text: "ABAC 成本过高" },
      { kind: "role_critique", roleId: "挑刺", targetRoleId: "安全", text: "RBAC 不足以表达跨部门边界" },
      { kind: "role_position", roleId: "架构", text: "混合策略" },
      { kind: "panel_converge", text: "收敛达成", meta: { convergenceScore: 0.82, consensusReached: true, dissent: [] } },
    ]
  );

  return {
    ...base,
    artifacts: [...base.artifacts, panelArtifact],
    graph: {
      ...base.graph,
      nodes: [...base.graph.nodes, panelNode],
      edges: [
        ...base.graph.edges,
        {
          id: "e-root-panel-t1",
          source: rootId,
          target: "node-panel-t1",
          type: "depends_on",
          label: "辩论",
        } as BrainstormReasoningEdge,
      ],
    },
    reasoningEvents: events,
  };
}

/** Build a minimal state that includes a single reasoning capability node + think/observe/tool events. */
function buildReasoningCapState(): V5SessionState {
  const base = createInitialSessionState("分析外部证据", "sess-p4-test");
  const rootNode = base.graph.nodes.find((n) => n.id.endsWith("-proposition"));
  const rootId = rootNode?.id ?? "root";

  const capNode: BrainstormReasoningNode = {
    id: "node-cap-t1",
    type: "evidence",
    title: "外部证据检索",
    status: "open",
    capabilityId: "evidence.search",
    capabilityRunId: CAP_RUN_ID,
    producedArtifactId: CAP_ART_ID,
    roleId: "接地",
  };

  const capArtifact: Artifact = {
    id: CAP_ART_ID,
    kind: "evidence",
    provenance: "ai_generated",
    trustLevel: "gated_pass",
    producedBy: {
      capabilityRunId: CAP_RUN_ID,
      capabilityId: "evidence.search",
      roleId: "接地",
    },
    passedGates: ["commit"],
    title: "外部证据片段",
    summary: "检索到的外部权限系统证据。",
  };

  // 2 think + 1 observe + 1 tool_call = 4 substep events
  const events = makeEventSequence(
    { turnId: "t-p4", capabilityRunId: CAP_RUN_ID, capabilityId: "evidence.search" },
    [
      { kind: "think", text: "分析检索目标" },
      { kind: "think", text: "细化搜索关键词" },
      { kind: "observe", text: "发现 3 篇相关文档" },
      { kind: "tool_call", text: "调用 evidence.search 工具" },
    ]
  );

  return {
    ...base,
    artifacts: [...base.artifacts, capArtifact],
    graph: {
      ...base.graph,
      nodes: [...base.graph.nodes, capNode],
      edges: [
        ...base.graph.edges,
        {
          id: "e-root-cap-t1",
          source: rootId,
          target: "node-cap-t1",
          type: "depends_on",
          label: "来源",
        } as BrainstormReasoningEdge,
      ],
    },
    reasoningEvents: events,
  };
}

// ---------------------------------------------------------------------------
// P3 — 多角色辩论投影（collaboration 视图）
// ---------------------------------------------------------------------------

describe("P3 collaboration projection", () => {
  it("collaboration 模式：输出 N 个 role 子节点", () => {
    const state = buildPanelState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "collaboration",
      density: "detailed",
    });

    // 3 positions → 3 role child nodes
    const roleNodes = vm.visibleNodes.filter((n) => n.id.includes("::role-") && !n.id.includes("_verdict"));
    expect(roleNodes.length).toBe(3);

    // Each role node id should match one of the position roleIds
    const roleIds = roleNodes.map((n) => n.id);
    expect(roleIds.some((id) => id.includes("::role-安全"))).toBe(true);
    expect(roleIds.some((id) => id.includes("::role-挑刺"))).toBe(true);
    expect(roleIds.some((id) => id.includes("::role-架构"))).toBe(true);
  });

  it("collaboration 模式：输出 ≥1 条 challenges 边（挑刺→安全质疑）", () => {
    const state = buildPanelState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "collaboration",
      density: "detailed",
    });

    const challengesEdges = vm.visibleEdges.filter((e) => (e as any).type === "challenges");
    expect(challengesEdges.length).toBeGreaterThanOrEqual(1);

    // The challenge should be from 挑刺 to 安全
    const c = challengesEdges[0];
    expect(c.source).toContain("::role-挑刺");
    expect(c.target).toContain("::role-安全");
    expect(c.label).toBe("质疑");
  });

  it("collaboration 模式：输出 1 个 verdict 节点（含 convergenceScore 文案）", () => {
    const state = buildPanelState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "collaboration",
      density: "detailed",
    });

    const verdictNodes = vm.visibleNodes.filter((n) => n.id.includes("::role-_verdict"));
    expect(verdictNodes.length).toBe(1);

    const verdict = verdictNodes[0];
    // body should mention convergenceScore
    expect(verdict.body).toMatch(/0\.82/);
    // consensus → type synthesis
    expect(verdict.type).toBe("synthesis");
  });
});

// ---------------------------------------------------------------------------
// G-ROOT-2 不变量：challenges 边不破坏单父校验
// ---------------------------------------------------------------------------

describe("G-ROOT-2 invariant", () => {
  it("challenges 边 type 不是 depends_on", () => {
    const state = buildPanelState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "collaboration",
      density: "detailed",
    });

    // All edges with label "质疑" must NOT have type depends_on
    const qualifyingEdges = vm.visibleEdges.filter((e) => e.label === "质疑");
    expect(qualifyingEdges.length).toBeGreaterThanOrEqual(1);
    for (const e of qualifyingEdges) {
      expect((e as any).type).not.toBe("depends_on");
      expect((e as any).type).toBe("challenges");
    }
  });

  it("role 子节点在 visibleEdges 中无 depends_on 父边", () => {
    const state = buildPanelState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "collaboration",
      density: "detailed",
    });

    const roleNodeIds = new Set(
      vm.visibleNodes.filter((n) => n.id.includes("::role-")).map((n) => n.id)
    );

    const dependsOnIntoRole = vm.visibleEdges.filter(
      (e) => (e as any).type === "depends_on" && roleNodeIds.has(e.target)
    );
    expect(dependsOnIntoRole.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P4 — 思考链投影（reasoning 视图）
// ---------------------------------------------------------------------------

describe("P4 reasoning chain projection", () => {
  it("reasoning 模式：cap 节点子步数 == think/observe/tool 事件数", () => {
    const state = buildReasoningCapState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "reasoning",
      density: "detailed",
    });

    // 2 think + 1 observe + 1 tool_call = 4 substep nodes
    const stepNodes = vm.visibleNodes.filter((n) => n.id.startsWith("node-cap-t1::step-"));
    expect(stepNodes.length).toBe(4);
  });

  it("reasoning 模式：子步节点挂在 cap 父节点下（step 边 type 不是 depends_on）", () => {
    const state = buildReasoningCapState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "reasoning",
      density: "detailed",
    });

    const stepEdges = vm.visibleEdges.filter((e) => (e as any).type === "step");
    expect(stepEdges.length).toBe(4);

    for (const e of stepEdges) {
      expect(e.source).toBe("node-cap-t1");
      expect((e as any).type).not.toBe("depends_on");
    }
  });

  it("reasoning 模式：子步节点带 eventKind 字段", () => {
    const state = buildReasoningCapState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "reasoning",
      density: "detailed",
    });

    const stepNodes = vm.visibleNodes.filter((n) => n.id.startsWith("node-cap-t1::step-"));
    for (const n of stepNodes) {
      expect((n as any).eventKind).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// P4 — overview 模式（折叠角标，节点数回到 turn 视图水平）
// ---------------------------------------------------------------------------

describe("P4 overview projection", () => {
  it("overview 模式：无子步节点", () => {
    const state = buildReasoningCapState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "overview",
      density: "detailed",
    });

    const stepNodes = vm.visibleNodes.filter((n) => n.id.includes("::step-"));
    expect(stepNodes.length).toBe(0);
  });

  it("overview 模式：cap 节点带 overviewBadge", () => {
    const state = buildReasoningCapState();
    const vm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "overview",
      density: "detailed",
    });

    const capNode = vm.visibleNodes.find((n) => n.id === "node-cap-t1");
    expect(capNode).toBeDefined();
    expect((capNode as any).overviewBadge).toBeDefined();
    expect(typeof (capNode as any).overviewBadge).toBe("string");
  });

  it("overview 模式节点数 ≤ reasoning 模式节点数（无子步扩展）", () => {
    const state = buildReasoningCapState();
    const overviewVm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "overview",
      density: "detailed",
    });
    const reasoningVm = deriveSlideRuleReasoningViewModel(state, {
      viewMode: "reasoning",
      density: "detailed",
    });

    // overview has fewer nodes because no step nodes are added
    expect(overviewVm.visibleNodes.length).toBeLessThan(reasoningVm.visibleNodes.length);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：切换 viewMode 不 mutate state
// ---------------------------------------------------------------------------

describe("viewMode pure function", () => {
  it("collaboration / reasoning / overview 模式均不 mutate state", () => {
    const state = buildPanelState();
    const snapshotBefore = JSON.stringify(state);

    deriveSlideRuleReasoningViewModel(state, { viewMode: "collaboration", density: "detailed" });
    deriveSlideRuleReasoningViewModel(state, { viewMode: "reasoning", density: "detailed" });
    deriveSlideRuleReasoningViewModel(state, { viewMode: "overview", density: "detailed" });

    const snapshotAfter = JSON.stringify(state);
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it("reasoningEvents undefined 时 collaboration 模式退回基础 turn 视图，不报错", () => {
    const state = buildPanelState();
    const stateWithoutEvents: V5SessionState = { ...state, reasoningEvents: undefined };

    expect(() => {
      const vm = deriveSlideRuleReasoningViewModel(stateWithoutEvents, {
        viewMode: "collaboration",
        density: "detailed",
      });
      // Should still produce visible nodes (fall back to base turn view)
      expect(vm.visibleNodes.length).toBeGreaterThan(0);
      // No challenges edges since no events
      const challengesEdges = vm.visibleEdges.filter((e) => (e as any).type === "challenges");
      expect(challengesEdges.length).toBe(0);
    }).not.toThrow();
  });
});
