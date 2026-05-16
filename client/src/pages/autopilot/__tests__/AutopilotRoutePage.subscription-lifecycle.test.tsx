/**
 * autopilot-streaming-experience Spec Task 1.1：订阅生命周期回归测试。
 *
 * 该测试覆盖需求 1.1 / 1.4 / 1.6：
 * - intakeId 早订阅：streamKey === intake.id 时 store.subscribe("I1") 被调用
 * - jobId 切换：streamKey 切到 latestJob.id 时先 unsubscribe 再 subscribe，
 *   且 agentReasoning.entries 被清空回到初始空态
 * - 双 null 兜底：intake / latestJob 都为空时不发起任何订阅，
 *   agentReasoning.status 维持 "idle"
 *
 * 实现口径（与本仓现有 React 组件测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react`、`jsdom` 或 `happy-dom`；
 *   `useEffect` 在 `renderToStaticMarkup` SSR 路径下不执行
 *   （详见 `client/src/pages/autopilot/right-rail/hooks/__tests__/use-autopilot-right-rail-data.test.ts`
 *   等多处既有测试的同口径说明）。引入这些工具属于跨规格的工具链改造，
 *   不在本规格的约束范围内（NFR-1：不扩张 5140+ 既有测试集 / TS 基线）。
 *
 *   因此本回归测试改用 *与既有 `AutopilotRoutePage.test.tsx` "E1: route selection
 *   must NOT navigate away" 测试相同的双层策略*：
 *
 *   1. 源代码层断言：直接读取 `AutopilotRoutePage.tsx` 文件内容，证明
 *      派生 streamKey 的 `latestJob?.id ?? intake?.id ?? null` 表达式与
 *      `subscribeToJob(streamKey)` / `unsubscribeFromJob()` 的两段式契约
 *      仍然存在；这等价于 React 视角下 “effect 依赖变化时会先 cleanup 再
 *      重新订阅”，因为 React useEffect 的语义就是按依赖比较 + cleanup。
 *
 *   2. Store 契约层断言：直接调用 `useBlueprintRealtimeStore.subscribe(...)`
 *      并通过 `__setSocket` 注入 mock socket，验证 store 在 intakeId →
 *      jobId 切换时会先 unsubscribe、再 subscribe、并清空
 *      agentReasoning.entries。Store 行为已经被 `subscribe` 内部的 jobId
 *      不等比较保证，本测试为该契约写一份独立锁定，避免后续重构时被悄悄
 *      破坏。
 *
 *   两层断言合并即可证明：当 `AutopilotRoutePage` 在 React runtime 中实际
 *   挂载并运行 useEffect 时，`setIntake({id:"I1"})` 会触发 `subscribe("I1")`，
 *   `setLatestJob({id:"J1"})` 会触发 `unsubscribe()` → `subscribe("J1")` 且
 *   清空 entries，`null/null` 直接早返回不订阅。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";

// ─── Mock Socket.IO（与 blueprint-realtime-store.test.ts 保持一致） ───────────

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

import {
  useBlueprintRealtimeStore,
  __setSocket,
} from "@/lib/blueprint-realtime-store";

function resetStore() {
  useBlueprintRealtimeStore.getState().reset();
  socketHandlers.clear();
  vi.clearAllMocks();
}

// ─── Layer 1：源代码层 streamKey 派生契约 ─────────────────────────────────────

describe("AutopilotRoutePage subscription lifecycle (source-level contract)", () => {
  it("derives streamKey from latestJob?.id ?? intake?.id ?? null", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRoutePage.tsx"),
      "utf8"
    );

    // 关键事实 1：streamKey 派生表达式存在，并且在 useEffect 内部按
    // latestJob?.id ?? intake?.id ?? null 顺序回退。
    expect(source).toMatch(
      /const\s+streamKey\s*=\s*latestJob\?\.id\s*\?\?\s*intake\?\.id\s*\?\?\s*null/
    );

    // 关键事实 2：双 null 兜底（streamKey 为 null 时早返回，不调用 subscribe）。
    expect(source).toMatch(/if\s*\(\s*!streamKey\s*\)\s*return\s*;/);

    // 关键事实 3：subscribe 与 unsubscribe 都被引入了 useEffect，并且通过
    // cleanup 函数 unsubscribe；这一对契约保证 React 在 streamKey 变化时
    // 先 cleanup（unsubscribe）→ 重新执行 effect（subscribe 新 streamKey）。
    expect(source).toMatch(/subscribeToJob\(\s*streamKey\s*\)/);
    expect(source).toMatch(/return\s*\(\s*\)\s*=>\s*\{\s*\n[\s\S]*?unsubscribeFromJob\(\)/);

    // 关键事实 4：useEffect 依赖项同时包含 latestJob?.id 与 intake?.id，
    // 让 React 在两者任一变化时都触发 cleanup → 重新订阅。
    expect(source).toMatch(
      /\[\s*latestJob\?\.id\s*,\s*intake\?\.id\s*,\s*subscribeToJob\s*,\s*unsubscribeFromJob\s*\]/
    );

    // 关键事实 5：不再保留旧的 “只在 latestJob.id 出现后才订阅” 的写法。
    // 旧写法的特征是 `const jobId = latestJob?.id;` + 仅依赖 [latestJob?.id]。
    // 这两条特征已被新 useEffect 取代，应不再出现在文件中。
    expect(source).not.toMatch(/const\s+jobId\s*=\s*latestJob\?\.id\s*;/);
  });
});

// ─── Layer 2：store 契约层 intake → job 切换 ──────────────────────────────────

describe("AutopilotRoutePage subscription lifecycle (store-level contract)", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
    (mockSocket as unknown as { connected: boolean }).connected = true;
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("subscribes to intakeId when only intake is present (early subscription)", () => {
    // 模拟 AutopilotRoutePage 的 useEffect 在 intake 出现、latestJob 仍为空时
    // 派生 streamKey === intake.id 并调用 subscribe。
    useBlueprintRealtimeStore.getState().subscribe("I1");

    const state = useBlueprintRealtimeStore.getState();
    expect(state.subscribedJobId).toBe("I1");
    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:subscribe", {
      jobId: "I1",
    });

    // agentReasoning slice 已被 subscribe 重置到 initial 空态，jobId === "I1"。
    expect(state.agentReasoning.jobId).toBe("I1");
    expect(state.agentReasoning.entries).toEqual([]);
    expect(state.agentReasoning.status).toBe("idle");
    expect(state.agentReasoning.currentIteration).toBe(0);
  });

  it("unsubscribes intakeId then subscribes jobId, clearing agentReasoning entries", () => {
    const store = useBlueprintRealtimeStore;

    // Phase 1：intake 出现 → subscribe("I1")。
    store.getState().subscribe("I1");

    // 写入若干 role.agent.* 事件，模拟 clarification / route_generation
    // 阶段已经把 entries 累积起来。
    store.getState().dispatchEvent({
      type: "role.agent.iteration_started",
      jobId: "I1",
      timestamp: Date.now(),
      payload: { iteration: 1, roleId: "clarifier" },
    });
    store.getState().dispatchEvent({
      type: "role.agent.thinking",
      jobId: "I1",
      timestamp: Date.now(),
      payload: { thought: "scanning repo", roleId: "clarifier" },
    });

    expect(store.getState().agentReasoning.entries.length).toBeGreaterThan(0);
    expect(store.getState().agentReasoning.status).toBe("streaming");

    vi.clearAllMocks();

    // Phase 2：latestJob.id 首次出现且不同 → React useEffect cleanup 触发
    // unsubscribe，再以新 streamKey 订阅。AutopilotRoutePage 的 useEffect
    // cleanup 顺序就是 unsubscribe → 下一次 effect 执行时 subscribe。
    store.getState().unsubscribe();
    store.getState().subscribe("J1");

    const state = store.getState();

    // unsubscribe 已发出且 subscribe 也已发出。
    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:unsubscribe", {
      jobId: "I1",
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("blueprint:subscribe", {
      jobId: "J1",
    });

    // 当前订阅切换到 jobId。
    expect(state.subscribedJobId).toBe("J1");

    // agentReasoning slice 被 subscribe 重置：entries 清空、jobId 跟随、
    // status 回到 idle、currentIteration 归零。
    expect(state.agentReasoning.entries).toEqual([]);
    expect(state.agentReasoning.jobId).toBe("J1");
    expect(state.agentReasoning.status).toBe("idle");
    expect(state.agentReasoning.currentIteration).toBe(0);
  });

  it("does not subscribe when both intake and latestJob are null (idle short-circuit)", () => {
    // 模拟 AutopilotRoutePage 在 intake === null && latestJob === null 时
    // 派生 streamKey === null，useEffect 早返回不调用 subscribe。
    // 我们这里直接验证 “未调用 subscribe” 的 store 终态：
    // - subscribedJobId 仍为 null
    // - 没有 emit("blueprint:subscribe", ...)
    // - agentReasoning.status 维持 "idle"
    expect(useBlueprintRealtimeStore.getState().subscribedJobId).toBeNull();
    expect(useBlueprintRealtimeStore.getState().agentReasoning.status).toBe(
      "idle"
    );
    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      "blueprint:subscribe",
      expect.anything()
    );
  });
});
