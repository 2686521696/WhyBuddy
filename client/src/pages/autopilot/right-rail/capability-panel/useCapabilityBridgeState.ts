/**
 * 能力 Bridge 运行时面板 — 状态管理 Hook
 *
 * 消费 `useBlueprintRealtimeStore.capabilityStatuses`，维护 BridgeInvocation[]
 * 调用列表，根据 capability 事件更新状态，计算 durationMs，派生 activeInvocations
 * 和 summary，超过 20 条时自动折叠旧记录。
 *
 * 对应 spec：`.kiro/specs/autopilot-capability-bridge-runtime-panel/`
 * - 需求 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

import type {
  BridgeInvocation,
  UseCapabilityBridgeStateReturn,
} from "./types";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 超过此数量时自动折叠已完成的旧记录 */
const MAX_VISIBLE_INVOCATIONS = 20;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从 capabilityId 推断 bridgeType。
 *
 * 命名约定：
 * - 包含 "docker" → docker
 * - 包含 "mcp" → mcp
 * - 包含 "aigc" 或 "node" → aigc-node
 * - 包含 "skill" → skill
 * - 默认 → mcp
 */
function inferBridgeType(
  capabilityId: string
): BridgeInvocation["bridgeType"] {
  const lower = capabilityId.toLowerCase();
  if (lower.includes("docker")) return "docker";
  if (lower.includes("mcp")) return "mcp";
  if (lower.includes("aigc") || lower.includes("node")) return "aigc-node";
  if (lower.includes("skill")) return "skill";
  return "mcp";
}

/**
 * 将 store 中的 CapabilityStatus 映射到 BridgeInvocation 的 status。
 */
function mapStoreStatus(
  storeStatus: string
): BridgeInvocation["status"] {
  switch (storeStatus) {
    case "invoking":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
      return "pending";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Hook 实现
// ---------------------------------------------------------------------------

/**
 * 能力 Bridge 调用状态管理 Hook。
 *
 * 职责：
 * 1. 消费 `useBlueprintRealtimeStore.capabilityStatuses`
 * 2. 维护 `BridgeInvocation[]` 调用列表
 * 3. 根据 capability 事件更新状态（invoked / running / completed / failed）
 * 4. 计算 `durationMs`，派生 `activeInvocations` 和 `summary`
 * 5. 超过 20 条时自动标记旧记录为 collapsed（通过截断返回列表实现）
 *
 * @returns UseCapabilityBridgeStateReturn
 */
export function useCapabilityBridgeState(): UseCapabilityBridgeStateReturn {
  const capabilityStatuses = useBlueprintRealtimeStore(
    (s) => s.capabilityStatuses
  );

  // 使用 ref 追踪已知的 invocation，避免重复创建
  const invocationsRef = useRef<Map<string, BridgeInvocation>>(new Map());
  const stageCounterRef = useRef(0);

  // 触发 re-render 的状态
  const [invocations, setInvocations] = useState<BridgeInvocation[]>([]);

  // 监听 capabilityStatuses 变化，同步更新 invocations
  useEffect(() => {
    // 防御性兜底
    if (!capabilityStatuses || typeof capabilityStatuses !== "object") {
      return;
    }

    const entries = Object.entries(capabilityStatuses);
    if (entries.length === 0) return;

    let changed = false;
    const now = Date.now();

    for (const [capabilityId, storeStatus] of entries) {
      const existing = invocationsRef.current.get(capabilityId);
      const newStatus = mapStoreStatus(storeStatus);

      if (!existing) {
        // 新增调用记录
        const invocation: BridgeInvocation = {
          id: capabilityId,
          bridgeType: inferBridgeType(capabilityId),
          name: capabilityId,
          status: newStatus,
          startedAt: now,
          stageIndex: stageCounterRef.current++,
        };

        // 如果已经是 completed / failed，计算 durationMs
        if (newStatus === "completed" || newStatus === "failed") {
          invocation.completedAt = now;
          invocation.durationMs = 0;
        }

        invocationsRef.current.set(capabilityId, invocation);
        changed = true;
      } else if (existing.status !== newStatus) {
        // 状态变更
        const updated: BridgeInvocation = { ...existing, status: newStatus };

        if (
          (newStatus === "completed" || newStatus === "failed") &&
          !existing.completedAt
        ) {
          updated.completedAt = now;
          updated.durationMs = now - existing.startedAt;
        }

        invocationsRef.current.set(capabilityId, updated);
        changed = true;
      }
    }

    if (changed) {
      // 按 stageIndex 排序，最新的在后面
      const sorted = Array.from(invocationsRef.current.values()).sort(
        (a, b) => a.stageIndex - b.stageIndex
      );
      setInvocations(sorted);
    }
  }, [capabilityStatuses]);

  // 派生 activeInvocations 和 summary
  const result = useMemo<UseCapabilityBridgeStateReturn>(() => {
    // 超过 MAX_VISIBLE_INVOCATIONS 时，只保留最近的记录
    // 旧的已完成记录被折叠（不在返回列表中）
    let visibleInvocations = invocations;
    if (invocations.length > MAX_VISIBLE_INVOCATIONS) {
      // 保留所有活跃的 + 最近的已完成记录
      const active = invocations.filter(
        (inv) =>
          inv.status === "pending" ||
          inv.status === "running" ||
          inv.status === "retrying"
      );
      const inactive = invocations.filter(
        (inv) =>
          inv.status === "completed" || inv.status === "failed"
      );
      // 保留最近的已完成记录，使总数不超过 MAX_VISIBLE_INVOCATIONS
      const keepCount = Math.max(
        0,
        MAX_VISIBLE_INVOCATIONS - active.length
      );
      const recentInactive = inactive.slice(-keepCount);
      visibleInvocations = [...recentInactive, ...active].sort(
        (a, b) => a.stageIndex - b.stageIndex
      );
    }

    const activeInvocations = invocations.filter(
      (inv) =>
        inv.status === "pending" ||
        inv.status === "running" ||
        inv.status === "retrying"
    );

    const summary = {
      total: invocations.length,
      running: invocations.filter((inv) => inv.status === "running").length,
      completed: invocations.filter((inv) => inv.status === "completed").length,
      failed: invocations.filter((inv) => inv.status === "failed").length,
    };

    return {
      invocations: visibleInvocations,
      activeInvocations,
      summary,
    };
  }, [invocations]);

  return result;
}
