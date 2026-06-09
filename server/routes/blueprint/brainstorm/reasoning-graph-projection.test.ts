import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  BranchEdge,
  BranchNode,
  BranchNodeStatus,
  BranchNodeType,
  BrainstormRoleId,
  BrainstormSession,
  BrainstormSessionStatus,
  CollaborationMode,
  CrewMemberInstance,
  CritiqueSeverity,
  RebuttalStance,
} from "../../../../shared/blueprint/brainstorm-contracts";
import type { BrainstormReasoningGraph } from "../../../../shared/blueprint/brainstorm-reasoning-graph";

import {
  CENTRAL_QUESTION_NODE_ID,
  projectSessionToReasoningGraph,
} from "./reasoning-graph-projection";

/**
 * Tests for Session → BrainstormReasoningGraph projection.
 *
 * Property 1 (Validates: Requirements 3.1, 3.5, 7.1): for ARBITRARY sessions
 * the projection output is always renderable by the 3D wall — non-empty nodes,
 * a present central-question node, and no dangling edges (every edge endpoint
 * exists in nodes).
 *
 * Plus concrete example tests for branch-node → reasoning-node type mapping and
 * deliberation edge-type mapping.
 */

const ROLE_IDS: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];

const BRANCH_TYPES: BranchNodeType[] = [
  "decision",
  "thinking",
  "action",
  "observation",
  "synthesis",
  "error",
];

const BRANCH_STATUSES: BranchNodeStatus[] = [
  "pending",
  "active",
  "completed",
  "failed",
];

const SESSION_STATUSES: BrainstormSessionStatus[] = [
  "active",
  "synthesizing",
  "completed",
  "failed",
  "force_terminated",
];

const MODES: CollaborationMode[] = ["discussion", "vote", "division", "audit"];

// ---------------------------------------------------------------------------
// Renderability invariant — mirrors client `isGraphRenderable`
// ---------------------------------------------------------------------------

function isGraphRenderable(graph: BrainstormReasoningGraph): boolean {
  if (!graph.id || !graph.jobId) return false;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (nodeIds.size === 0) return false;
  return graph.edges.every(
    (edge) => Boolean(edge.id) && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const branchNodeArb = (): fc.Arbitrary<BranchNode> =>
  fc.record({
    id: fc.string({ minLength: 0, maxLength: 8 }),
    sessionId: fc.constant("session-x"),
    parentNodeId: fc.option(fc.string({ maxLength: 8 }), { nil: null }),
    roleId: fc.constantFrom(...ROLE_IDS),
    type: fc.constantFrom(...BRANCH_TYPES),
    status: fc.constantFrom(...BRANCH_STATUSES),
    title: fc.string({ maxLength: 20 }),
    content: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    createdAt: fc.constant(new Date(0).toISOString()),
    updatedAt: fc.constant(new Date(0).toISOString()),
    sequenceNumber: fc.nat({ max: 100 }),
  });

const branchEdgeArb = (): fc.Arbitrary<BranchEdge> =>
  fc.record({
    sourceNodeId: fc.string({ maxLength: 8 }),
    targetNodeId: fc.string({ maxLength: 8 }),
  });

const challengeArb = () =>
  fc.record({
    challengerRoleId: fc.constantFrom(...ROLE_IDS),
    targetRoleId: fc.constantFrom(...ROLE_IDS),
    summary: fc.string({ maxLength: 20 }),
    roundNumber: fc.nat({ max: 5 }),
  });

const rebuttalArb = () =>
  fc.record({
    responderRoleId: fc.constantFrom(...ROLE_IDS),
    challengeSummary: fc.string({ maxLength: 20 }),
    summary: fc.string({ maxLength: 20 }),
    roundNumber: fc.nat({ max: 5 }),
  });

const crewMemberArb = (roleId: BrainstormRoleId): CrewMemberInstance => ({
  roleId,
  state: "completed",
  iterationCount: 1,
  maxIterations: 3,
  tokenUsage: 50,
});

const sessionArb = (): fc.Arbitrary<BrainstormSession> =>
  fc
    .record({
      id: fc.string({ maxLength: 8 }),
      jobId: fc.string({ maxLength: 8 }),
      stageId: fc.string({ maxLength: 8 }),
      mode: fc.constantFrom(...MODES),
      roles: fc.uniqueArray(fc.constantFrom(...ROLE_IDS), { maxLength: 6 }),
      branchNodes: fc.array(branchNodeArb(), { maxLength: 8 }),
      edges: fc.array(branchEdgeArb(), { maxLength: 8 }),
      status: fc.constantFrom(...SESSION_STATUSES),
      tokenBudget: fc.nat({ max: 100_000 }),
      tokenUsed: fc.nat({ max: 100_000 }),
      hasCompletedAt: fc.boolean(),
      challenges: fc.array(challengeArb(), { maxLength: 5 }),
      rebuttals: fc.array(rebuttalArb(), { maxLength: 5 }),
    })
    .map((raw): BrainstormSession => {
      const crewMembers = new Map<BrainstormRoleId, CrewMemberInstance>();
      for (const roleId of raw.roles) {
        crewMembers.set(roleId, crewMemberArb(roleId));
      }
      const startedAt = new Date(1_000);
      return {
        id: raw.id,
        jobId: raw.jobId,
        stageId: raw.stageId,
        mode: raw.mode,
        crewMembers,
        branchNodes: raw.branchNodes,
        edges: raw.edges,
        status: raw.status,
        tokenBudget: raw.tokenBudget,
        tokenUsed: raw.tokenUsed,
        toolCallCount: 0,
        toolCallLimit: 20,
        startedAt,
        completedAt: raw.hasCompletedAt ? new Date(5_000) : undefined,
        deliberationSummary:
          raw.challenges.length > 0 || raw.rebuttals.length > 0
            ? {
                roundCount: 1,
                finalConvergenceScore: 0.5,
                consensusAchieved: false,
                totalChallenges: raw.challenges.length,
                unresolvedChallengeCount: raw.challenges.length,
                challenges: raw.challenges,
                rebuttals: raw.rebuttals,
              }
            : undefined,
      };
    });

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe("projectSessionToReasoningGraph — Property 1: always renderable", () => {
  it("produces a renderable graph for arbitrary sessions (Validates: Requirements 3.1, 3.5, 7.1)", () => {
    fc.assert(
      fc.property(sessionArb(), fc.string({ maxLength: 30 }), (session, title) => {
        const graph = projectSessionToReasoningGraph(session, title);

        // nodes non-empty + central question node present
        expect(graph.nodes.length).toBeGreaterThan(0);
        expect(graph.nodes.some((n) => n.id === CENTRAL_QUESTION_NODE_ID)).toBe(true);

        // every edge endpoint exists in nodes (no dangling edges)
        const nodeIds = new Set(graph.nodes.map((n) => n.id));
        for (const edge of graph.edges) {
          expect(edge.id.length).toBeGreaterThan(0);
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        }

        // composite renderability check (mirrors the wall renderer)
        expect(isGraphRenderable(graph)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Stage routing
// ---------------------------------------------------------------------------

describe("projectSessionToReasoningGraph — stage routing", () => {
  it("projects the graph stage from the runtime session stageId", () => {
    const graph = projectSessionToReasoningGraph(
      makeSession({ stageId: "spec_tree" }),
      "How should the selected route become a SPEC tree?",
    );

    expect(graph.stage).toBe("spec_tree");
    expect(graph.subStage).toBe("spec_tree");
  });
});

// ---------------------------------------------------------------------------
// Concrete example tests
// ---------------------------------------------------------------------------

function makeBranchNode(overrides: Partial<BranchNode> & { id: string }): BranchNode {
  return {
    sessionId: "session-1",
    parentNodeId: null,
    roleId: "planner",
    type: "thinking",
    status: "active",
    title: "node",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    sequenceNumber: 0,
    ...overrides,
  };
}

function makeSession(overrides: Partial<BrainstormSession> = {}): BrainstormSession {
  return {
    id: "session-1",
    jobId: "job-1",
    stageId: "stage-1",
    mode: "discussion",
    crewMembers: new Map(),
    branchNodes: [],
    edges: [],
    status: "active",
    tokenBudget: 10_000,
    tokenUsed: 2_500,
    toolCallCount: 0,
    toolCallLimit: 20,
    startedAt: new Date(1_000),
    ...overrides,
  };
}

describe("projectSessionToReasoningGraph — node type mapping", () => {
  it("maps thinking→hypothesis, observation→evidence, action→constraint, synthesis→synthesis", () => {
    const session = makeSession({
      branchNodes: [
        makeBranchNode({ id: "n-think", type: "thinking", roleId: "planner" }),
        makeBranchNode({ id: "n-obs", type: "observation", roleId: "architect" }),
        makeBranchNode({ id: "n-act", type: "action", roleId: "executor" }),
        makeBranchNode({ id: "n-syn", type: "synthesis", roleId: "decider" }),
      ],
    });

    const graph = projectSessionToReasoningGraph(session, "Which approach?");

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("n-think")?.type).toBe("hypothesis");
    expect(byId.get("n-obs")?.type).toBe("evidence");
    expect(byId.get("n-act")?.type).toBe("constraint");
    expect(byId.get("n-syn")?.type).toBe("synthesis");
  });

  it("emits the central question node and references it from centralQuestion", () => {
    const graph = projectSessionToReasoningGraph(makeSession(), "Central debate topic");
    const central = graph.nodes.find((n) => n.id === CENTRAL_QUESTION_NODE_ID);
    expect(central).toBeDefined();
    expect(central?.type).toBe("question");
    expect(central?.title).toBe("Central debate topic");
    expect(graph.centralQuestion?.id).toBe(CENTRAL_QUESTION_NODE_ID);
  });

  it("falls back to a default central question title when empty", () => {
    const graph = projectSessionToReasoningGraph(makeSession(), "   ");
    const central = graph.nodes.find((n) => n.id === CENTRAL_QUESTION_NODE_ID);
    expect(central?.title.length).toBeGreaterThan(0);
    expect(central?.title).not.toBe("   ");
  });
});

describe("projectSessionToReasoningGraph — edge type mapping", () => {
  it("connects the central question to first-level role nodes with questions edges", () => {
    const session = makeSession({
      branchNodes: [makeBranchNode({ id: "root-node", parentNodeId: null })],
    });
    const graph = projectSessionToReasoningGraph(session, "Q");
    const questionEdges = graph.edges.filter((e) => e.type === "questions");
    expect(questionEdges.length).toBeGreaterThan(0);
    expect(
      questionEdges.some(
        (e) => e.source === CENTRAL_QUESTION_NODE_ID && e.target === "root-node",
      ),
    ).toBe(true);
  });

  it("fans out the central question to each role's first node even when runtime edges are sequential", () => {
    const session = makeSession({
      branchNodes: [
        makeBranchNode({ id: "n-plan", roleId: "planner", parentNodeId: null }),
        makeBranchNode({ id: "n-arch", roleId: "architect", parentNodeId: "n-plan" }),
        makeBranchNode({ id: "n-audit", roleId: "auditor", parentNodeId: "n-arch" }),
        makeBranchNode({ id: "n-plan-2", roleId: "planner", parentNodeId: "n-audit" }),
      ],
      edges: [
        { sourceNodeId: "n-plan", targetNodeId: "n-arch" },
        { sourceNodeId: "n-arch", targetNodeId: "n-audit" },
        { sourceNodeId: "n-audit", targetNodeId: "n-plan-2" },
      ],
    });

    const graph = projectSessionToReasoningGraph(session, "Q");
    const centralTargets = graph.edges
      .filter((edge) => edge.source === CENTRAL_QUESTION_NODE_ID && edge.type === "questions")
      .map((edge) => edge.target);

    expect(centralTargets).toEqual(expect.arrayContaining(["n-plan", "n-arch", "n-audit"]));
    expect(centralTargets).not.toContain("n-plan-2");
  });

  it("does not project deliberation challenges into Effect/Reasoning graph (no critique/conflicts edges)", () => {
    const session = makeSession({
      branchNodes: [
        makeBranchNode({ id: "n-arch", roleId: "architect", type: "thinking" }),
        makeBranchNode({ id: "n-aud", roleId: "auditor", type: "thinking" }),
      ],
      deliberationSummary: {
        roundCount: 1,
        finalConvergenceScore: 0.5,
        consensusAchieved: false,
        totalChallenges: 1,
        unresolvedChallengeCount: 1,
        challenges: [
          {
            challengerRoleId: "auditor",
            targetRoleId: "architect",
            summary: "scalability concern",
            roundNumber: 1,
          },
        ],
      },
    });

    const graph = projectSessionToReasoningGraph(session, "Q");

    // This projection (for Effect/Reasoning Flow) must NOT emit debate protocol
    // nodes or their edges. Those belong to the realtime brainstorm debate path.
    expect(graph.nodes.some((n) => n.type === "critique")).toBe(false);
    expect(graph.edges.some((e) => e.type === "conflicts")).toBe(false);

    // Still renderable and contains the branch nodes we fed in.
    expect(isGraphRenderable(graph)).toBe(true);
    expect(graph.nodes.some((n) => n.id === "n-arch")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "n-aud")).toBe(true);
  });

  it("keeps rebuttals isolated from Effect/Reasoning graph while preserving synthesis edges", () => {
    const session = makeSession({
      branchNodes: [
        makeBranchNode({ id: "n-arch", roleId: "architect", type: "thinking" }),
        makeBranchNode({ id: "n-aud", roleId: "auditor", type: "thinking" }),
        makeBranchNode({ id: "n-syn", roleId: "decider", type: "synthesis" }),
      ],
      deliberationSummary: {
        roundCount: 1,
        finalConvergenceScore: 0.5,
        consensusAchieved: false,
        totalChallenges: 1,
        unresolvedChallengeCount: 0,
        challenges: [
          {
            challengerRoleId: "auditor",
            targetRoleId: "architect",
            summary: "scalability concern",
            roundNumber: 1,
          },
        ],
        rebuttals: [
          {
            responderRoleId: "architect",
            challengeSummary: "scalability concern",
            summary: "we shard horizontally",
            roundNumber: 1,
          },
        ],
      },
    });

    const graph = projectSessionToReasoningGraph(session, "Q");

    // This projection must NOT emit supports edges (or rebuttal nodes) from
    // deliberation. Debate edges live on the dedicated realtime path only.
    expect(graph.nodes.some((n) => n.type === "rebuttal")).toBe(false);
    expect(graph.edges.some((e) => e.type === "supports")).toBe(false);

    // Synthesis edges (from actual synthesis branch nodes) are still produced.
    const synthesizes = graph.edges.filter((e) => e.type === "synthesizes");
    expect(synthesizes.length).toBeGreaterThan(0);
    expect(synthesizes.every((e) => e.target === "n-syn")).toBe(true);

    expect(isGraphRenderable(graph)).toBe(true);
  });

  it("populates telemetry from session token stats and crew size", () => {
    const crewMembers = new Map<BrainstormRoleId, CrewMemberInstance>();
    crewMembers.set("planner", crewMemberArb("planner"));
    crewMembers.set("architect", crewMemberArb("architect"));
    const session = makeSession({
      crewMembers,
      tokenBudget: 10_000,
      tokenUsed: 2_500,
      completedAt: new Date(4_000),
    });

    const graph = projectSessionToReasoningGraph(session, "Q");
    expect(graph.telemetry?.tokenBurn).toBe(2_500);
    expect(graph.telemetry?.remainingBudget).toBe(7_500);
    expect(graph.telemetry?.activeRoleCount).toBe(2);
    expect(graph.telemetry?.elapsedMs).toBe(3_000);
    expect(graph.source).toBe("runtime");
  });
});

// ===========================================================================
// Feature: autopilot-brainstorm-real-collaboration, Property 8
//
// Property 8: Projection (Effect/Reasoning path) is always renderable.
//
// For ANY BrainstormSession state (arbitrary branch nodes, edges, structured
// deliberation challenges/rebuttals in the input, empty/failed sessions, etc.)
// the output of `projectSessionToReasoningGraph` SHALL:
//   - pass `isGraphRenderable` (non-empty id/jobId, central-question node,
//     no dangling edges), and
//   - preserve branch/session/synthesis edges as appropriate, BUT
//   - MUST NOT emit first-class "critique"/"rebuttal" nodes or deliberation-
//     derived "conflicts"/"supports" edges (debate protocol is isolated to the
//     realtime `brainstorm-graph-store` + `BrainstormWallGraph` + challengeEdges
//     overlay).
//
// This projection targets the main Effect/Reasoning Flow wall, not the debate DAG.
//
// Validates: Requirements 6.5, 6.7, 12.3
// ===========================================================================

const SEVERITIES: CritiqueSeverity[] = ["low", "medium", "high"];
const STANCES: RebuttalStance[] = ["concede", "defend"];

// Shared summary pool (retained for constructing realistic deliberation input
// that the projection must still render correctly, even though it no longer
// emits debate-specific edges).
const SUMMARY_POOL = ["scalability", "cost", "latency", "security", "ux", ""];

interface StructuredChallenge {
  challengerRoleId: BrainstormRoleId;
  targetRoleId: BrainstormRoleId;
  summary: string;
  roundNumber: number;
  severity?: CritiqueSeverity;
}

interface StructuredRebuttal {
  responderRoleId: BrainstormRoleId;
  challengeSummary: string;
  summary: string;
  roundNumber: number;
  stance?: RebuttalStance;
}

const structuredChallengeArb = (): fc.Arbitrary<StructuredChallenge> =>
  fc.record({
    challengerRoleId: fc.constantFrom(...ROLE_IDS),
    targetRoleId: fc.constantFrom(...ROLE_IDS),
    summary: fc.constantFrom(...SUMMARY_POOL),
    roundNumber: fc.nat({ max: 5 }),
    severity: fc.option(fc.constantFrom(...SEVERITIES), { nil: undefined }),
  });

const structuredRebuttalArb = (): fc.Arbitrary<StructuredRebuttal> =>
  fc.record({
    responderRoleId: fc.constantFrom(...ROLE_IDS),
    challengeSummary: fc.constantFrom(...SUMMARY_POOL),
    summary: fc.constantFrom(...SUMMARY_POOL),
    roundNumber: fc.nat({ max: 5 }),
    stance: fc.option(fc.constantFrom(...STANCES), { nil: undefined }),
  });

const structuredSessionArb = (): fc.Arbitrary<BrainstormSession> =>
  fc
    .record({
      id: fc.string({ maxLength: 8 }),
      jobId: fc.string({ maxLength: 8 }),
      stageId: fc.string({ maxLength: 8 }),
      mode: fc.constantFrom(...MODES),
      roles: fc.uniqueArray(fc.constantFrom(...ROLE_IDS), { maxLength: 6 }),
      branchNodes: fc.array(branchNodeArb(), { maxLength: 8 }),
      edges: fc.array(branchEdgeArb(), { maxLength: 8 }),
      status: fc.constantFrom(...SESSION_STATUSES),
      tokenBudget: fc.nat({ max: 100_000 }),
      tokenUsed: fc.nat({ max: 100_000 }),
      hasCompletedAt: fc.boolean(),
      hasDeliberation: fc.boolean(),
      challenges: fc.array(structuredChallengeArb(), { maxLength: 5 }),
      rebuttals: fc.array(structuredRebuttalArb(), { maxLength: 5 }),
    })
    .map((raw): BrainstormSession => {
      const crewMembers = new Map<BrainstormRoleId, CrewMemberInstance>();
      for (const roleId of raw.roles) {
        crewMembers.set(roleId, crewMemberArb(roleId));
      }
      // Build a structured deliberationSummary carrying severity/stance. The
      // inline contract type does not declare severity/stance (they are read
      // defensively by the projection), so cast through the shared shape.
      const deliberationSummary =
        raw.hasDeliberation || raw.challenges.length > 0 || raw.rebuttals.length > 0
          ? ({
              roundCount: 1,
              finalConvergenceScore: 0.5,
              consensusAchieved: false,
              totalChallenges: raw.challenges.length,
              unresolvedChallengeCount: raw.challenges.length,
              challenges: raw.challenges,
              rebuttals: raw.rebuttals,
            } as unknown as BrainstormSession["deliberationSummary"])
          : undefined;
      return {
        id: raw.id,
        jobId: raw.jobId,
        stageId: raw.stageId,
        mode: raw.mode,
        crewMembers,
        branchNodes: raw.branchNodes,
        edges: raw.edges,
        status: raw.status,
        tokenBudget: raw.tokenBudget,
        tokenUsed: raw.tokenUsed,
        toolCallCount: 0,
        toolCallLimit: 20,
        startedAt: new Date(1_000),
        completedAt: raw.hasCompletedAt ? new Date(5_000) : undefined,
        deliberationSummary,
      };
    });

describe("projectSessionToReasoningGraph — Property 8: renderable with correct semantic edges", () => {
  it("always renders (even with deliberation input); debate protocol edges are NOT emitted by this projection (Validates: Requirements 6.5, 6.7, 12.3)", () => {
    fc.assert(
      fc.property(structuredSessionArb(), fc.string({ maxLength: 30 }), (session, title) => {
        const graph = projectSessionToReasoningGraph(session, title);

        // --- Renderability invariant (R6.7 / R12.3) ----------------------
        expect(graph.id.length).toBeGreaterThan(0);
        expect(graph.jobId.length).toBeGreaterThan(0);
        expect(graph.nodes.length).toBeGreaterThan(0);
        expect(graph.nodes.some((n) => n.id === CENTRAL_QUESTION_NODE_ID)).toBe(true);

        const nodeIds = new Set(graph.nodes.map((n) => n.id));
        for (const edge of graph.edges) {
          expect(edge.id.length).toBeGreaterThan(0);
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        }
        expect(isGraphRenderable(graph)).toBe(true);

        // role → representative graph node id (last branch node wins, mirroring
        // the projection's roleToNodeId), derived from the produced graph.
        const roleToNodeId = new Map<BrainstormRoleId, string>();
        for (const node of graph.nodes) {
          if (node.roleId) roleToNodeId.set(node.roleId, node.id);
        }

        const challenges = (session.deliberationSummary?.challenges ??
          []) as StructuredChallenge[];
        const rebuttals = (session.deliberationSummary?.rebuttals ??
          []) as StructuredRebuttal[];

        const conflictEdges = graph.edges.filter((e) => e.type === "conflicts");
        const supportEdges = graph.edges.filter((e) => e.type === "supports");
        const synthesizeEdges = graph.edges.filter((e) => e.type === "synthesizes");

        // IMPORTANT: This projection (used by Effect/Reasoning Flow) must NOT
        // produce "critique"/"rebuttal" nodes or the associated deliberation
        // edges. Those are isolated to the realtime debate store + overlay.
        // The presence of challenges/rebuttals in the *input* session must not
        // cause such edges in the *output* graph for this path.
        expect(conflictEdges).toHaveLength(0);
        expect(supportEdges).toHaveLength(0);

        // We still require full renderability even when the input session
        // carries rich deliberation data.
        // Synthesis edges (from actual synthesis branch nodes) are allowed.
        for (const e of synthesizeEdges) {
          expect(nodeIds.has(e.source)).toBe(true);
          expect(nodeIds.has(e.target)).toBe(true);
        }

        // --- Synthesis → synthesizes edges (R6.5) ------------------------
        const synthesisNodeIds = new Set(
          graph.nodes.filter((n) => n.type === "synthesis").map((n) => n.id),
        );
        // Soundness: every synthesizes edge targets a synthesis node.
        for (const e of synthesizeEdges) {
          expect(synthesisNodeIds.has(e.target)).toBe(true);
        }
        // Existence: when there is at least one synthesis node and at least one
        // non-synthesis branch node, at least one synthesizes edge is emitted.
        const nonSynthesisBranchNodes = graph.nodes.filter(
          (n) =>
            n.id !== CENTRAL_QUESTION_NODE_ID &&
            n.type !== "synthesis" &&
            n.roleId !== undefined,
        );
        if (synthesisNodeIds.size > 0 && nonSynthesisBranchNodes.length > 0) {
          expect(synthesizeEdges.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
