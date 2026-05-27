/**
 * 阶段进度事件发射器 — 让每个阶段的执行过程实时推送到前端时间线。
 *
 * 通过 BlueprintEventBus 发射 `role.agent.*` 系列事件，这些事件会被
 * BlueprintSocketRelay 自动中继到前端，由 AgentReasoningSubTimeline 渲染。
 *
 * 使用方式：
 * ```typescript
 * const emitter = createStageProgressEmitter(eventBus, jobId, "spec_tree", "planner");
 * emitter.thinking("正在分析仓库目录结构...");
 * emitter.acting("github.get_repository");
 * emitter.observing(true, "发现 12 个模块，主入口为 src/main.ts");
 * emitter.completed();
 * ```
 */

import type { BlueprintGenerationStage } from "../../../shared/blueprint/index.js";
import type { BlueprintEventBus } from "./event-bus.js";

type StageProgressEmitterStageId = BlueprintGenerationStage | "intake_created";

function resolveEventStage(
  stageId: StageProgressEmitterStageId,
): BlueprintGenerationStage {
  return stageId === "intake_created" ? "input" : stageId;
}

/** 进度事件发射器接口。 */
export interface StageProgressEmitter {
  /** 发射 thinking 事件（Agent 正在思考）。 */
  thinking(thought: string): void;
  /** 发射 acting 事件（Agent 正在调用工具）。 */
  acting(toolId: string): void;
  /** 发射 observing 事件（Agent 观察到结果）。 */
  observing(success: boolean, summary: string, extraPayload?: Record<string, unknown>): void;
  /** 发射 completed 事件（阶段完成）。 */
  completed(reason?: string): void;
  /** 发射 error 事件（阶段失败）。 */
  error(message: string): void;
  /** 当前迭代计数器（自动递增）。 */
  readonly iteration: number;
  /** 手动推进到下一个迭代。 */
  nextIteration(): void;
}

/**
 * 创建阶段进度事件发射器。
 *
 * @param eventBus 蓝图事件总线
 * @param jobId 当前作业 ID
 * @param stageId 当前阶段 ID（如 "clarification" / "route_generation" / "spec_tree" / "spec_docs"）
 * @param roleId 角色 ID（如 "planner" / "analyzer"）
 */
export function createStageProgressEmitter(
  eventBus: BlueprintEventBus,
  jobId: string,
  stageId: StageProgressEmitterStageId,
  roleId: string,
): StageProgressEmitter {
  let currentIteration = 1;
  const eventStage = resolveEventStage(stageId);

  function emit(type: string, payload: Record<string, unknown>): void {
    try {
      eventBus.emit({
        id: `progress-${jobId}-${stageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        jobId,
        type: type as never,
        family: "role",
        stage: eventStage,
        status: "running",
        message: "",
        occurredAt: new Date().toISOString(),
        roleId,
        stageId,
        payload: {
          ...payload,
          iteration: currentIteration,
          roleId,
          stageId,
        },
      });
    } catch {
      // 静默失败，不阻塞主流程
    }
  }

  return {
    get iteration() { return currentIteration; },

    nextIteration() {
      currentIteration++;
      emit("role.agent.iteration_started", {});
    },

    thinking(thought: string) {
      emit("role.agent.thinking", { thought: thought.slice(0, 500) });
    },

    acting(toolId: string) {
      emit("role.agent.acting", { actionToolId: toolId });
    },

    observing(success: boolean, summary: string, extraPayload?: Record<string, unknown>) {
      emit("role.agent.observing", {
        observationSuccess: success,
        observationSummary: summary.slice(0, 2000),
        ...extraPayload,
      });
    },

    completed(reason?: string) {
      emit("role.agent.completed", { reason: reason ?? "阶段完成" });
    },

    error(message: string) {
      emit("role.agent.error", { error: message.slice(0, 500) });
    },
  };
}
