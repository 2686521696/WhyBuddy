/**
 * blueprint-wall-flow-graph-map 纯函数测试（Task 3.3）。
 *
 * 沿用本仓 example-based 测试模式（vitest 内置 describe / it / expect），
 * 不引入 PBT、不引入 React、不引入 FlowGraph / G6 运行时、不引入 jsdom /
 * happy-dom / @testing-library。与 `blueprint-wall-process-data.test.ts` 同风格：
 * 直接构造最小 `BlueprintWallProcessData`-shaped 对象喂给映射器，不调用真实 deriver。
 *
 * 覆盖列重映射（Column Remap）→ 视觉阶段道（visualStageLane）→ 固定像素坐标
 * （禁用 dagre）、稳定 id / 节点负载透传，以及边的曲线虚线 / 按 kind 着色 / 按
 * priority 强调 / 可选标签样式。
 */

import { describe, expect, it } from "vitest";

import { BLUEPRINT_SCENE_STAGES } from "../blueprint-stage-signal";
import type {
  BlueprintWallGraphEdge,
  BlueprintWallGraphNode,
  BlueprintWallProcessData,
} from "../blueprint-wall-process-data";
import {
  BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT,
  EDGE_CURVE_TYPE,
  EDGE_DEFAULT_LINE_DASH,
  EDGE_KIND_COLOR,
  EDGE_PRIORITY_STYLE,
  LANE_X,
  OFFSET_X,
  OFFSET_Y,
  ROW_Y,
  mapWallDataToFlowGraph,
  resolveVisualStageLane,
} from "../blueprint-wall-flow-graph-map";

// ─── Test builders ───────────────────────────────────────────────────────────

/** 构造一个最小可用的墙面图节点。 */
function makeNode(
  overrides: Partial<BlueprintWallGraphNode> & {
    id: string;
    type: BlueprintWallGraphNode["type"];
  }
): BlueprintWallGraphNode {
  return {
    title: `Node ${overrides.id}`,
    status: "active",
    column: 0,
    row: 0,
    sourceRefs: [],
    ...overrides,
  } as BlueprintWallGraphNode;
}

/** 构造一个最小可用的墙面图边。 */
function makeEdge(
  overrides: Partial<BlueprintWallGraphEdge> & {
    id: string;
    from: string;
    to: string;
  }
): BlueprintWallGraphEdge {
  return {
    kind: "depends_on",
    priority: "primary",
    ...overrides,
  } as BlueprintWallGraphEdge;
}

/**
 * 构造一个最小 `BlueprintWallProcessData`-shaped 对象。
 *
 * 映射器只读 `data.nodes` / `data.edges` / `data.stageSignal.stageIndex`，因此其余
 * 字段用 cast 省略即可（与 `blueprint-wall-process-data.test.ts` 的 mock 风格一致）。
 */
function makeWallData(args: {
  nodes?: BlueprintWallGraphNode[];
  edges?: BlueprintWallGraphEdge[];
  stageIndex?: number;
}): BlueprintWallProcessData {
  const stageIndex = args.stageIndex ?? 0;
  return {
    stageSignal: {
      stageKey: BLUEPRINT_SCENE_STAGES[stageIndex] ?? "input",
      stageIndex,
      totalStages: BLUEPRINT_SCENE_STAGES.length,
      progress: 0,
    },
    nodes: args.nodes ?? [],
    edges: args.edges ?? [],
  } as unknown as BlueprintWallProcessData;
}

/** 映射单个节点，返回其 FlowGraph 节点（便于 lane / 坐标断言）。 */
function mapSingleNode(node: BlueprintWallGraphNode, stageIndex = 0) {
  const result = mapWallDataToFlowGraph(
    makeWallData({ nodes: [node], stageIndex })
  );
  return result.data.nodes[0];
}

/** 期望 x 坐标：visualStageLane * LANE_X + OFFSET_X。 */
function expectedX(lane: number): number {
  return lane * LANE_X + OFFSET_X;
}

describe("mapWallDataToFlowGraph / column remap + styling", () => {
  // ─── Sanity: stage index constants are stable (self-document lane tests) ────
  it("BLUEPRINT_SCENE_STAGES index sanity", () => {
    expect(BLUEPRINT_SCENE_STAGES.indexOf("route_generation")).toBe(2);
    expect(BLUEPRINT_SCENE_STAGES.indexOf("spec_tree")).toBe(4);
    expect(BLUEPRINT_SCENE_STAGES.indexOf("effect_preview")).toBe(6);
    expect(BLUEPRINT_SCENE_STAGES.indexOf("engineering_handoff")).toBe(8);
  });

  // ─── LANE REMAP ────────────────────────────────────────────────────────────

  it("route node → route_generation lane (2), not clarification (1) / route_selection (3)", () => {
    const node = makeNode({ id: "route:r1", type: "route", column: 1, row: 1 });
    const mapped = mapSingleNode(node);

    expect(mapped.data.visualStageLane).toBe(2);
    expect(mapped.data.visualStageLane).not.toBe(1);
    expect(mapped.data.visualStageLane).not.toBe(3);
    // x === 2*330+80 === 740
    expect(mapped.style.x).toBe(740);
    expect(mapped.style.x).toBe(expectedX(2));
  });

  it("spec_node → spec_tree lane (4), not route_generation (2) / spec_docs (5)", () => {
    const node = makeNode({
      id: "spec:s1",
      type: "spec_node",
      column: 2,
      row: 1,
    });
    const mapped = mapSingleNode(node);

    expect(mapped.data.visualStageLane).toBe(4);
    expect(mapped.data.visualStageLane).not.toBe(2);
    expect(mapped.data.visualStageLane).not.toBe(5);
    expect(mapped.style.x).toBe(expectedX(4)); // 4*330+80 === 1400
    expect(mapped.style.x).toBe(1400);
  });

  it("preview node → effect_preview lane (6), not spec_tree (4)", () => {
    const node = makeNode({
      id: "preview:p1",
      type: "preview",
      column: 4,
      row: 1,
    });
    const mapped = mapSingleNode(node);

    expect(mapped.data.visualStageLane).toBe(6);
    expect(mapped.data.visualStageLane).not.toBe(4);
    expect(mapped.style.x).toBe(expectedX(6)); // 6*330+80 === 2060
    expect(mapped.style.x).toBe(2060);
  });

  it("final + artifact both → engineering_handoff lane (8) but on different rows (no overlap)", () => {
    const finalNode = makeNode({
      id: "final:f1",
      type: "final",
      column: 4,
      row: 3,
    });
    const artifactNode = makeNode({
      id: "artifact:a1",
      type: "artifact",
      column: 4,
      row: 5,
    });
    const result = mapWallDataToFlowGraph(
      makeWallData({ nodes: [finalNode, artifactNode] })
    );
    const [mappedFinal, mappedArtifact] = result.data.nodes;

    // Same lane → same x.
    expect(mappedFinal.data.visualStageLane).toBe(8);
    expect(mappedArtifact.data.visualStageLane).toBe(8);
    expect(mappedFinal.style.x).toBe(expectedX(8)); // 2720
    expect(mappedArtifact.style.x).toBe(expectedX(8));
    expect(mappedFinal.style.x).toBe(mappedArtifact.style.x);

    // Different rows → different y, so they do not overlap.
    expect(mappedFinal.style.y).toBe(3 * ROW_Y + OFFSET_Y); // 3*180+60 === 600
    expect(mappedArtifact.style.y).toBe(5 * ROW_Y + OFFSET_Y); // 5*180+60 === 960
    expect(mappedFinal.style.y).not.toBe(mappedArtifact.style.y);
  });

  it("user_goal → lane 0; stage node keeps its own column lane (no remap)", () => {
    const userGoal = makeNode({
      id: "user_goal:job-1",
      type: "user_goal",
      column: 0,
      row: 1,
    });
    expect(mapSingleNode(userGoal).data.visualStageLane).toBe(0);

    // stage node at column 5 keeps lane 5 (spec_docs), no category remap.
    const stageNode = makeNode({
      id: "stage:spec_docs",
      type: "stage",
      column: 5,
      row: 0,
    });
    const mappedStage = mapSingleNode(stageNode);
    expect(mappedStage.data.visualStageLane).toBe(5);
    expect(mappedStage.style.x).toBe(expectedX(5));
  });

  it("reasoning WITH a kind:'stage' sourceRef → that stage's lane (spec_tree === 4)", () => {
    const node = makeNode({
      id: "reasoning:re1",
      type: "reasoning",
      column: 3,
      row: 2,
      sourceRefs: [{ kind: "stage", id: "spec_tree" }],
    });
    // stageIndex deliberately different (3) to prove the stage ref wins, not fallback.
    const mapped = mapSingleNode(node, 3);

    expect(mapped.data.visualStageLane).toBe(
      BLUEPRINT_SCENE_STAGES.indexOf("spec_tree")
    );
    expect(mapped.data.visualStageLane).toBe(4);
    expect(mapped.style.x).toBe(expectedX(4));
  });

  it("reasoning WITHOUT a stage sourceRef → falls back to stageSignal.stageIndex", () => {
    const node = makeNode({
      id: "reasoning:re2",
      type: "reasoning",
      column: 3,
      row: 2,
      sourceRefs: [{ kind: "reasoning", id: "re2" }],
    });
    const mapped = mapSingleNode(node, 3);

    expect(mapped.data.visualStageLane).toBe(3);
    expect(mapped.style.x).toBe(expectedX(3));
  });

  it("capability (no reliable stage) → stageSignal.stageIndex, not a fabricated fixed value", () => {
    const node = makeNode({
      id: "capability:c1",
      type: "capability",
      column: 3,
      row: 4,
      sourceRefs: [{ kind: "capability", id: "c1" }],
    });
    const mapped = mapSingleNode(node, 7);

    expect(mapped.data.visualStageLane).toBe(7);
    expect(mapped.style.x).toBe(expectedX(7));

    // Direct resolveVisualStageLane check: same fallback rule, different stageIndex.
    expect(
      resolveVisualStageLane(node, { stageSignal: makeWallData({ stageIndex: 2 }).stageSignal })
    ).toBe(2);
  });

  // ─── FIXED COORDS / NO DAGRE ────────────────────────────────────────────────

  it("layout deep-equals [] (dagre disabled) and every node carries numeric fixed x/y", () => {
    const nodes = [
      makeNode({ id: "stage:input", type: "stage", column: 0, row: 0 }),
      makeNode({ id: "route:r1", type: "route", column: 1, row: 2 }),
      makeNode({ id: "spec:s1", type: "spec_node", column: 2, row: 3 }),
    ];
    const result = mapWallDataToFlowGraph(makeWallData({ nodes }));

    // dagre disabled: layout pipeline is the empty array constant.
    expect(result.layout).toEqual([]);
    expect(result.layout).toBe(BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT);

    for (const mapped of result.data.nodes) {
      expect(typeof mapped.style.x).toBe("number");
      expect(typeof mapped.style.y).toBe("number");
      // Coords come from the remap, computed with the exported constants.
      expect(mapped.style.x).toBe(
        mapped.data.visualStageLane * LANE_X + OFFSET_X
      );
      expect(mapped.style.y).toBe(mapped.data.row * ROW_Y + OFFSET_Y);
    }

    // Representative node (spec → lane 4, row 3).
    const spec = result.data.nodes.find((n) => n.id === "spec:s1")!;
    expect(spec.style.x).toBe(4 * LANE_X + OFFSET_X);
    expect(spec.style.y).toBe(3 * ROW_Y + OFFSET_Y);
  });

  // ─── STABLE IDS / NODE PAYLOAD ──────────────────────────────────────────────

  it("mapped node id is stable (=== input id) and node data payload is preserved", () => {
    const node = makeNode({
      id: "spec:keep-me",
      type: "spec_node",
      title: "My Spec Node",
      body: "spec body text",
      status: "completed",
      column: 2,
      row: 7,
      accent: "purple",
      sourceRefs: [{ kind: "spec", id: "keep-me" }],
    });
    const mapped = mapSingleNode(node);

    expect(mapped.id).toBe("spec:keep-me");
    expect(mapped.data.type).toBe("spec_node");
    expect(mapped.data.status).toBe("completed");
    expect(mapped.data.title).toBe("My Spec Node");
    expect(mapped.data.body).toBe("spec body text");
    expect(mapped.data.accent).toBe("purple");
    expect(mapped.data.sourceRefs).toEqual([{ kind: "spec", id: "keep-me" }]);
    expect(mapped.data.row).toBe(7);
    expect(mapped.data.column).toBe(2);
  });

  // ─── EDGES ──────────────────────────────────────────────────────────────────

  it("depends_on / primary / labeled edge → cubic-horizontal dashed styled edge with preserved ids", () => {
    const edge = makeEdge({
      id: "edge:e1",
      from: "stage:input",
      to: "stage:clarification",
      kind: "depends_on",
      priority: "primary",
      label: "deps",
    });
    const result = mapWallDataToFlowGraph(makeWallData({ edges: [edge] }));
    const mapped = result.data.edges[0];

    // ids preserved; from/to → source/target.
    expect(mapped.id).toBe("edge:e1");
    expect(mapped.source).toBe("stage:input");
    expect(mapped.target).toBe("stage:clarification");

    // curve + dashed.
    expect(mapped.type).toBe("cubic-horizontal");
    expect(mapped.type).toBe(EDGE_CURVE_TYPE);
    expect(mapped.style.lineDash).toEqual([6, 4]);
    expect(mapped.style.lineDash).toEqual(EDGE_DEFAULT_LINE_DASH);

    // color by kind, width/opacity by priority.
    expect(mapped.style.stroke).toBe(EDGE_KIND_COLOR.depends_on);
    expect(mapped.style.lineWidth).toBe(2.5);
    expect(mapped.style.opacity).toBe(1);

    // label preserved.
    expect(mapped.style.labelText).toBe("deps");
    expect(mapped.data.kind).toBe("depends_on");
    expect(mapped.data.priority).toBe("primary");
    expect(mapped.data.label).toBe("deps");
  });

  it("edge WITHOUT a label → no fabricated labelText", () => {
    const edge = makeEdge({
      id: "edge:e2",
      from: "a",
      to: "b",
      kind: "supports",
      priority: "secondary",
    });
    const result = mapWallDataToFlowGraph(makeWallData({ edges: [edge] }));
    const mapped = result.data.edges[0];

    expect(mapped.style.labelText).toBeUndefined();
    expect(mapped.data.label).toBeUndefined();
    // secondary priority style is applied.
    expect(mapped.style.lineWidth).toBe(EDGE_PRIORITY_STYLE.secondary.lineWidth);
    expect(mapped.style.opacity).toBe(EDGE_PRIORITY_STYLE.secondary.opacity);
  });

  it("EDGE_KIND_COLOR covers all 7 kinds with representative values", () => {
    expect(Object.keys(EDGE_KIND_COLOR).sort()).toEqual(
      [
        "answers",
        "blocks",
        "depends_on",
        "produces",
        "refines",
        "supports",
        "uses_capability",
      ].sort()
    );
    expect(EDGE_KIND_COLOR.depends_on).toBe("#0d9488");
    expect(EDGE_KIND_COLOR.produces).toBe("#2563eb");
    expect(EDGE_KIND_COLOR.blocks).toBe("#dc2626");
  });
});

// ─── Fix 1: per-lane row de-confliction (no two nodes share final x AND y) ────

describe("mapWallDataToFlowGraph / per-lane row de-confliction (Fix 1)", () => {
  it("capability + current-stage reasoning colliding on same (lane,row) → DISTINCT (x,y)", () => {
    // Reproduce the confirmed bug: when current stage is route_generation
    // (stageIndex 2), the deriver places `capability:foo` at column 3 / row 1
    // (index 0 + 1) and a current-stage `reasoning:bar` also at column 3 / row 1.
    // Both resolve to lane 2 (stageSignal.stageIndex) — capability always, and
    // reasoning via the no-known-stage fallback — so without de-confliction
    // their ~300px cards would land on the SAME (x, y) and fully overlap.
    //
    // Deriver array order is deterministic: capability nodes precede reasoning
    // nodes, so we mirror that order here.
    const capabilityNode = makeNode({
      id: "capability:foo",
      type: "capability",
      column: 3,
      row: 1,
      sourceRefs: [{ kind: "capability", id: "foo" }],
    });
    const reasoningNode = makeNode({
      id: "reasoning:bar",
      type: "reasoning",
      column: 3,
      row: 1,
      // No kind:"stage" sourceRef → falls back to stageSignal.stageIndex (2).
      sourceRefs: [{ kind: "reasoning", id: "bar" }],
    });

    const result = mapWallDataToFlowGraph(
      makeWallData({
        nodes: [capabilityNode, reasoningNode],
        stageIndex: 2, // route_generation
      })
    );
    const mappedCapability = result.data.nodes.find(
      (n) => n.id === "capability:foo"
    )!;
    const mappedReasoning = result.data.nodes.find(
      (n) => n.id === "reasoning:bar"
    )!;

    // Both land in the same visual stage lane (2) → same x.
    expect(mappedCapability.data.visualStageLane).toBe(2);
    expect(mappedReasoning.data.visualStageLane).toBe(2);
    expect(mappedCapability.style.x).toBe(expectedX(2));
    expect(mappedReasoning.style.x).toBe(expectedX(2));
    expect(mappedCapability.style.x).toBe(mappedReasoning.style.x);

    // De-confliction: capability (first in array) keeps preferred row 1;
    // reasoning bumps to the next free row 2 within lane 2.
    expect(mappedCapability.data.effectiveRow).toBe(1);
    expect(mappedReasoning.data.effectiveRow).toBe(2);
    // The original deriver row is preserved unchanged for debugging.
    expect(mappedCapability.data.row).toBe(1);
    expect(mappedReasoning.data.row).toBe(1);

    // y is driven by the EFFECTIVE row, so they differ.
    expect(mappedCapability.style.y).toBe(1 * ROW_Y + OFFSET_Y);
    expect(mappedReasoning.style.y).toBe(2 * ROW_Y + OFFSET_Y);
    expect(mappedCapability.style.y).not.toBe(mappedReasoning.style.y);

    // Core invariant: no two mapped nodes share identical x AND y.
    expect(
      mappedCapability.style.x === mappedReasoning.style.x &&
        mappedCapability.style.y === mappedReasoning.style.y
    ).toBe(false);
  });

  it("no two mapped nodes share identical (x,y) across a dense same-lane cluster", () => {
    // Three reasoning-like nodes all forced into the same lane on the same raw
    // row (the worst case): they must spread to rows 1,2,3 → distinct y.
    const stageIndex = 2;
    const nodes = [
      makeNode({ id: "capability:c1", type: "capability", column: 3, row: 1 }),
      makeNode({ id: "capability:c2", type: "capability", column: 3, row: 1 }),
      makeNode({
        id: "reasoning:r1",
        type: "reasoning",
        column: 3,
        row: 1,
        sourceRefs: [{ kind: "reasoning", id: "r1" }],
      }),
    ];
    const result = mapWallDataToFlowGraph(
      makeWallData({ nodes, stageIndex })
    );

    // All in lane 2 (same x), distinct effective rows 1,2,3 (distinct y).
    const coords = result.data.nodes.map((n) => `${n.style.x},${n.style.y}`);
    expect(new Set(coords).size).toBe(coords.length); // all unique (x,y)
    expect(result.data.nodes.map((n) => n.data.effectiveRow)).toEqual([1, 2, 3]);
  });

  it("non-colliding nodes keep their preferred row (effectiveRow === row)", () => {
    // Distinct lanes never collide, so effectiveRow must equal the deriver row.
    const nodes = [
      makeNode({ id: "stage:input", type: "stage", column: 0, row: 0 }),
      makeNode({ id: "route:r1", type: "route", column: 1, row: 2 }),
      makeNode({ id: "spec:s1", type: "spec_node", column: 2, row: 3 }),
    ];
    const result = mapWallDataToFlowGraph(makeWallData({ nodes }));
    for (const mapped of result.data.nodes) {
      expect(mapped.data.effectiveRow).toBe(mapped.data.row);
      expect(mapped.style.y).toBe(mapped.data.effectiveRow * ROW_Y + OFFSET_Y);
    }
  });

  it("is deterministic: same input → same de-conflicted output", () => {
    const build = () =>
      mapWallDataToFlowGraph(
        makeWallData({
          nodes: [
            makeNode({ id: "capability:c1", type: "capability", column: 3, row: 1 }),
            makeNode({
              id: "reasoning:r1",
              type: "reasoning",
              column: 3,
              row: 1,
              sourceRefs: [{ kind: "reasoning", id: "r1" }],
            }),
          ],
          stageIndex: 2,
        })
      );
    expect(build().data.nodes.map((n) => [n.style.x, n.style.y])).toEqual(
      build().data.nodes.map((n) => [n.style.x, n.style.y])
    );
  });
});
