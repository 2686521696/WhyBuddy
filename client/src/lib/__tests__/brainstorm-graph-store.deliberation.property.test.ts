import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  dispatchBrainstormGraphEvent,
  MAX_BRAINSTORM_NODES,
  useBrainstormGraphStore,
} from "../brainstorm-graph-store";

function resetStore() {
  useBrainstormGraphStore.getState().reset();
}

function startWithRoles(sessionId = "sess-delib") {
  useBrainstormGraphStore.getState().handleSessionStarted({
    sessionId,
    roles: ["planner", "architect", "auditor"],
  });
  for (const roleId of ["planner", "architect", "auditor"] as const) {
    useBrainstormGraphStore.getState().handleNodeCreated({
      sessionId,
      nodeId: `role-${roleId}`,
      parentNodeId: null,
      roleId,
      nodeType: "thinking",
      status: "active",
      title: roleId,
    });
  }
}

describe("Feature: blueprint-v4-full-loop-completion, Brainstorm deliberation properties", () => {
  beforeEach(() => {
    resetStore();
  });

  it("Property 23: HUD wall bounded-queue invariant preserved across deliberation events", () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 100 }), (scores) => {
        resetStore();
        startWithRoles();
        for (const [index, score] of scores.entries()) {
          dispatchBrainstormGraphEvent({
            type: "brainstorm.round.completed",
            payload: {
              sessionId: "sess-delib",
              roundNumber: index + 1,
              convergenceScore: score,
            },
          });
          expect(useBrainstormGraphStore.getState().nodes.length).toBeLessThanOrEqual(
            MAX_BRAINSTORM_NODES,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 24: Challenge edge references two known role nodes or is dropped", () => {
    fc.assert(
      fc.property(fc.boolean(), (knownTarget) => {
        resetStore();
        startWithRoles();
        dispatchBrainstormGraphEvent({
          type: "brainstorm.challenge.issued",
          payload: {
            sessionId: "sess-delib",
            challengeId: "challenge-1",
            challengerRoleId: "planner",
            targetRoleId: knownTarget ? "architect" : "missing-role",
            summary: "Need stronger evidence.",
            roundNumber: 1,
          },
        });

        const state = useBrainstormGraphStore.getState();
        expect(state.challengeEdges).toHaveLength(knownTarget ? 1 : 0);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 25: Defensive consumption of malformed or session-mismatched events", () => {
    fc.assert(
      fc.property(fc.string(), (wrongSessionId) => {
        resetStore();
        startWithRoles("sess-real");
        dispatchBrainstormGraphEvent({
          type: "brainstorm.round.completed",
          payload: { sessionId: wrongSessionId, roundNumber: "bad" },
        });
        dispatchBrainstormGraphEvent({
          type: "brainstorm.vote.completed",
          payload: { sessionId: wrongSessionId, winningOption: 42 },
        });
        const state = useBrainstormGraphStore.getState();
        expect(state.currentRound).toBeNull();
        expect(state.voteOutcome).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
