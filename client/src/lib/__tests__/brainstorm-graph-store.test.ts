/**
 * Unit tests for the brainstormGraph store slice.
 *
 * Tests initial state, event handler state transitions, bounded queue (500+),
 * session freeze behavior, and selector correctness.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §7
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  useBrainstormGraphStore,
  INITIAL_BRAINSTORM_GRAPH,
  MAX_BRAINSTORM_NODES,
  dispatchBrainstormGraphEvent,
  selectAllNodes,
  selectNodesByRole,
  selectNodesByStatus,
  selectSessionMetadata,
  selectChallengeEdges,
  selectConvergenceScore,
  selectCurrentRound,
  selectVoteOutcome,
  selectIsActive,
} from "../brainstorm-graph-store";

function resetStore() {
  useBrainstormGraphStore.getState().reset();
}

describe("brainstormGraph store", () => {
  beforeEach(() => {
    resetStore();
  });

  // ─── Initial state ─────────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts with idle status and empty arrays", () => {
      const state = useBrainstormGraphStore.getState();
      expect(state.sessionId).toBeNull();
      expect(state.sessionStatus).toBe("idle");
      expect(state.nodes).toEqual([]);
      expect(state.edges).toEqual([]);
      expect(state.currentRound).toBeNull();
      expect(state.convergenceScore).toBeNull();
      expect(state.challengeEdges).toEqual([]);
      expect(state.voteOutcome).toBeNull();
      expect(state.sessionMetadata.mode).toBeNull();
      expect(state.sessionMetadata.roles).toEqual([]);
    });
  });

  // ─── Session lifecycle ─────────────────────────────────────────────────

  describe("handleSessionStarted", () => {
    it("resets state and sets sessionId + status to active", () => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({
        sessionId: "sess-1",
        mode: "discussion",
        roles: ["planner", "architect"],
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.sessionId).toBe("sess-1");
      expect(state.sessionStatus).toBe("active");
      // handleSessionStarted now seeds one anchor node per role so that
      // challenge/support edges always have existing endpoint nodes.
      expect(state.nodes.map(n => n.id)).toEqual([
        "role:planner",
        "role:architect",
      ]);
      expect(state.nodes.every(n => n.status === "completed")).toBe(true);
      expect(state.edges).toEqual([
        { sourceNodeId: "role:planner", targetNodeId: "role:architect" },
      ]);
      expect(state.sessionMetadata.mode).toBe("discussion");
      expect(state.sessionMetadata.roles).toEqual(["planner", "architect"]);
      expect(state.sessionMetadata.startedAt).not.toBeNull();
    });

    it("clears previous session data", () => {
      const store = useBrainstormGraphStore.getState();
      // Start first session
      store.handleSessionStarted({ sessionId: "sess-old" });
      store.handleNodeCreated({
        sessionId: "sess-old",
        nodeId: "n1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });

      // Start new session
      store.handleSessionStarted({ sessionId: "sess-new", mode: "vote" });

      const state = useBrainstormGraphStore.getState();
      expect(state.sessionId).toBe("sess-new");
      expect(state.nodes).toEqual([]);
      expect(state.edges).toEqual([]);
      expect(state.currentRound).toBeNull();
      expect(state.convergenceScore).toBeNull();
      expect(state.challengeEdges).toEqual([]);
      expect(state.voteOutcome).toBeNull();
    });
  });

  describe("deliberation events", () => {
    beforeEach(() => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({ sessionId: "sess-delib" });
      store.handleNodeCreated({
        sessionId: "sess-delib",
        nodeId: "planner-node",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });
      store.handleNodeCreated({
        sessionId: "sess-delib",
        nodeId: "architect-node",
        parentNodeId: null,
        roleId: "architect",
        nodeType: "thinking",
        status: "active",
      });
    });

    it("records round, challenge, and narrow vote outcome additively", () => {
      dispatchBrainstormGraphEvent({
        type: "brainstorm.round.completed",
        payload: {
          sessionId: "sess-delib",
          roundNumber: 2,
          convergenceScore: 0.72,
        },
      });
      dispatchBrainstormGraphEvent({
        type: "brainstorm.challenge.issued",
        payload: {
          sessionId: "sess-delib",
          challengerRoleId: "planner",
          targetRoleId: "architect",
          summary: "Clarify runtime boundary.",
          roundNumber: 2,
        },
      });
      dispatchBrainstormGraphEvent({
        type: "brainstorm.vote.completed",
        payload: {
          sessionId: "sess-delib",
          winningOption: "Option A",
          margin: 0.1,
          isNarrow: true,
          minority: ["Option B"],
        },
      });

      const state = useBrainstormGraphStore.getState();
      expect(selectCurrentRound(state)).toBe(2);
      expect(selectConvergenceScore(state)).toBe(0.72);
      expect(selectChallengeEdges(state)).toEqual([
        {
          challengerRoleId: "planner",
          targetRoleId: "architect",
          summary: "Clarify runtime boundary.",
          roundNumber: 2,
          kind: "challenge",
        },
      ]);
      expect(selectVoteOutcome(state)).toEqual({
        winningOption: "Option A",
        margin: 0.1,
        isNarrow: true,
        minority: ["Option B"],
      });
    });

    it("drops minority reasoning for non-narrow vote outcomes", () => {
      dispatchBrainstormGraphEvent({
        type: "brainstorm.vote.completed",
        payload: {
          sessionId: "sess-delib",
          winningOption: "Option A",
          margin: 0.5,
          isNarrow: false,
          minority: ["Option B"],
        },
      });

      expect(useBrainstormGraphStore.getState().voteOutcome).toEqual({
        winningOption: "Option A",
        margin: 0.5,
        isNarrow: false,
      });
    });
  });

  // ─── Rebuttal → support edge (R6.6) ──────────────────────────────────────

  describe("brainstorm.rebuttal.issued dispatch (R6.6)", () => {
    beforeEach(() => {
      // Seeds role anchor nodes for planner + architect so endpoint nodes exist.
      useBrainstormGraphStore.getState().handleSessionStarted({
        sessionId: "sess-rebuttal",
        mode: "discussion",
        roles: ["planner", "architect"],
      });
    });

    it("produces a SUPPORT challenge edge from responder to challenger", () => {
      dispatchBrainstormGraphEvent({
        type: "brainstorm.rebuttal.issued",
        payload: {
          sessionId: "sess-rebuttal",
          responderRoleId: "architect",
          challengerRoleId: "planner",
          rebuttalSummary: "Hold the runtime boundary as designed.",
          stance: "defend",
          roundNumber: 3,
        },
      });

      // Reuses handleChallengeIssued: responder → challenger, kind "support".
      expect(selectChallengeEdges(useBrainstormGraphStore.getState())).toEqual([
        {
          challengerRoleId: "architect",
          targetRoleId: "planner",
          summary: "Hold the runtime boundary as designed.",
          roundNumber: 3,
          kind: "support",
        },
      ]);
    });

    it("drops the rebuttal edge when an endpoint role has no node (no dangling edge)", () => {
      // 'auditor' was never seeded as a role anchor in this session, so the
      // node-exists guard in handleChallengeIssued must reject the edge.
      dispatchBrainstormGraphEvent({
        type: "brainstorm.rebuttal.issued",
        payload: {
          sessionId: "sess-rebuttal",
          responderRoleId: "auditor",
          challengerRoleId: "planner",
          rebuttalSummary: "Unknown responder concedes.",
          stance: "concede",
          roundNumber: 1,
        },
      });

      expect(selectChallengeEdges(useBrainstormGraphStore.getState())).toEqual(
        []
      );
    });

    it("combines a challenge then its rebuttal into challenge + support edges", () => {
      dispatchBrainstormGraphEvent({
        type: "brainstorm.challenge.issued",
        payload: {
          sessionId: "sess-rebuttal",
          challengerRoleId: "planner",
          targetRoleId: "architect",
          summary: "Runtime boundary is under-specified.",
          roundNumber: 2,
        },
      });
      dispatchBrainstormGraphEvent({
        type: "brainstorm.rebuttal.issued",
        payload: {
          sessionId: "sess-rebuttal",
          responderRoleId: "architect",
          challengerRoleId: "planner",
          rebuttalSummary: "Boundary is defined in the runtime contract.",
          stance: "defend",
          roundNumber: 2,
        },
      });

      expect(selectChallengeEdges(useBrainstormGraphStore.getState())).toEqual([
        {
          challengerRoleId: "planner",
          targetRoleId: "architect",
          summary: "Runtime boundary is under-specified.",
          roundNumber: 2,
          kind: "challenge",
        },
        {
          challengerRoleId: "architect",
          targetRoleId: "planner",
          summary: "Boundary is defined in the runtime contract.",
          roundNumber: 2,
          kind: "support",
        },
      ]);
    });
  });

  // ─── Node creation ─────────────────────────────────────────────────────

  describe("dispatchBrainstormGraphEvent / decision gate", () => {
    it("renders a decision gate evaluation as a visible root decision node", () => {
      dispatchBrainstormGraphEvent({
        type: "brainstorm.gate.evaluated",
        payload: {
          jobId: "job-1",
          stageId: "route_generation",
          brainstormNeeded: true,
          recommendedMode: "division",
          requiredRoles: ["decider", "planner", "architect"],
          reasoning: "The route stage needs collaborative planning.",
        },
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.sessionId).toBe("gate:job-1:route_generation");
      expect(state.sessionStatus).toBe("active");
      // The gate evaluation seeds one anchor node per required role
      // (decider, planner, architect) and then appends the gate decision node.
      expect(state.nodes).toHaveLength(4);
      expect(state.nodes.map(n => n.id)).toEqual([
        "role:decider",
        "role:planner",
        "role:architect",
        "gate:job-1:route_generation",
      ]);
      const gateNode = state.nodes.find(
        n => n.id === "gate:job-1:route_generation"
      );
      expect(gateNode).toMatchObject({
        id: "gate:job-1:route_generation",
        parentNodeId: null,
        roleId: "decider",
        type: "decision",
        status: "completed",
        title: "Decision Gate",
        content: "The route stage needs collaborative planning.",
      });
      expect(state.sessionMetadata.mode).toBe("division");
      expect(state.sessionMetadata.roles).toEqual([
        "decider",
        "planner",
        "architect",
      ]);
    });
  });

  describe("handleNodeCreated", () => {
    beforeEach(() => {
      useBrainstormGraphStore.getState().handleSessionStarted({
        sessionId: "sess-1",
      });
    });

    it("appends a node to the nodes array", () => {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "node-1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
        title: "Root node",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0].id).toBe("node-1");
      expect(state.nodes[0].roleId).toBe("planner");
      expect(state.nodes[0].type).toBe("thinking");
    });

    it("adds an edge if parentNodeId is non-null", () => {
      const store = useBrainstormGraphStore.getState();
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "root",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "decision",
        status: "active",
      });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "child",
        parentNodeId: "root",
        roleId: "architect",
        nodeType: "thinking",
        status: "active",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0]).toEqual({
        sourceNodeId: "root",
        targetNodeId: "child",
      });
    });

    it("does not add edge if parentNodeId is null", () => {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "root",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "decision",
        status: "active",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.edges).toHaveLength(0);
    });
  });

  // ─── Node update ───────────────────────────────────────────────────────

  describe("handleNodeUpdated", () => {
    beforeEach(() => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({ sessionId: "sess-1" });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });
    });

    it("updates node status, content, confidence", () => {
      useBrainstormGraphStore.getState().handleNodeUpdated({
        sessionId: "sess-1",
        nodeId: "n1",
        status: "completed",
        content: "Analysis complete",
        confidence: 0.85,
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.nodes[0].status).toBe("completed");
      expect(state.nodes[0].content).toBe("Analysis complete");
      expect(state.nodes[0].confidence).toBe(0.85);
    });

    it("ignores updates for non-existent nodes", () => {
      useBrainstormGraphStore.getState().handleNodeUpdated({
        sessionId: "sess-1",
        nodeId: "non-existent",
        status: "completed",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.nodes[0].status).toBe("active");
    });
  });

  // ─── Bounded queue ─────────────────────────────────────────────────────

  describe("bounded queue enforcement (max 500)", () => {
    it("drops oldest node when exceeding MAX_BRAINSTORM_NODES", () => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({ sessionId: "sess-1" });

      // Add MAX_BRAINSTORM_NODES nodes
      for (let i = 0; i < MAX_BRAINSTORM_NODES; i++) {
        store.handleNodeCreated({
          sessionId: "sess-1",
          nodeId: `node-${i}`,
          parentNodeId: i > 0 ? `node-${i - 1}` : null,
          roleId: "planner",
          nodeType: "thinking",
          status: "active",
        });
      }

      let state = useBrainstormGraphStore.getState();
      expect(state.nodes).toHaveLength(MAX_BRAINSTORM_NODES);

      // Add one more → oldest should be dropped
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "node-overflow",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "action",
        status: "active",
      });

      state = useBrainstormGraphStore.getState();
      expect(state.nodes).toHaveLength(MAX_BRAINSTORM_NODES);
      expect(state.nodes[0].id).toBe("node-1"); // node-0 was dropped
      expect(state.nodes[state.nodes.length - 1].id).toBe("node-overflow");
    });

    it("removes edges referencing dropped nodes", () => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({ sessionId: "sess-1" });

      // Add nodes with edges
      for (let i = 0; i < MAX_BRAINSTORM_NODES; i++) {
        store.handleNodeCreated({
          sessionId: "sess-1",
          nodeId: `node-${i}`,
          parentNodeId: i > 0 ? `node-${i - 1}` : null,
          roleId: "planner",
          nodeType: "thinking",
          status: "active",
        });
      }

      // Overflow
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "node-overflow",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "action",
        status: "active",
      });

      const state = useBrainstormGraphStore.getState();
      // Edge from node-0 → node-1 should be removed
      const edgesFromDropped = state.edges.filter(
        e => e.sourceNodeId === "node-0" || e.targetNodeId === "node-0"
      );
      expect(edgesFromDropped).toHaveLength(0);
    });
  });

  // ─── Session freeze ────────────────────────────────────────────────────

  describe("session finalization freeze", () => {
    beforeEach(() => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({ sessionId: "sess-1" });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });
      store.handleSessionCompleted({ sessionId: "sess-1" });
    });

    it("sets status to completed", () => {
      const state = useBrainstormGraphStore.getState();
      expect(state.sessionStatus).toBe("completed");
    });

    it("rejects node.created after completion", () => {
      useBrainstormGraphStore.getState().handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n2",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.nodes).toHaveLength(1); // Still just 1
    });

    it("rejects node.updated after completion", () => {
      useBrainstormGraphStore.getState().handleNodeUpdated({
        sessionId: "sess-1",
        nodeId: "n1",
        status: "failed",
      });

      const state = useBrainstormGraphStore.getState();
      expect(state.nodes[0].status).toBe("active"); // Unchanged
    });
  });

  // ─── Selectors ─────────────────────────────────────────────────────────

  describe("selectors", () => {
    beforeEach(() => {
      const store = useBrainstormGraphStore.getState();
      store.handleSessionStarted({
        sessionId: "sess-1",
        mode: "discussion",
        roles: ["planner", "architect"],
      });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
        status: "active",
      });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n2",
        parentNodeId: "n1",
        roleId: "architect",
        nodeType: "action",
        status: "completed",
      });
      store.handleNodeCreated({
        sessionId: "sess-1",
        nodeId: "n3",
        parentNodeId: "n1",
        roleId: "planner",
        nodeType: "observation",
        status: "active",
      });
    });

    it("selectAllNodes returns all nodes", () => {
      const state = useBrainstormGraphStore.getState();
      // 2 seeded role anchors (planner, architect) + 3 created nodes.
      expect(selectAllNodes(state)).toHaveLength(5);
    });

    it("selectNodesByRole filters correctly", () => {
      const state = useBrainstormGraphStore.getState();
      // role:planner anchor + n1 + n3
      expect(selectNodesByRole(state, "planner")).toHaveLength(3);
      // role:architect anchor + n2
      expect(selectNodesByRole(state, "architect")).toHaveLength(2);
    });

    it("selectNodesByStatus filters correctly", () => {
      const state = useBrainstormGraphStore.getState();
      // n1 + n3 are active; seeded anchors are completed.
      expect(selectNodesByStatus(state, "active")).toHaveLength(2);
      // n2 + 2 seeded anchors (planner, architect) are completed.
      expect(selectNodesByStatus(state, "completed")).toHaveLength(3);
    });

    it("selectSessionMetadata returns metadata", () => {
      const state = useBrainstormGraphStore.getState();
      const meta = selectSessionMetadata(state);
      expect(meta.mode).toBe("discussion");
      expect(meta.roles).toEqual(["planner", "architect"]);
    });

    it("selectIsActive returns true for active sessions", () => {
      const state = useBrainstormGraphStore.getState();
      expect(selectIsActive(state)).toBe(true);
    });

    it("selectIsActive returns false for completed sessions", () => {
      useBrainstormGraphStore.getState().handleSessionCompleted({
        sessionId: "sess-1",
      });
      const state = useBrainstormGraphStore.getState();
      expect(selectIsActive(state)).toBe(false);
    });
  });
});
