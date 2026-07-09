/**
 * Property-based tests for the brainstormGraph store slice.
 *
 * Property 14: Store node addition invariant
 * Property 15: Store bounded queue invariant
 * Property 16: Session finalization freezes updates
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md
 * Requirements: 6.2, 6.4, 6.5
 */

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import {
  useBrainstormGraphStore,
  MAX_BRAINSTORM_NODES,
} from "../brainstorm-graph-store";
import type { BranchNodeType, BranchNodeStatus, BrainstormRoleId } from "@shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const roleIdArb = fc.constantFrom(
  "planner", "architect", "executor", "auditor", "decider", "ui_previewer"
) as fc.Arbitrary<BrainstormRoleId>;

const nodeTypeArb = fc.constantFrom(
  "decision", "thinking", "action", "observation", "synthesis", "error"
) as fc.Arbitrary<BranchNodeType>;

const nodeStatusArb = fc.constantFrom(
  "pending", "active", "completed", "failed"
) as fc.Arbitrary<BranchNodeStatus>;

function resetStore() {
  useBrainstormGraphStore.getState().reset();
}

describe("Feature: autopilot-multi-agent-brainstorm, Store Properties", () => {
  beforeEach(() => {
    resetStore();
  });

  // ─── Property 14: Store node addition invariant ────────────────────────

  it("Property 14: Each node.created grows nodes by 1; if parentNodeId non-null, edges grows by 1", () => {
    /**
     * **Validates: Requirements 6.2**
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            nodeId: fc.uuid(),
            hasParent: fc.boolean(),
            roleId: roleIdArb,
            nodeType: nodeTypeArb,
            status: nodeStatusArb,
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (nodeSpecs) => {
          resetStore();
          const store = useBrainstormGraphStore.getState();
          store.handleSessionStarted({ sessionId: "prop14-session" });

          let prevNodeId: string | null = null;

          for (const spec of nodeSpecs) {
            const stateBefore = useBrainstormGraphStore.getState();
            const nodeCountBefore = stateBefore.nodes.length;
            const edgeCountBefore = stateBefore.edges.length;

            const parentNodeId = spec.hasParent && prevNodeId ? prevNodeId : null;

            useBrainstormGraphStore.getState().handleNodeCreated({
              sessionId: "prop14-session",
              nodeId: spec.nodeId,
              parentNodeId,
              roleId: spec.roleId,
              nodeType: spec.nodeType,
              status: spec.status,
            });

            const stateAfter = useBrainstormGraphStore.getState();

            // If we're below the cap, nodes grows by exactly 1
            if (nodeCountBefore < MAX_BRAINSTORM_NODES) {
              expect(stateAfter.nodes.length).toBe(nodeCountBefore + 1);
            } else {
              // At cap: still at MAX (FIFO drop + append)
              expect(stateAfter.nodes.length).toBe(MAX_BRAINSTORM_NODES);
            }

            // If parentNodeId is non-null, edges grows by 1
            // (unless the parent was dropped by FIFO, which we don't test here since
            // we only do ≤50 nodes per run, well under 500)
            if (parentNodeId !== null && nodeCountBefore < MAX_BRAINSTORM_NODES) {
              expect(stateAfter.edges.length).toBe(edgeCountBefore + 1);
            }

            prevNodeId = spec.nodeId;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 15: Store bounded queue invariant ────────────────────────

  it("Property 15: nodes array never exceeds 500 elements per active session", () => {
    /**
     * **Validates: Requirements 6.4**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 490, max: 520 }), // Number of nodes to add
        (nodeCount) => {
          resetStore();
          const store = useBrainstormGraphStore.getState();
          store.handleSessionStarted({ sessionId: "prop15-session" });

          for (let i = 0; i < nodeCount; i++) {
            useBrainstormGraphStore.getState().handleNodeCreated({
              sessionId: "prop15-session",
              nodeId: `node-${i}`,
              parentNodeId: null,
              roleId: "planner",
              nodeType: "thinking",
              status: "active",
            });

            // Invariant: nodes never exceeds MAX_BRAINSTORM_NODES
            const state = useBrainstormGraphStore.getState();
            expect(state.nodes.length).toBeLessThanOrEqual(MAX_BRAINSTORM_NODES);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 16: Session finalization freezes updates ─────────────────

  it("Property 16: After session.completed, node.created and node.updated are rejected", () => {
    /**
     * **Validates: Requirements 6.5**
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            nodeId: fc.uuid(),
            roleId: roleIdArb,
            nodeType: nodeTypeArb,
          }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.array(
          fc.record({
            nodeId: fc.uuid(),
            roleId: roleIdArb,
            nodeType: nodeTypeArb,
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (preCompletionNodes, postCompletionNodes) => {
          resetStore();
          const store = useBrainstormGraphStore.getState();
          store.handleSessionStarted({ sessionId: "prop16-session" });

          // Add nodes before completion
          for (const spec of preCompletionNodes) {
            useBrainstormGraphStore.getState().handleNodeCreated({
              sessionId: "prop16-session",
              nodeId: spec.nodeId,
              parentNodeId: null,
              roleId: spec.roleId,
              nodeType: spec.nodeType,
              status: "active",
            });
          }

          const stateBeforeComplete = useBrainstormGraphStore.getState();
          const nodeCountBeforeComplete = stateBeforeComplete.nodes.length;

          // Mark session completed
          useBrainstormGraphStore.getState().handleSessionCompleted({
            sessionId: "prop16-session",
          });

          // Try to add more nodes — should be rejected
          for (const spec of postCompletionNodes) {
            useBrainstormGraphStore.getState().handleNodeCreated({
              sessionId: "prop16-session",
              nodeId: spec.nodeId,
              parentNodeId: null,
              roleId: spec.roleId,
              nodeType: spec.nodeType,
              status: "active",
            });
          }

          const stateAfterAttempts = useBrainstormGraphStore.getState();
          expect(stateAfterAttempts.nodes.length).toBe(nodeCountBeforeComplete);

          // Try to update existing nodes — should be rejected
          if (preCompletionNodes.length > 0) {
            useBrainstormGraphStore.getState().handleNodeUpdated({
              sessionId: "prop16-session",
              nodeId: preCompletionNodes[0].nodeId,
              status: "failed",
              content: "Should not update",
            });

            const stateAfterUpdate = useBrainstormGraphStore.getState();
            const targetNode = stateAfterUpdate.nodes.find(
              (n) => n.id === preCompletionNodes[0].nodeId
            );
            if (targetNode) {
              expect(targetNode.status).toBe("active"); // Unchanged
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
