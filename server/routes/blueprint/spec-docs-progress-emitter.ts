/**
 * Spec Docs 批量生成进度事件发射器。
 *
 * 在批量生成规格文档时，为每个节点发射结构化进度事件，
 * 通过 `StageProgressEmitter.observing()` 的 `extraPayload` 参数
 * 将 per-node 元数据编码到事件 payload 中。
 *
 * 使用方式：
 * ```typescript
 * const emitter = createSpecDocsProgressEmitter(eventBus, jobId);
 * emitter.emitBatchInit(8, ["node-1", "node-2", ...]);
 * emitter.emitNodeStarted("node-1", "用户认证模块", 1);
 * emitter.emitNodeCompleted("node-1", 1);
 * emitter.emitNodeFailed("node-2", "LLM 调用超时", 2);
 * emitter.emitBatchFinished(1, 1, 12345);
 * ```
 *
 * 设计约束：
 * - 工厂函数要求有效的 `eventBus`，不接受 `undefined`。
 *   调用方通过 `isBatchRequest && ctx?.eventBus ? create... : undefined` + optional chaining 实现 no-op。
 * - 所有事件通过 `baseEmitter.observing(success, summary, extraPayload)` 发射，
 *   不直接调用 `eventBus.emit()`。
 * - `nodeTitle` 截断到 200 字符，`errorSummary` 截断到 400 字符。
 * - `emitNodeFailed` 携带 `processedCount`（而非 `completedCount`）以避免语义混淆。
 */

import type { BlueprintEventBus } from "./event-bus.js";
import { createStageProgressEmitter, type StageProgressEmitter } from "./stage-progress-emitter.js";

/**
 * Per-node progress action types encoded in the observing event payload.
 */
export type SpecDocsProgressAction =
  | "batch_init"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_assembled"
  | "batch_finished";

export interface SpecDocsProgressEmitter {
  /** Emit batch initialization with total node count and ordered node IDs. */
  emitBatchInit(totalCount: number, nodeIds: string[]): void;
  /** Emit that a specific node has started processing. */
  emitNodeStarted(nodeId: string, title: string, position: number): void;
  /** Emit that a specific node completed successfully. */
  emitNodeCompleted(nodeId: string, completedCount: number): void;
  /** Emit that a specific node failed with processedCount. */
  emitNodeFailed(nodeId: string, errorSummary: string, processedCount: number): void;
  /**
   * Phase 2 assembly boundary — node's documents have been constructed and
   * staged in the documents array, awaiting batch-level persistence.
   *
   * Ordering invariant: `node_assembled[i]` MUST be emitted AFTER
   * `node_completed[i]` (or `node_failed[i]` — but failed nodes SHOULD NOT
   * call `emitNodeAssembled` at all) AND BEFORE `batch_finished`.
   *
   * Note: `occurredAt` is provided by the base event envelope
   * (`baseEmitter.observing(...)` adds it automatically), not by the caller.
   */
  emitNodeAssembled(args: {
    nodeId: string;
    position: number;
    assembledCount: number;
    totalCount: number;
    documentIds: ReadonlyArray<string>;
  }): void;
  /** Emit that the entire batch has finished. */
  emitBatchFinished(completedCount: number, failedCount: number, elapsedMs: number): void;
}

/**
 * Creates a spec docs progress emitter that wraps the existing
 * createStageProgressEmitter and encodes per-node metadata in the
 * observing event's structured payload.
 *
 * Uses stage="spec_docs", role="generator" to match existing conventions.
 * All events use the `observing()` method from StageProgressEmitter which
 * internally emits `role.agent.observing` events through the typed event bus.
 *
 * @param eventBus Required — must be a valid BlueprintEventBus instance.
 *   Callers use optional chaining when eventBus may be absent.
 * @param jobId The blueprint job ID for event correlation.
 */
export function createSpecDocsProgressEmitter(
  eventBus: BlueprintEventBus,
  jobId: string,
): SpecDocsProgressEmitter {
  const baseEmitter: StageProgressEmitter = createStageProgressEmitter(
    eventBus, jobId, "spec_docs", "generator"
  );

  return {
    emitBatchInit(totalCount: number, nodeIds: string[]) {
      baseEmitter.observing(true, `开始批量生成 ${totalCount} 个节点的规格文档`, {
        progressAction: "batch_init",
        totalCount,
        nodeIds,
      });
    },

    emitNodeStarted(nodeId: string, title: string, position: number) {
      baseEmitter.observing(true, `[${position}] 正在生成: ${title.slice(0, 200)}`, {
        progressAction: "node_started",
        nodeId,
        nodeTitle: title.slice(0, 200),
        position,
      });
    },

    emitNodeCompleted(nodeId: string, completedCount: number) {
      baseEmitter.observing(true, `✓ 节点完成 (${completedCount} 已完成)`, {
        progressAction: "node_completed",
        nodeId,
        completedCount,
      });
    },

    emitNodeFailed(nodeId: string, errorSummary: string, processedCount: number) {
      baseEmitter.observing(false, `✗ 节点失败: ${errorSummary.slice(0, 400)}`, {
        progressAction: "node_failed",
        nodeId,
        errorSummary: errorSummary.slice(0, 400),
        processedCount,
      });
    },

    emitNodeAssembled({ nodeId, position, assembledCount, totalCount, documentIds }) {
      baseEmitter.observing(true, `↳ 文档装配 (${assembledCount}/${totalCount})`, {
        progressAction: "node_assembled",
        nodeId,
        position,
        assembledCount,
        totalCount,
        documentIds: [...documentIds],
      });
    },

    emitBatchFinished(completedCount: number, failedCount: number, elapsedMs: number) {
      baseEmitter.observing(true, `批量生成完成: ${completedCount} 成功, ${failedCount} 失败, 耗时 ${elapsedMs}ms`, {
        progressAction: "batch_finished",
        completedCount,
        failedCount,
        elapsedMs,
      });
    },
  };
}
