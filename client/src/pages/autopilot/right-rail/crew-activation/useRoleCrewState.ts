/**
 * Agent Crew 角色状态管理 Hook。
 *
 * 消费 `useBlueprintRealtimeStore` 中的 role 相关数据（rolePhases、logEntries），
 * 维护 `RoleCrewEntry[]` 状态数组，并派生 `activeRoles`、`currentStageIndex`、
 * `discussions` 等视图数据。
 *
 * 对应 `.kiro/specs/autopilot-agent-crew-stage-activation` Task 1.1。
 * 需求: 1.1, 1.2, 1.3, 1.4
 */

import { useMemo } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import type { RolePhase } from "@/lib/blueprint-realtime-store";

import type {
  RoleCrewEntry,
  RoleCrewStatus,
  DiscussionEntry,
  UseRoleCrewStateReturn,
} from "./types";

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 将 store 中的 RolePhase 映射为 Crew 四态。
 * activated / thinking / acting → active
 * observing → watching
 * reviewing → reviewing
 * 其余（idle / sleeping / completed / failed）→ sleeping
 */
function mapPhaseToCrewStatus(phase: RolePhase): RoleCrewStatus {
  switch (phase) {
    case "activated":
    case "thinking":
    case "acting":
      return "active";
    case "observing":
      return "watching";
    case "reviewing":
      return "reviewing";
    case "idle":
    case "sleeping":
    case "completed":
    case "failed":
    default:
      return "sleeping";
  }
}

/**
 * 从 roleId 生成可读的角色名称。
 * 简单策略：首字母大写，下划线转空格。
 */
function deriveRoleName(roleId: string): string {
  if (!roleId) return "Unknown";
  return roleId
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Hook 实现
// ---------------------------------------------------------------------------

/**
 * 管理 Agent Crew 角色状态的 React Hook。
 *
 * @returns UseRoleCrewStateReturn — 角色列表、活跃角色、当前阶段索引与讨论条目
 */
export function useRoleCrewState(): UseRoleCrewStateReturn {
  // 从 store 订阅 rolePhases 与 logEntries
  const rolePhases = useBlueprintRealtimeStore((s) => s.rolePhases);
  const logEntries = useBlueprintRealtimeStore((s) => s.logEntries);

  // 派生角色列表
  const roles: RoleCrewEntry[] = useMemo(() => {
    if (!rolePhases || typeof rolePhases !== "object") return [];

    const entries = Object.entries(rolePhases);
    if (entries.length === 0) return [];

    const now = Date.now();
    return entries.map(([roleId, phase]) => ({
      roleId,
      roleName: deriveRoleName(roleId),
      status: mapPhaseToCrewStatus(phase),
      stageIndex: 0, // 阶段索引由 logEntries 中的 stage 事件推导
      updatedAt: now,
    }));
  }, [rolePhases]);

  // 派生活跃角色
  const activeRoles: RoleCrewEntry[] = useMemo(
    () => roles.filter((r) => r.status === "active"),
    [roles]
  );

  // 派生当前阶段索引：从 logEntries 中查找最近的 job.stage 事件
  const currentStageIndex: number = useMemo(() => {
    if (!logEntries || logEntries.length === 0) return 0;

    // 从后往前找最近的 stage 相关事件
    for (let i = logEntries.length - 1; i >= 0; i--) {
      const entry = logEntries[i];
      if (entry.message === "job.stage" && entry.metadata) {
        const stageIdx = entry.metadata.stageIndex;
        if (typeof stageIdx === "number" && Number.isFinite(stageIdx)) {
          return stageIdx;
        }
      }
    }
    return 0;
  }, [logEntries]);

  // 派生讨论条目：从 logEntries 中提取 role.agent.* 相关的讨论/决策事件
  const discussions: DiscussionEntry[] = useMemo(() => {
    if (!logEntries || logEntries.length === 0) return [];

    const result: DiscussionEntry[] = [];

    for (const entry of logEntries) {
      // 只处理 role 相关的事件作为讨论条目
      if (!entry.message.startsWith("role.agent.")) continue;

      const roleId =
        (entry.metadata?.roleId as string) ?? entry.source ?? "system";
      const content =
        (entry.metadata?.thought as string) ??
        (entry.metadata?.observationSummary as string) ??
        (entry.metadata?.message as string) ??
        entry.message;

      // 根据事件类型确定讨论条目类型
      let type: DiscussionEntry["type"] = "discussion";
      if (
        entry.message === "role.agent.completed" ||
        entry.message.includes("decision")
      ) {
        type = "decision";
      } else if (entry.message.includes("handoff")) {
        type = "handoff";
      }

      // 只保留有实质内容的条目
      if (content && content !== entry.message) {
        result.push({
          id: entry.id,
          roleId,
          roleName: deriveRoleName(roleId),
          content,
          type,
          timestamp: entry.timestamp,
          stageIndex: currentStageIndex,
        });
      }
    }

    return result;
  }, [logEntries, currentStageIndex]);

  return { roles, activeRoles, currentStageIndex, discussions };
}
