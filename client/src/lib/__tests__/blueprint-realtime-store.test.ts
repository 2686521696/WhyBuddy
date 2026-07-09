/**
 * BlueprintRealtimeStore 单元测试。
 *
 * 对应 `.kiro/specs/autopilot-realtime-observation-bridge` Task 2.6。
 * 至少 8 条 example-based 用例，覆盖初始状态、事件分发、有界队列、订阅/退订。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Mock Socket.IO
// ---------------------------------------------------------------------------

type SocketHandler = (...args: unknown[]) => void;

const socketHandlers = new Map<string, SocketHandler>();
const mockSocket = {
  connected: false,
  on: vi.fn((event: string, handler: SocketHandler) => {
    socketHandlers.set(event, handler);
    return mockSocket;
  }),
  off: vi.fn((event?: string) => {
    if (event) {
      socketHandlers.delete(event);
    }
    return mockSocket;
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
} as unknown as Socket;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

// ---------------------------------------------------------------------------
// Import store after mocks
// ---------------------------------------------------------------------------

import {
  useBlueprintRealtimeStore,
  __setSocket,
  __setHydrateHistoricalEventsForTest,
  mapEventTypeToPhase,
  type BlueprintRelayedEvent,
} from "../blueprint-realtime-store";
import { useBrainstormGraphStore } from "../brainstorm-graph-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useBlueprintRealtimeStore.getState().reset();
  useBrainstormGraphStore.getState().reset();
  __setHydrateHistoricalEventsForTest(null);
  socketHandlers.clear();
  vi.clearAllMocks();
}

function makeEvent(
  overrides: Partial<BlueprintRelayedEvent> = {}
): BlueprintRelayedEvent {
  return {
    type: "role.activated",
    jobId: "job-1",
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlueprintRealtimeStore", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  // 1. 初始状态：所有字段为空/默认
  it("should have correct initial state", () => {
    const state = useBlueprintRealtimeStore.getState();

    expect(state.subscribedJobId).toBeNull();
    expect(state.rolePhases).toEqual({});
    expect(state.agentProgress).toEqual([]);
    expect(state.capabilityStatuses).toEqual({});
    expect(state.capabilityOwners).toEqual({});
    expect(state.logEntries).toEqual([]);
    expect(state.fleetRoleCards).toEqual([]);
    expect(state.connectionState).toBe("disconnected");
  });

  // 2. dispatchEvent role.activated → rolePhases 更新
  it("should update rolePhases on role.activated event", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "role.activated",
        payload: { roleId: "planner-1" },
      })
    );

    const state = useBlueprintRealtimeStore.getState();
    expect(state.rolePhases["planner-1"]).toBe("activated");
  });

  it("routes brainstorm realtime events into the brainstorm graph store", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "brainstorm.session.started",
        payload: {
          sessionId: "brainstorm-session-1",
          mode: "vote",
          roles: ["planner", "architect"],
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "brainstorm.node.created",
        payload: {
          sessionId: "brainstorm-session-1",
          nodeId: "node-1",
          parentNodeId: null,
          roleId: "planner",
          nodeType: "thinking",
          status: "active",
          title: "Planner thought",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "brainstorm.session.completed",
        payload: {
          sessionId: "brainstorm-session-1",
          tokenUsed: 123,
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.sessionId).toBe("brainstorm-session-1");
    expect(graph.sessionStatus).toBe("completed");
    expect(graph.sessionMetadata.mode).toBe("vote");
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["role:planner", "role:architect", "node-1"])
    );
    expect(graph.nodes.find((node) => node.id === "node-1")).toMatchObject({
      id: "node-1",
      roleId: "planner",
      type: "thinking",
      title: "Planner thought",
    });
    expect(graph.sessionMetadata.totalTokenUsage).toBe(123);
  });

  it("seeds runtime role anchors when a brainstorm session starts", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "brainstorm.session.started",
        payload: {
          sessionId: "brainstorm-session-five-roles",
          mode: "discussion",
          roles: ["decider", "planner", "architect", "executor", "auditor"],
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "role:decider",
        "role:planner",
        "role:architect",
        "role:executor",
        "role:auditor",
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { sourceNodeId: "role:decider", targetNodeId: "role:planner" },
        { sourceNodeId: "role:planner", targetNodeId: "role:architect" },
        { sourceNodeId: "role:architect", targetNodeId: "role:executor" },
        { sourceNodeId: "role:executor", targetNodeId: "role:auditor" },
      ])
    );
  });

  it("fans branch decision markers out to seeded role anchors", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "decision-gate:job-1:spec_docs",
          stage: "spec_docs",
          nodeId: "decision-gate",
          roleId: "decision-gate",
          marker: "BRANCH",
          rationale: "Route to multi-agent brainstorm.",
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "decision-gate",
        "role:decider",
        "role:planner",
        "role:architect",
        "role:executor",
        "role:auditor",
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { sourceNodeId: "decision-gate", targetNodeId: "role:decider" },
        { sourceNodeId: "decision-gate", targetNodeId: "role:planner" },
        { sourceNodeId: "decision-gate", targetNodeId: "role:architect" },
        { sourceNodeId: "decision-gate", targetNodeId: "role:executor" },
        { sourceNodeId: "decision-gate", targetNodeId: "role:auditor" },
      ])
    );
  });

  it("routes autonomous runtime graph events into visible brainstorm wall nodes", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "decision-gate:job-1:spec_docs",
          stage: "spec_docs",
          nodeId: "decision-gate",
          roleId: "decision-gate",
          marker: "BRANCH",
          rationale: "The SPEC stage needs multi-role branching.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "edge.condition.evaluated",
        jobId: "job-1",
        payload: {
          sessionId: "decision-gate:job-1:spec_docs",
          edgeId: "decision-gate:brainstorm",
          sourceNodeId: "decision-gate",
          targetNodeId: "brainstorm-orchestrator",
          condition: "brainstormNeeded === true",
          matched: true,
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "edge.triggered",
        jobId: "job-1",
        payload: {
          sessionId: "decision-gate:job-1:spec_docs",
          edgeId: "decision-gate:brainstorm",
          sourceNodeId: "decision-gate",
          targetNodeId: "brainstorm-orchestrator",
          reason: "Route to brainstorm orchestrator.",
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.sessionId).toBe("decision-gate:job-1:spec_docs");
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "role:decider",
        "role:planner",
        "role:architect",
        "role:auditor",
        "decision-gate",
        "edge-condition:decision-gate:brainstorm",
        "brainstorm-orchestrator",
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        {
          sourceNodeId: "decision-gate",
          targetNodeId: "edge-condition:decision-gate:brainstorm",
        },
        {
          sourceNodeId: "decision-gate",
          targetNodeId: "brainstorm-orchestrator",
        },
      ])
    );
  });

  it("routes autonomous synthesis events into a visible synthesis wall node", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-synthesis",
          nodeId: "node-planner",
          roleId: "planner",
          marker: "BRANCH",
          rationale: "Planner branch exists.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "synthesis.started",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-synthesis",
          sourceNodeIds: ["node-planner"],
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "synthesis.completed",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-synthesis",
          synthesisNodeId: "node-synthesis",
          sourceNodeIds: ["node-planner"],
          summary: "Merged multi-role decision.",
          confidence: 0.91,
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.nodes.map((node) => node.id)).toContain("node-synthesis");
    expect(graph.nodes.find((node) => node.id === "node-synthesis")).toMatchObject({
      roleId: "decider",
      type: "synthesis",
      status: "completed",
      content: "Merged multi-role decision.",
      confidence: 0.91,
    });
    expect(graph.edges).toContainEqual({
      sourceNodeId: "node-planner",
      targetNodeId: "node-synthesis",
    });
  });

  it("routes autonomous challenge/support events into visible role interaction edges", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-interactions",
          nodeId: "challenge:1:planner:0",
          roleId: "planner",
          targetRoleId: "architect",
          marker: "CHALLENGE",
          rationale: "Planner challenges architect risk handling.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "edge.triggered",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-interactions",
          edgeId: "challenge:1:planner:0",
          sourceNodeId: "role:planner",
          targetNodeId: "role:architect",
          reason: "Planner challenges architect.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-interactions",
          nodeId: "rebuttal:challenge:1:planner:0:0",
          roleId: "architect",
          targetRoleId: "planner",
          marker: "SUPPORT",
          rationale: "Architect responds to planner.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "edge.triggered",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-interactions",
          edgeId: "rebuttal:challenge:1:planner:0:0",
          sourceNodeId: "role:architect",
          targetNodeId: "role:planner",
          reason: "Architect responds to planner.",
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["role:planner", "role:architect", "challenge:1:planner:0"])
    );
    expect(graph.edges).toContainEqual({
      sourceNodeId: "role:planner",
      targetNodeId: "role:architect",
    });
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "planner",
      targetRoleId: "architect",
      summary: "Planner challenges architect.",
      roundNumber: 1,
      kind: "challenge",
    });
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "architect",
      targetRoleId: "planner",
      summary: "Architect responds to planner.",
      roundNumber: 1,
      kind: "support",
    });
  });

  it("turns autonomous challenge/support markers themselves into visible role interactions", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-marker-interactions",
          nodeId: "challenge:planner:architect",
          roleId: "planner",
          targetRoleId: "architect",
          marker: "CHALLENGE",
          rationale: "Planner challenges architecture risk.",
          roundNumber: 2,
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        jobId: "job-1",
        payload: {
          sessionId: "brainstorm-session-marker-interactions",
          nodeId: "rebuttal:architect:planner",
          roleId: "architect",
          targetRoleId: "planner",
          marker: "SUPPORT",
          rationale: "Architect rebuts with implementation guardrails.",
          roundNumber: 2,
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.edges).toContainEqual({
      sourceNodeId: "role:planner",
      targetNodeId: "role:architect",
    });
    expect(graph.edges).toContainEqual({
      sourceNodeId: "role:architect",
      targetNodeId: "role:planner",
    });
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "planner",
      targetRoleId: "architect",
      summary: "Planner challenges architecture risk.",
      roundNumber: 2,
      kind: "challenge",
    });
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "architect",
      targetRoleId: "planner",
      summary: "Architect rebuts with implementation guardrails.",
      roundNumber: 2,
      kind: "support",
    });
  });

  it("routes legacy brainstorm challengeSummary and rebuttalSummary payloads into role interaction overlays", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "brainstorm.session.started",
        payload: {
          sessionId: "brainstorm-session-legacy-interactions",
          roles: ["planner", "architect"],
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "brainstorm.challenge.issued",
        payload: {
          sessionId: "brainstorm-session-legacy-interactions",
          challengerRoleId: "planner",
          targetRoleId: "architect",
          challengeSummary: "Legacy challenge summary.",
          roundNumber: 1,
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "brainstorm.rebuttal.issued",
        payload: {
          sessionId: "brainstorm-session-legacy-interactions",
          responderRoleId: "architect",
          challengerRoleId: "planner",
          rebuttalSummary: "Legacy rebuttal summary.",
          roundNumber: 1,
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "planner",
      targetRoleId: "architect",
      summary: "Legacy challenge summary.",
      roundNumber: 1,
      kind: "challenge",
    });
    expect(graph.challengeEdges).toContainEqual({
      challengerRoleId: "architect",
      targetRoleId: "planner",
      summary: "Legacy rebuttal summary.",
      roundNumber: 1,
      kind: "support",
    });
  });

  it("routes autonomous tool and loop events into visible wall nodes", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "decision.marker.emitted",
        payload: {
          sessionId: "brainstorm-session-tool-loop",
          nodeId: "decision-marker",
          roleId: "planner",
          marker: "BRANCH",
          rationale: "Branch first.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "tool.action.selected",
        payload: {
          sessionId: "brainstorm-session-tool-loop",
          nodeId: "role:planner",
          roleId: "planner",
          toolId: "spec-tree-diff",
          rationale: "Inspect tree drift.",
        },
      })
    );
    dispatchEvent(
      makeEvent({
        type: "loop.continued",
        payload: {
          sessionId: "brainstorm-session-tool-loop",
          roleId: "auditor",
          nextRoundNumber: 3,
          reason: "Dissent remains unresolved.",
        },
      })
    );

    const graph = useBrainstormGraphStore.getState();
    expect(graph.nodes.some((node) => node.id.startsWith("tool:spec-tree-diff:"))).toBe(true);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "loop:3",
        roleId: "auditor",
        type: "observation",
        content: "Dissent remains unresolved.",
      })
    );
    expect(graph.currentRound).toBe(3);
  });

  it("maps brainstorm node lifecycle events into visible role phases", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "brainstorm.node.created",
        payload: {
          sessionId: "brainstorm-session-2",
          nodeId: "node-2",
          parentNodeId: null,
          roleId: "planner",
          nodeType: "thinking",
          status: "active",
        },
      })
    );

    expect(useBlueprintRealtimeStore.getState().rolePhases.planner).toBe("thinking");

    dispatchEvent(
      makeEvent({
        type: "brainstorm.node.created",
        payload: {
          sessionId: "brainstorm-session-2",
          nodeId: "node-3",
          parentNodeId: "node-2",
          roleId: "architect",
          nodeType: "action",
          status: "active",
        },
      })
    );

    expect(useBlueprintRealtimeStore.getState().rolePhases.architect).toBe("acting");

    dispatchEvent(
      makeEvent({
        type: "brainstorm.node.updated",
        payload: {
          sessionId: "brainstorm-session-2",
          nodeId: "node-3",
          roleId: "architect",
          status: "completed",
        },
      })
    );

    expect(useBlueprintRealtimeStore.getState().rolePhases.architect).toBe("completed");
  });

  // 3. dispatchEvent capability.completed → capabilityStatuses 更新
  it("should update capabilityStatuses on capability.completed event", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "capability.completed",
        payload: { capabilityId: "cap-42" },
      })
    );

    const state = useBlueprintRealtimeStore.getState();
    expect(state.capabilityStatuses["cap-42"]).toBe("completed");
  });

  it("should retain the real capability owner from capability event payload", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "capability.completed",
        timestamp: 12345,
        payload: {
          capabilityId: "aigc-spec-node",
          roleId: "role-runtime-executor",
          invocationId: "inv-123",
        },
      })
    );

    const state = useBlueprintRealtimeStore.getState();
    expect(state.capabilityStatuses["aigc-spec-node"]).toBe("completed");
    expect(state.capabilityOwners["aigc-spec-node"]).toEqual({
      roleId: "role-runtime-executor",
      invocationId: "inv-123",
      updatedAt: 12345,
    });
  });

  it("should surface role container provisioning from payload.key.roleId", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "role.container.provisioning",
        payload: {
          key: {
            jobId: "job-1",
            stageId: "spec_tree",
            roleId: "planner",
          },
          bindingSummary: {
            mcpCount: 0,
            skillCount: 0,
            aigcNodeCount: 2,
            skippedMcps: 0,
            skippedSkills: 0,
          },
        },
      })
    );

    const state = useBlueprintRealtimeStore.getState();
    expect(state.rolePhases.planner).toBe("activated");
    expect(state.capabilityStatuses["role-container-loader:planner"]).toBe(
      "invoking"
    );
    expect(state.roleRuntimeStates.planner).toMatchObject({
      roleId: "planner",
      jobId: "job-1",
      stageId: "spec_tree",
      status: "provisioning",
      runtimeKind: "missing",
      bindingSummary: {
        mcpCount: 0,
        skillCount: 0,
        aigcNodeCount: 2,
        skippedMcps: 0,
        skippedSkills: 0,
      },
    });
  });

  it("should surface role container ready fallback evidence", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(
      makeEvent({
        type: "role.container.ready",
        payload: {
          key: {
            jobId: "job-1",
            stageId: "spec_tree",
            roleId: "planner",
          },
          containerMode: "lite",
          executionMode: "simulated_fallback",
          fallbackReason: "executor unreachable",
          bindingSummary: {
            mcpCount: 1,
            skillCount: 3,
            aigcNodeCount: 2,
            skippedMcps: 0,
            skippedSkills: 1,
          },
        },
      })
    );

    const state = useBlueprintRealtimeStore.getState();
    expect(state.rolePhases.planner).toBe("activated");
    expect(state.capabilityStatuses["role-container-loader:planner"]).toBe(
      "completed"
    );
    expect(state.roleRuntimeStates.planner).toMatchObject({
      roleId: "planner",
      jobId: "job-1",
      stageId: "spec_tree",
      status: "ready",
      runtimeKind: "fallback",
      containerMode: "lite",
      executionMode: "simulated_fallback",
      fallbackReason: "executor unreachable",
      bindingSummary: {
        mcpCount: 1,
        skillCount: 3,
        aigcNodeCount: 2,
        skippedMcps: 0,
        skippedSkills: 1,
      },
    });
  });

  // 4. dispatchEvent 任意事件 → logEntries 追加
  it("should append to logEntries on any event", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    dispatchEvent(makeEvent({ type: "job.created" }));
    dispatchEvent(makeEvent({ type: "role.sleeping", payload: { roleId: "r1" } }));

    const state = useBlueprintRealtimeStore.getState();
    expect(state.logEntries).toHaveLength(2);
    expect(state.logEntries[0].message).toBe("job.created");
    expect(state.logEntries[1].message).toBe("role.sleeping");
  });

  // 5. logEntries 超过 200 条时截断最旧
  it("should truncate logEntries to 200 when exceeding limit", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    // 先填充 200 条
    for (let i = 0; i < 200; i++) {
      dispatchEvent(
        makeEvent({ type: "job.stage", timestamp: 1000 + i })
      );
    }

    expect(useBlueprintRealtimeStore.getState().logEntries).toHaveLength(200);

    // 再加 5 条，应该截断最旧的
    for (let i = 0; i < 5; i++) {
      dispatchEvent(
        makeEvent({ type: "job.stage", timestamp: 2000 + i })
      );
    }

    const state = useBlueprintRealtimeStore.getState();
    expect(state.logEntries).toHaveLength(200);
    // 最旧的应该是第 6 条（index 5）
    expect(state.logEntries[0].timestamp).toBe(1005);
  });

  // 6. agentProgress 超过 50 条时截断最旧
  it("should truncate agentProgress to 50 when exceeding limit", () => {
    const { dispatchEvent } = useBlueprintRealtimeStore.getState();

    // job.stage 事件会追加到 agentProgress
    for (let i = 0; i < 55; i++) {
      dispatchEvent(
        makeEvent({
          type: "job.stage",
          payload: { roleId: `role-${i}`, message: `step ${i}` },
        })
      );
    }

    const state = useBlueprintRealtimeStore.getState();
    expect(state.agentProgress).toHaveLength(50);
    // 最旧的 5 条被截断
    expect(state.agentProgress[0].message).toBe("step 5");
  });

  // 7. subscribe 设置 subscribedJobId
  it("should set subscribedJobId on subscribe", () => {
    (mockSocket as unknown as { connected: boolean }).connected = true;

    useBlueprintRealtimeStore.getState().subscribe("job-abc");

    const state = useBlueprintRealtimeStore.getState();
    expect(state.subscribedJobId).toBe("job-abc");
    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:subscribe", {
      jobId: "job-abc",
    });
  });

  // 8. unsubscribe 重置状态（但不清空 logEntries，保留历史）
  it("hydrates historical brainstorm node events into the wall graph store on subscribe", async () => {
    (mockSocket as unknown as { connected: boolean }).connected = true;
    __setHydrateHistoricalEventsForTest(async (jobId) => [
      {
        id: "evt-session-started",
        family: "brainstorm",
        type: "brainstorm.session.started",
        jobId,
        stage: "spec_tree",
        status: "running",
        message: "brainstorm.session.started",
        occurredAt: "2026-06-08T14:29:44.959Z",
        sessionId: "brainstorm-session-history",
        mode: "discussion",
        roles: ["decider", "planner", "architect", "auditor"],
      },
      {
        id: "evt-node-created",
        family: "brainstorm",
        type: "brainstorm.node.created",
        jobId,
        stage: "spec_tree",
        status: "running",
        message: "brainstorm.node.created",
        occurredAt: "2026-06-08T14:29:45.100Z",
        sessionId: "brainstorm-session-history",
        nodeId: "node-history-1",
        parentNodeId: null,
        roleId: "planner",
        nodeType: "thinking",
      },
      {
        id: "evt-node-updated",
        family: "brainstorm",
        type: "brainstorm.node.updated",
        jobId,
        stage: "spec_tree",
        status: "running",
        message: "brainstorm.node.updated",
        occurredAt: "2026-06-08T14:29:46.000Z",
        sessionId: "brainstorm-session-history",
        nodeId: "node-history-1",
        roleId: "planner",
        payload: {
          status: "completed",
          content: "Historical branch content",
          confidence: 0.82,
        },
      },
    ]);

    useBlueprintRealtimeStore.getState().subscribe("job-history");
    await vi.waitFor(() => {
      expect(
        useBrainstormGraphStore.getState().nodes.some((node) => node.id === "node-history-1")
      ).toBe(true);
    });

    const graph = useBrainstormGraphStore.getState();
    expect(graph.sessionId).toBe("brainstorm-session-history");
    expect(graph.sessionStatus).toBe("active");
    expect(graph.nodes.find((node) => node.id === "node-history-1")).toMatchObject({
      id: "node-history-1",
      roleId: "planner",
      type: "thinking",
      status: "completed",
      title: "",
      content: "Historical branch content",
      confidence: 0.82,
    });
  });

  it("should reset state on unsubscribe and clear active logEntries", () => {
    (mockSocket as unknown as { connected: boolean }).connected = true;

    const store = useBlueprintRealtimeStore.getState();
    store.subscribe("job-xyz");

    // 模拟一些事件
    store.dispatchEvent(
      makeEvent({
        type: "role.activated",
        jobId: "job-xyz",
        payload: { roleId: "r1" },
      })
    );
    store.dispatchEvent(
      makeEvent({
        type: "capability.invoked",
        jobId: "job-xyz",
        payload: {
          capabilityId: "c1",
          roleId: "r1",
          invocationId: "inv-reset",
        },
      })
    );

    // 确认有数据
    expect(useBlueprintRealtimeStore.getState().logEntries.length).toBeGreaterThan(0);
    expect(useBlueprintRealtimeStore.getState().rolePhases["r1"]).toBe("activated");

    // 退订
    useBlueprintRealtimeStore.getState().unsubscribe();

    const state = useBlueprintRealtimeStore.getState();
    expect(state.subscribedJobId).toBeNull();
    expect(state.rolePhases).toEqual({});
    expect(state.capabilityStatuses).toEqual({});
    expect(state.capabilityOwners).toEqual({});
    expect(state.agentProgress).toEqual([]);
    expect(state.logEntries).toEqual([]);
  });

  // 9. 额外：connectionState 跟踪
  it("should track connectionState on connect/disconnect", () => {
    (mockSocket as unknown as { connected: boolean }).connected = false;

    useBlueprintRealtimeStore.getState().subscribe("job-conn");

    // 初始应为 connecting
    expect(useBlueprintRealtimeStore.getState().connectionState).toBe("connecting");

    // 模拟连接成功
    const connectHandler = socketHandlers.get("connect");
    expect(connectHandler).toBeDefined();
    connectHandler!();

    expect(useBlueprintRealtimeStore.getState().connectionState).toBe("connected");

    // 模拟断开
    const disconnectHandler = socketHandlers.get("disconnect");
    expect(disconnectHandler).toBeDefined();
    disconnectHandler!();

    expect(useBlueprintRealtimeStore.getState().connectionState).toBe("disconnected");
  });

  // 10. 额外：重连后自动恢复订阅
  it("should re-subscribe on reconnect if subscribedJobId is set", () => {
    (mockSocket as unknown as { connected: boolean }).connected = false;

    useBlueprintRealtimeStore.getState().subscribe("job-reconnect");

    // 模拟连接
    const connectHandler = socketHandlers.get("connect");
    connectHandler!();

    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:subscribe", {
      jobId: "job-reconnect",
    });

    // 清除调用记录
    vi.clearAllMocks();

    // 模拟断开再重连
    const disconnectHandler = socketHandlers.get("disconnect");
    disconnectHandler!();
    connectHandler!();

    // 应该重新发送订阅
    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:subscribe", {
      jobId: "job-reconnect",
    });
  });
});

// ---------------------------------------------------------------------------
// sliderule-3d-real-role-driven-scene-2026-05-29 Requirement 10 (Fix 1):
// role.agent.* reasoning events drive rolePhases.
//
// mapEventTypeToPhase 现在为 7 个 role.agent.* 事件返回阶段，使其经由既有
// `if (type.startsWith("role."))` 分支流入 rolePhases[roleId]，同时不破坏既有
// role.agent.* → agentReasoning slice 行为（两条分支并行）。
// ---------------------------------------------------------------------------

describe("mapEventTypeToPhase — role.agent.* reasoning events (Fix 1)", () => {
  // Unit-level: direct call mappings for all 7 role.agent.* types (Req 10.1-10.7).
  it("maps role.agent.iteration_started → activated", () => {
    expect(mapEventTypeToPhase("role.agent.iteration_started")).toBe(
      "activated"
    );
  });

  it("maps role.agent.thinking → thinking", () => {
    expect(mapEventTypeToPhase("role.agent.thinking")).toBe("thinking");
  });

  it("maps role.agent.acting → acting", () => {
    expect(mapEventTypeToPhase("role.agent.acting")).toBe("acting");
  });

  it("maps role.agent.observing → observing", () => {
    expect(mapEventTypeToPhase("role.agent.observing")).toBe("observing");
  });

  it("maps role.agent.iteration_completed → observing (NOT completed)", () => {
    // 故意映射到 observing 而非 completed：避免多迭代角色在两次迭代之间
    // 闪烁到 faded 的 completed tier 再弹回（Req 10.5）。
    expect(mapEventTypeToPhase("role.agent.iteration_completed")).toBe(
      "observing"
    );
    expect(mapEventTypeToPhase("role.agent.iteration_completed")).not.toBe(
      "completed"
    );
  });

  it("maps role.agent.completed → completed", () => {
    expect(mapEventTypeToPhase("role.agent.completed")).toBe("completed");
  });

  it("maps role.agent.error → failed", () => {
    expect(mapEventTypeToPhase("role.agent.error")).toBe("failed");
  });
});

describe(
  "BlueprintRealtimeStore — role.agent.* events flow into rolePhases (Fix 1)",
  () => {
    beforeEach(() => {
      __setSocket(mockSocket);
      resetStore();
    });

    afterEach(() => {
      resetStore();
      __setSocket(null);
    });

    // Integration-level: dispatching a role.agent.thinking event (mirroring the
    // server emitter shape with both a top-level roleId and payload.roleId)
    // writes the mapped phase into rolePhases[roleId] (Req 10.8).
    it("dispatch role.agent.thinking → rolePhases[roleId] === 'thinking'", () => {
      const { dispatchEvent } = useBlueprintRealtimeStore.getState();

      dispatchEvent({
        type: "role.agent.thinking",
        jobId: "job-1",
        timestamp: Date.now(),
        // 镜像服务端 emitter 形态：顶层 roleId + payload.roleId 同时存在。
        roleId: "intake-coordinator",
        payload: { roleId: "intake-coordinator" },
      } as unknown as BlueprintRelayedEvent);

      expect(
        useBlueprintRealtimeStore.getState().rolePhases["intake-coordinator"]
      ).toBe("thinking");
    });

    it("dispatch role.agent.completed → rolePhases[roleId] === 'completed'", () => {
      const { dispatchEvent } = useBlueprintRealtimeStore.getState();

      dispatchEvent({
        type: "role.agent.completed",
        jobId: "job-1",
        timestamp: Date.now(),
        roleId: "intake-coordinator",
        payload: { roleId: "intake-coordinator" },
      } as unknown as BlueprintRelayedEvent);

      expect(
        useBlueprintRealtimeStore.getState().rolePhases["intake-coordinator"]
      ).toBe("completed");
    });

    it("dispatch role.agent.error → rolePhases[roleId] === 'failed'", () => {
      const { dispatchEvent } = useBlueprintRealtimeStore.getState();

      dispatchEvent({
        type: "role.agent.error",
        jobId: "job-1",
        timestamp: Date.now(),
        roleId: "intake-coordinator",
        payload: { roleId: "intake-coordinator" },
      } as unknown as BlueprintRelayedEvent);

      expect(
        useBlueprintRealtimeStore.getState().rolePhases["intake-coordinator"]
      ).toBe("failed");
    });

    // Parallel slice non-regression: dispatching role.agent.thinking still
    // populates the agentReasoning slice — Fix 1 did not break the reasoning
    // path (Req 10.9). Both the rolePhases branch and the agentReasoning branch
    // run in parallel.
    it("dispatch role.agent.thinking still populates agentReasoning (parallel path intact)", () => {
      const { dispatchEvent } = useBlueprintRealtimeStore.getState();

      dispatchEvent({
        type: "role.agent.thinking",
        jobId: "job-1",
        timestamp: Date.now(),
        roleId: "intake-coordinator",
        payload: {
          roleId: "intake-coordinator",
          iteration: 1,
          thought: "分析意图",
        },
      } as unknown as BlueprintRelayedEvent);

      const state = useBlueprintRealtimeStore.getState();
      // rolePhases branch wrote the phase…
      expect(state.rolePhases["intake-coordinator"]).toBe("thinking");
      // …and the agentReasoning slice was still populated in parallel.
      expect(state.agentReasoning.entries.length).toBeGreaterThan(0);
      expect(state.agentReasoning.entries.at(-1)?.phase).toBe("thinking");
    });
  }
);
