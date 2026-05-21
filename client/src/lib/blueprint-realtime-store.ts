/**
 * Blueprint 实时状态 Store。
 *
 * 接收 Socket.IO 推送的 blueprint 事件，维护实时状态供 UI 组件消费。
 * 对应 `.kiro/specs/autopilot-realtime-observation-bridge` Task 2。
 *
 * 核心职责：
 * - 管理 Socket.IO 连接的 subscribe/unsubscribe 生命周期
 * - 将收到的事件分发到对应状态切片（rolePhases / capabilityStatuses / logEntries）
 * - 维护有界队列（agentProgress ≤ 50，logEntries ≤ 200）
 * - 提供细粒度 selector 供 UI 组件订阅
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { BlueprintGenerationEventType } from "@shared/blueprint/events";
// `autopilot-agent-reasoning-stream` spec Task 8.1：
// 引入 Layer 4 view model 与转译函数。`buildEntryFromSocketEvent` 接受
// `BlueprintGenerationEvent`，store 内调用时把 relay 转发的精简事件 cast 到该类型即可，
// 函数内部通过 `unknown` 索引读取字段，对缺省字段会自动 fallback。
import {
  buildEntryFromSocketEvent,
  type AgentReasoningEntry,
  type AgentReasoningPhase,
} from "@shared/blueprint/agent-reasoning";
import type { BlueprintGenerationEvent } from "@shared/blueprint/contracts";

// 重新导出 view model 类型，便于下游组件 / 测试在不直接依赖 `@shared` 路径的
// 场景下消费同一份 contract（Task 8.1 要求保留该 import）。
export type { AgentReasoningEntry, AgentReasoningPhase };

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * 角色阶段枚举。
 */
export type RolePhase =
  | "idle"
  | "activated"
  | "thinking"
  | "acting"
  | "observing"
  | "reviewing"
  | "sleeping"
  | "completed"
  | "failed";

export type RoleRuntimeLifecycleStatus =
  | "provisioning"
  | "ready"
  | "teardown"
  | "failed";

export type RoleRuntimeKind = "real" | "fallback" | "stub" | "missing";

export type RoleRuntimeExecutionMode = "real" | "simulated_fallback";

export type RoleRuntimeContainerMode = "real" | "lite";

export interface RoleRuntimeBindingSummary {
  mcpCount: number;
  skillCount: number;
  aigcNodeCount: number;
  skippedMcps: number;
  skippedSkills: number;
}

export interface RoleRuntimeState {
  roleId: string;
  jobId?: string;
  stageId?: string;
  status: RoleRuntimeLifecycleStatus;
  runtimeKind: RoleRuntimeKind;
  containerMode?: RoleRuntimeContainerMode;
  executionMode?: RoleRuntimeExecutionMode;
  fallbackReason?: string;
  error?: string;
  bindingSummary?: RoleRuntimeBindingSummary;
  cached?: boolean;
  lastUpdated: number;
}

/**
 * Agent 进度条目。
 */
export interface AgentProgressEntry {
  id: string;
  roleId: string;
  type: "thinking" | "acting" | "observing" | "completed" | "failed";
  message?: string;
  timestamp: number;
}

/**
 * 能力调用状态。
 */
export type CapabilityStatus = "idle" | "invoking" | "completed" | "failed";

/**
 * 流式日志条目。
 */
export interface BlueprintLogEntry {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fleet 角色卡片实时状态。
 */
export interface FleetRoleRealtimeCard {
  roleId: string;
  roleName: string;
  phase: RolePhase;
  currentAction?: string;
  capabilities: string[];
  lastUpdated: number;
}

/**
 * Socket.IO 中继推送的事件 payload 结构。
 */
export interface BlueprintRelayedEvent {
  type: BlueprintGenerationEventType;
  jobId: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 有界队列常量
// ---------------------------------------------------------------------------

/** logEntries 最大条目数 */
const MAX_LOG_ENTRIES = 200;

/** agentProgress 最大条目数 */
const MAX_AGENT_PROGRESS = 50;

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.3：
 * agentReasoning.entries 的 FIFO 截断阈值。超过该阈值时按到达顺序丢弃最旧条目，
 * 与既有 `logEntries` 的 200-cap、`agentProgress` 的 50-cap 完全独立。
 */
const MAX_AGENT_REASONING_ENTRIES = 500;

// ---------------------------------------------------------------------------
// agentReasoning slice 类型
// ---------------------------------------------------------------------------

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.2：agentReasoning slice 形状。
 *
 * 派生规则（详见 `design.md` §「BlueprintRealtimeStore 新 slice」）：
 * - `iteration_started` → `status="streaming"` 且 `currentIteration=event.iteration`
 * - `completed` → `status="completed"`
 * - `error + reason==="用户取消"` → `status="aborted"`
 * - `error` 其他 reason → `status="failed"`
 */
export interface AgentReasoningSliceState {
  jobId: string | null;
  entries: AgentReasoningEntry[];
  currentIteration: number;
  status: "idle" | "streaming" | "completed" | "failed" | "aborted";
}

/**
 * agentReasoning slice 的初始空态。`subscribe(newJobId)` 时会重置回该状态
 * （spec Task 8.6），保证 Mystery Policy 在每次新 job 开始时成立。
 */
const INITIAL_AGENT_REASONING: AgentReasoningSliceState = {
  jobId: null,
  entries: [],
  currentIteration: 0,
  status: "idle",
};

// ---------------------------------------------------------------------------
// Store 状态与动作接口
// ---------------------------------------------------------------------------

/**
 * BlueprintRealtimeStore 状态。
 */
export interface BlueprintRealtimeState {
  /** 当前订阅的 jobId */
  subscribedJobId: string | null;

  /** 角色阶段映射：roleId → phase */
  rolePhases: Record<string, RolePhase>;

  /** Role container runtime evidence keyed by roleId. */
  roleRuntimeStates: Record<string, RoleRuntimeState>;

  /** Agent 进度事件队列（最近 50 条） */
  agentProgress: AgentProgressEntry[];

  /** 能力调用状态：capabilityId → status */
  capabilityStatuses: Record<string, CapabilityStatus>;

  /** 流式日志条目（最近 200 条） */
  logEntries: BlueprintLogEntry[];

  /** Fleet 角色卡片实时状态 */
  fleetRoleCards: FleetRoleRealtimeCard[];

  /** 连接状态 */
  connectionState: "disconnected" | "connecting" | "connected";

  /**
   * `autopilot-agent-reasoning-stream` spec Task 8.2：Agent 推理流切片。
   *
   * 与既有 `logEntries` / `agentProgress` / `rolePhases` / `capabilityStatuses`
   * 完全独立的新 slice，仅由 `role.agent.*` 事件驱动。`role.agent.*` 同时也会
   * fallthrough 到既有 `logEntries` 200-cap 队列，保证 `BlueprintLogStream`
   * 继续工作（spec Task 8.3 / 8.7）。
   *
   * 字段约定：
   * - `jobId`：当前订阅 job 的副本，便于 selector 直接判断当前 job 是否已订阅。
   * - `entries`：FIFO 队列，cap 为 500（spec Task 8.3）。
   * - `currentIteration`：仅由 `role.agent.iteration_started` 推进（spec Task 8.4）。
   * - `status`：仅由 `iteration_started` / `completed` / `error + reason` 派生
   *   （spec Task 8.5）。
   */
  agentReasoning: AgentReasoningSliceState;
}

/**
 * BlueprintRealtimeStore 动作。
 */
export interface BlueprintRealtimeActions {
  /** 订阅指定 jobId 的事件流 */
  subscribe(jobId: string): void;
  /** 退订当前 jobId */
  unsubscribe(): void;
  /** 处理收到的事件（内部） */
  dispatchEvent(event: BlueprintRelayedEvent): void;
  /** 重置状态 */
  reset(): void;
}

// ---------------------------------------------------------------------------
// 事件映射辅助函数
// ---------------------------------------------------------------------------

/**
 * 将事件类型映射到 RolePhase。
 */
export function mapEventTypeToPhase(type: string): RolePhase | null {
  switch (type) {
    case "role.activated":
      return "activated";
    case "role.watching":
      return "thinking";
    case "role.capability_invoked":
      return "acting";
    case "role.review_started":
      return "reviewing";
    case "role.review_completed":
      return "observing";
    case "role.sleeping":
      return "sleeping";
    case "role.completed":
      return "completed";
    case "role.container.provisioning":
      return "activated";
    case "role.container.ready":
      return "activated";
    case "role.container.teardown":
      return "sleeping";
    case "role.container.failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * 将 capability 事件类型映射到 CapabilityStatus。
 */
function mapCapabilityEventToStatus(type: string): CapabilityStatus {
  switch (type) {
    case "capability.invoked":
      return "invoking";
    case "capability.completed":
      return "completed";
    case "capability.failed":
      return "failed";
    default:
      return "idle";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readPayloadRecord(
  payload: BlueprintRelayedEvent["payload"]
): Record<string, unknown> {
  return isRecord(payload) ? payload : {};
}

function readNestedRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRoleIdFromPayload(
  payload: BlueprintRelayedEvent["payload"]
): string | undefined {
  const record = readPayloadRecord(payload);
  const direct = readString(record.roleId);
  if (direct) return direct;

  const role = readNestedRecord(record, "role");
  const roleId = role ? readString(role.id) : undefined;
  if (roleId) return roleId;

  const key = readNestedRecord(record, "key");
  return key ? readString(key.roleId) : undefined;
}

function readRoleContainerKey(
  payload: BlueprintRelayedEvent["payload"]
): { roleId?: string; jobId?: string; stageId?: string } {
  const record = readPayloadRecord(payload);
  const key = readNestedRecord(record, "key");
  return {
    roleId: readRoleIdFromPayload(payload),
    jobId: key ? readString(key.jobId) : undefined,
    stageId: key ? readString(key.stageId) : undefined,
  };
}

function readBindingSummary(
  payload: BlueprintRelayedEvent["payload"]
): RoleRuntimeBindingSummary | undefined {
  const record = readPayloadRecord(payload);
  const summary = readNestedRecord(record, "bindingSummary");
  if (!summary) return undefined;
  return {
    mcpCount: readNumber(summary.mcpCount) ?? 0,
    skillCount: readNumber(summary.skillCount) ?? 0,
    aigcNodeCount: readNumber(summary.aigcNodeCount) ?? 0,
    skippedMcps: readNumber(summary.skippedMcps) ?? 0,
    skippedSkills: readNumber(summary.skippedSkills) ?? 0,
  };
}

function mapRoleContainerEventToCapabilityStatus(
  type: string
): CapabilityStatus | null {
  switch (type) {
    case "role.container.provisioning":
      return "invoking";
    case "role.container.ready":
    case "role.container.teardown":
      return "completed";
    case "role.container.failed":
      return "failed";
    default:
      return null;
  }
}

function mapRoleContainerEventToRuntimeStatus(
  type: string
): RoleRuntimeLifecycleStatus | null {
  switch (type) {
    case "role.container.provisioning":
      return "provisioning";
    case "role.container.ready":
      return "ready";
    case "role.container.teardown":
      return "teardown";
    case "role.container.failed":
      return "failed";
    default:
      return null;
  }
}

function normalizeExecutionMode(
  value: unknown
): RoleRuntimeExecutionMode | undefined {
  return value === "real" || value === "simulated_fallback"
    ? value
    : undefined;
}

function normalizeContainerMode(
  value: unknown
): RoleRuntimeContainerMode | undefined {
  return value === "real" || value === "lite" ? value : undefined;
}

function resolveRuntimeKind(
  type: string,
  executionMode: RoleRuntimeExecutionMode | undefined
): RoleRuntimeKind {
  if (type === "role.container.failed") return "stub";
  if (executionMode === "real") return "real";
  if (executionMode === "simulated_fallback") return "fallback";
  return "missing";
}

function buildRoleRuntimeState(
  event: BlueprintRelayedEvent,
  roleId: string,
  lastUpdated: number
): RoleRuntimeState | null {
  const status = mapRoleContainerEventToRuntimeStatus(event.type);
  if (!status) return null;

  const payload = readPayloadRecord(event.payload);
  const key = readRoleContainerKey(event.payload);
  const executionMode = normalizeExecutionMode(payload.executionMode);
  const containerMode = normalizeContainerMode(payload.containerMode);
  const fallbackReason = readString(payload.fallbackReason);
  const error = readString(payload.error);
  const bindingSummary = readBindingSummary(event.payload);
  const cached = readBoolean(payload.cached);

  return {
    roleId,
    ...(key.jobId ? { jobId: key.jobId } : {}),
    ...(key.stageId ? { stageId: key.stageId } : {}),
    status,
    runtimeKind: resolveRuntimeKind(event.type, executionMode),
    ...(containerMode ? { containerMode } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(error ? { error } : {}),
    ...(bindingSummary ? { bindingSummary } : {}),
    ...(cached !== undefined ? { cached } : {}),
    lastUpdated,
  };
}

/**
 * 从事件构建日志条目。
 */
function buildLogEntry(event: BlueprintRelayedEvent): BlueprintLogEntry {
  const ts =
    typeof event.timestamp === "number"
      ? event.timestamp
      : new Date(event.timestamp).getTime();

  let level: BlueprintLogEntry["level"] = "info";
  if (event.type.endsWith(".failed")) level = "error";
  else if (event.type.includes("review")) level = "debug";

  const [source] = event.type.split(".", 1);

  return {
    id: `${event.jobId}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    level,
    source,
    message: event.type,
    metadata: event.payload as Record<string, unknown> | undefined,
  };
}

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.3 辅助函数。
 *
 * 把 socket-relay 转发的精简事件 `BlueprintRelayedEvent` 适配成
 * `buildEntryFromSocketEvent` 可以消费的 `BlueprintGenerationEvent` 形态。
 *
 * 关键事实：
 * - `socket-relay.ts` 当前只把 `event.type / jobId / occurredAt / payload`
 *   四个字段透传到前端，agent 推理流的扩展字段（iteration / thought / actionToolId
 *   / observationSuccess / observationSummary / error / degraded / reason /
 *   tokensUsed / budgetRemaining）目前由后端 `agent-reasoning-bridge` 写在
 *   `BlueprintGenerationEvent` 顶层而不是 `payload` 里；relay 后续若把这些字段
 *   一并下发，本函数会优先读取顶层、再回退到 `payload` 子字段，向前兼容。
 * - `buildEntryFromSocketEvent` 内部已通过 `unknown` 索引读取扩展字段并对缺省值
 *   做 fallback，因此即使本适配返回的 event 不含部分字段也不会抛错。
 *
 * 该适配只服务于 agentReasoning slice 写入，不影响既有 logEntries / agentProgress
 * 等其它 slice 的字段 shape。
 */
function buildAgentReasoningEvent(
  event: BlueprintRelayedEvent
): BlueprintGenerationEvent {
  const occurredAt =
    typeof event.timestamp === "number"
      ? new Date(event.timestamp).toISOString()
      : event.timestamp;
  const payloadRecord = (event.payload ?? {}) as Record<string, unknown>;

  // 优先级：relay 顶层字段（未来）→ payload 子字段。空缺字段保持 undefined，
  // 由 buildEntryFromSocketEvent 的 fallback 决定最终落值。
  return {
    // BlueprintGenerationEvent 必填字段，使用稳定占位值满足类型契约；
    // 这些字段不会被 buildEntryFromSocketEvent 消费，只用于通过 TS 类型校验。
    id: "",
    family: "role",
    stage: "route_generation",
    status: "running",
    message: event.type,
    type: event.type as BlueprintGenerationEvent["type"],
    jobId: event.jobId,
    occurredAt,
    iteration: pickFiniteNumber(payloadRecord.iteration),
    stageId: pickStringField(payloadRecord.stageId),
    roleId: pickStringField(payloadRecord.roleId),
    thought: pickStringField(payloadRecord.thought),
    actionToolId: pickStringField(payloadRecord.actionToolId),
    observationSuccess:
      typeof payloadRecord.observationSuccess === "boolean"
        ? payloadRecord.observationSuccess
        : undefined,
    observationSummary: pickStringField(payloadRecord.observationSummary),
    error: pickStringField(payloadRecord.error),
    degraded:
      typeof payloadRecord.degraded === "boolean"
        ? payloadRecord.degraded
        : undefined,
    reason: pickStringField(payloadRecord.reason),
    tokensUsed: pickFiniteNumber(payloadRecord.tokensUsed),
    budgetRemaining: pickFiniteNumber(payloadRecord.budgetRemaining),
    payload: payloadRecord,
  };
}

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.5 辅助函数。
 *
 * 从 relay 转发的事件 payload 中安全读取字符串字段（顶层 relay 字段未来落地后
 * 也会优先采用相同语义）。`role.agent.error` 的 status 派生需要读取 `reason`，
 * 当 reason==="用户取消" 时落到 "aborted"，否则落到 "failed"。
 */
function readEventField(
  payload: BlueprintRelayedEvent["payload"],
  field: "reason"
): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 从 unknown 中读取非空字符串，否则返回 undefined。 */
function pickStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 从 unknown 中读取有限 number，否则返回 undefined。 */
function pickFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Socket 实例管理
// ---------------------------------------------------------------------------

let socket: Socket | null = null;

/**
 * 获取或创建 Socket.IO 连接实例（可注入，便于测试）。
 */
export function getOrCreateSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    // autopilot-streaming-experience 调试日志（2026-05-16）：在浏览器 console
    // 暴露 socket 生命周期与 blueprint:event 推送的最少证据，便于验证流式时
    // 间线为何在 UI 上看不到。该日志只在浏览器环境执行，不影响 SSR 测试，
    // 也不引入新依赖；正式环境如需关闭，可在浏览器 console 执行
    // `localStorage.setItem("autopilot-debug-socket", "off")`。
    if (typeof window !== "undefined") {
      const debugEnabled =
        window.localStorage?.getItem("autopilot-debug-socket") !== "off";
      if (debugEnabled) {
        socket.on("connect", () => {
          // eslint-disable-next-line no-console
          console.log(
            "[autopilot-debug] socket connected sid=" + (socket?.id ?? "?")
          );
        });
        socket.on("disconnect", (reason) => {
          // eslint-disable-next-line no-console
          console.log("[autopilot-debug] socket disconnected:", reason);
        });
        socket.on("blueprint:event", (data) => {
          // eslint-disable-next-line no-console
          console.log("[autopilot-debug] blueprint:event ←", data);
        });
        socket.on("blueprint:batch", (batch) => {
          // eslint-disable-next-line no-console
          console.log(
            "[autopilot-debug] blueprint:batch ← (" +
              (Array.isArray(batch) ? batch.length : "?") +
              " events)"
          );
        });
      }
    }
  }
  return socket;
}

/**
 * 注入自定义 socket 实例（用于测试）。
 */
export function __setSocket(s: Socket | null): void {
  socket = s;
}

// ---------------------------------------------------------------------------
// Store 创建
// ---------------------------------------------------------------------------

const initialState: BlueprintRealtimeState = {
  subscribedJobId: null,
  rolePhases: {},
  roleRuntimeStates: {},
  agentProgress: [],
  capabilityStatuses: {},
  logEntries: [],
  fleetRoleCards: [],
  connectionState: "disconnected",
  agentReasoning: INITIAL_AGENT_REASONING,
};

/**
 * Blueprint 实时状态 Zustand Store。
 */
export const useBlueprintRealtimeStore = create<
  BlueprintRealtimeState & BlueprintRealtimeActions
>((set, get) => ({
  ...initialState,

  subscribe(jobId: string) {
    const state = get();

    // 如果已经订阅同一个 jobId，跳过
    if (state.subscribedJobId === jobId) return;

    // 如果已有订阅，先退订
    if (state.subscribedJobId) {
      get().unsubscribe();
    }

    const s = getOrCreateSocket();

    // 当 jobId 变化时保留历史 agentReasoning entries，避免阶段切换
    // （intake.id → job.id）时丢失之前的执行步骤。entries 的 stageId
    // 字段已标记每条 entry 属于哪个阶段，MiroFishCardStream 可按需过滤。
    set({
      subscribedJobId: jobId,
      connectionState: "connecting",
      agentReasoning: {
        jobId,
        entries: state.agentReasoning.entries,
        currentIteration: state.agentReasoning.currentIteration,
        status: "idle",
      },
    });

    // 绑定连接事件
    s.on("connect", handleConnect);
    s.on("disconnect", handleDisconnect);
    s.on("blueprint:event", handleBlueprintEvent);
    s.on("blueprint:batch", handleBlueprintBatch);

    // 如果已经连接，直接发送订阅
    if (s.connected) {
      s.emit("blueprint:subscribe", { jobId });
      set({ connectionState: "connected" });
    }

    function handleConnect() {
      set({ connectionState: "connected" });
      // 重连后自动恢复订阅
      const currentJobId = get().subscribedJobId;
      if (currentJobId) {
        s.emit("blueprint:subscribe", { jobId: currentJobId });
      }
    }

    function handleDisconnect() {
      set({ connectionState: "disconnected" });
    }

    function handleBlueprintEvent(event: BlueprintRelayedEvent) {
      // 只处理当前订阅 jobId 的事件
      const currentJobId = get().subscribedJobId;
      if (event.jobId === currentJobId) {
        if (typeof window !== "undefined") {
          const debugEnabled =
            window.localStorage?.getItem("autopilot-debug-socket") !== "off";
          if (debugEnabled && event.type.startsWith("role.agent.")) {
            // eslint-disable-next-line no-console
            console.log(
              "[autopilot-debug] dispatching " + event.type + " (jobId match)"
            );
          }
        }
        get().dispatchEvent(event);
      } else if (typeof window !== "undefined") {
        const debugEnabled =
          window.localStorage?.getItem("autopilot-debug-socket") !== "off";
        if (debugEnabled) {
          // eslint-disable-next-line no-console
          console.warn(
            "[autopilot-debug] DROPPED " +
              event.type +
              ": event.jobId=" +
              event.jobId +
              " ≠ subscribedJobId=" +
              String(currentJobId)
          );
        }
      }
    }

    /** 处理批量推送事件（Task 6.2） */
    function handleBlueprintBatch(events: BlueprintRelayedEvent[]) {
      if (!Array.isArray(events)) return;
      const currentJobId = get().subscribedJobId;
      for (const event of events) {
        if (event.jobId === currentJobId) {
          get().dispatchEvent(event);
        }
      }
    }
  },

  unsubscribe() {
    const state = get();
    const s = getOrCreateSocket();

    if (state.subscribedJobId) {
      s.emit("blueprint:unsubscribe", { jobId: state.subscribedJobId });
    }

    // 移除事件监听
    s.off("connect");
    s.off("disconnect");
    s.off("blueprint:event");
    s.off("blueprint:batch");

    // 重置订阅状态但保留 logEntries 历史
    set({
      subscribedJobId: null,
      rolePhases: {},
      roleRuntimeStates: {},
      agentProgress: [],
      capabilityStatuses: {},
      fleetRoleCards: [],
      connectionState: s.connected ? "connected" : "disconnected",
      // `autopilot-agent-reasoning-stream` spec Task 8.6 / 8.7：
      // agentReasoning 与 rolePhases / agentProgress / capabilityStatuses 同属
      // 「当前 job 活跃态」slice，退订时一并回到初始态，保持与既有 reset 语义一致。
      // logEntries 200-cap 队列继续作为历史记录保留，不受影响。
      agentReasoning: INITIAL_AGENT_REASONING,
    });
  },

  dispatchEvent(event: BlueprintRelayedEvent) {
    const { type, payload } = event;

    set((state) => {
      const updates: Partial<BlueprintRealtimeState> = {};
      const eventTime =
        typeof event.timestamp === "number"
          ? event.timestamp
          : new Date(event.timestamp).getTime();
      const lastUpdated = Number.isFinite(eventTime) ? eventTime : Date.now();
      const roleId = readRoleIdFromPayload(payload);

      // `autopilot-agent-reasoning-stream` spec Task 8.3 / 8.4 / 8.5：
      // role.agent.* 分支与既有 logEntries / rolePhases 等分支并行写入，
      // 不 return / continue 中断后续 200-cap logEntries 处理。
      // - Task 8.3：用 buildEntryFromSocketEvent 构造 entry 并 FIFO 截断到 ≤500
      // - Task 8.4：iteration_started → 更新 currentIteration（其他事件不动）
      // - Task 8.5：iteration_started/completed/error 派生 status
      if (type.startsWith("role.agent.")) {
        const reasoningEntry = buildEntryFromSocketEvent(
          buildAgentReasoningEvent(event)
        );
        if (reasoningEntry !== null) {
          let nextEntries = [
            ...state.agentReasoning.entries,
            reasoningEntry,
          ];
          if (nextEntries.length > MAX_AGENT_REASONING_ENTRIES) {
            nextEntries = nextEntries.slice(-MAX_AGENT_REASONING_ENTRIES);
          }

          // 派生 currentIteration：仅 iteration_started 推进；其他事件保持。
          let nextIteration = state.agentReasoning.currentIteration;
          if (
            type === "role.agent.iteration_started" &&
            typeof reasoningEntry.iteration === "number" &&
            Number.isFinite(reasoningEntry.iteration)
          ) {
            nextIteration = reasoningEntry.iteration;
          }

          // 派生 status：
          // - iteration_started → "streaming"
          // - completed         → "completed"
          // - error 且 reason==="用户取消" → "aborted"
          // - error 其他 reason → "failed"
          // - 其他 role.agent.* 不改 status（保持上一个终态或 streaming）
          let nextStatus = state.agentReasoning.status;
          if (type === "role.agent.iteration_started") {
            nextStatus = "streaming";
          } else if (type === "role.agent.completed") {
            nextStatus = "completed";
          } else if (type === "role.agent.error") {
            // 取脱敏后的 reason 字段；与 bridge withAbortReason / withFailureDegraded
            // 行为对齐：用户取消时 reason="用户取消"，其他情况无 reason 或 reason!=="用户取消"。
            const reason = readEventField(payload, "reason");
            if (reason === "用户取消") {
              nextStatus = "aborted";
            } else {
              nextStatus = "failed";
            }
          }

          updates.agentReasoning = {
            jobId: state.agentReasoning.jobId,
            entries: nextEntries,
            currentIteration: nextIteration,
            status: nextStatus,
          };
        }
        // fallthrough：role.agent.* 仍会继续走下方 logEntries 200-cap 写入，
        // 保证 BlueprintLogStream 仍能展示原始事件类型。
      }

      // Role phase 更新
      if (type.startsWith("role.")) {
        if (roleId) {
          const phase = mapEventTypeToPhase(type);
          if (phase) {
            updates.rolePhases = { ...state.rolePhases, [roleId]: phase };
          }
        }
      }

      // Capability 状态更新
      if (type.startsWith("capability.")) {
        const capId =
          (payload?.capabilityId as string) ?? (payload?.id as string);
        if (capId) {
          const status = mapCapabilityEventToStatus(type);
          updates.capabilityStatuses = {
            ...state.capabilityStatuses,
            [capId]: status,
          };
        }
      }

      // Agent progress 更新（job.stage 事件）
      // Role container lifecycle events double as runtime bridge evidence.
      const roleContainerCapabilityStatus =
        mapRoleContainerEventToCapabilityStatus(type);
      if (roleContainerCapabilityStatus && roleId) {
        const capabilityId = `role-container-loader:${roleId}`;
        updates.capabilityStatuses = {
          ...(updates.capabilityStatuses ?? state.capabilityStatuses),
          [capabilityId]: roleContainerCapabilityStatus,
        };
        const runtimeState = buildRoleRuntimeState(event, roleId, lastUpdated);
        if (runtimeState) {
          updates.roleRuntimeStates = {
            ...state.roleRuntimeStates,
            [roleId]: runtimeState,
          };
        }
      }

      // Agent progress 鏇存柊锛坖ob.stage 浜嬩欢锛?
      if (type === "job.stage" && payload) {
        const entry: AgentProgressEntry = {
          id: `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roleId: (payload.roleId as string) ?? "system",
          type: "acting",
          message: (payload.message as string) ?? type,
          timestamp: Date.now(),
        };
        let nextProgress = [...state.agentProgress, entry];
        if (nextProgress.length > MAX_AGENT_PROGRESS) {
          nextProgress = nextProgress.slice(-MAX_AGENT_PROGRESS);
        }
        updates.agentProgress = nextProgress;
      }

      // 日志追加（所有事件都产生日志条目）
      const logEntry = buildLogEntry(event);
      let nextLogs = [...state.logEntries, logEntry];
      if (nextLogs.length > MAX_LOG_ENTRIES) {
        nextLogs = nextLogs.slice(-MAX_LOG_ENTRIES);
      }
      updates.logEntries = nextLogs;

      return updates;
    });
  },

  reset() {
    const s = socket;
    if (s) {
      const state = get();
      if (state.subscribedJobId) {
        s.emit("blueprint:unsubscribe", { jobId: state.subscribedJobId });
      }
      s.off("connect");
      s.off("disconnect");
      s.off("blueprint:event");
      s.off("blueprint:batch");
    }
    set(initialState);
  },
}));
