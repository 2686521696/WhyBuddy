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
  type BlueprintRelayedEvent,
} from "../blueprint-realtime-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useBlueprintRealtimeStore.getState().reset();
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
  it("should reset state on unsubscribe but preserve logEntries", () => {
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
        payload: { capabilityId: "c1" },
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
    expect(state.agentProgress).toEqual([]);
    // logEntries 保留历史
    expect(state.logEntries.length).toBeGreaterThan(0);
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
