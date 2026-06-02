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
      expect(state.nodes).toEqual([]);
      expect(state.edges).toEqual([]);
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
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0]).toMatchObject({
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
        (e) => e.sourceNodeId === "node-0" || e.targetNodeId === "node-0"
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
      store.handleSessionStarted({ sessionId: "sess-1", mode: "discussion", roles: ["planner", "architect"] });
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
      expect(selectAllNodes(state)).toHaveLength(3);
    });

    it("selectNodesByRole filters correctly", () => {
      const state = useBrainstormGraphStore.getState();
      expect(selectNodesByRole(state, "planner")).toHaveLength(2);
      expect(selectNodesByRole(state, "architect")).toHaveLength(1);
    });

    it("selectNodesByStatus filters correctly", () => {
      const state = useBrainstormGraphStore.getState();
      expect(selectNodesByStatus(state, "active")).toHaveLength(2);
      expect(selectNodesByStatus(state, "completed")).toHaveLength(1);
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
