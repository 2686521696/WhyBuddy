/**
 * 自动驾驶 3D 场景融合 — FSD roleId 到 mission agent id 的映射桥。
 *
 * 蓝图后端 emit 的 role.* 事件（来自 agent-reasoning-bridge）payload.roleId
 * 是 FSD 角色名（共 7 个），但 PetWorkers 配置使用的是 mission agent id 体系
 * （也是 7 个）。该纯函数用近似映射把 FSD roleId 翻译为 mission agent id，
 * 让 3D 场景在蓝图页能够跟随 FSD 角色阶段动起来。
 *
 * 映射不准是已知风险（已写入 requirements.md 风险段 1），后续可单点替换
 * 该映射表，不会扩散到调用方。
 *
 * 该模块零副作用、零 hook、零 DOM 引用，可在任何渲染阶段安全调用。
 *
 * 同时把 SceneFusionMode 的正式定义从 Scene3D.tsx inline 类型升级到本模块导出，
 * Wave B 之后所有 mode 透传链路统一从这里 import。
 */

import type {
  RolePhase,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";

/**
 * 自动驾驶 3D 场景融合模式。
 *
 * - "blueprint"：蓝图页（/autopilot），3D 场景跟随 BlueprintRealtimeStore；
 * - "mission-first"：mission-first 任务壳（/tasks 等），3D 场景跟随 mission 信号。
 *
 * 默认值约定为 "mission-first"，确保未显式传 mode 的调用方走原路径。
 */
export type SceneFusionMode = "blueprint" | "mission-first";

/** FSD 蓝图后端使用的 7 个角色名。 */
export type FsdRoleId =
  | "planner"
  | "clarifier"
  | "analyzer"
  | "generator"
  | "reviewer"
  | "auditor"
  | "operator";

/** mission-first 任务壳使用的 7 个 agent id。 */
export type MissionAgentId =
  | "agent-ceo"
  | "agent-manager-research"
  | "agent-manager-design"
  | "agent-manager-engineering"
  | "agent-worker-research"
  | "agent-worker-design"
  | "agent-worker-engineering";

/**
 * FSD roleId → mission agent id 的近似映射表。
 *
 * 映射方向（来自 requirements.md AC6）：
 * - planner   → agent-manager-research
 * - clarifier → agent-ceo
 * - analyzer  → agent-manager-design
 * - generator → agent-worker-design
 * - reviewer  → agent-manager-engineering
 * - auditor   → agent-worker-engineering
 * - operator  → agent-worker-research
 */
const FSD_TO_MISSION: Record<FsdRoleId, MissionAgentId> = {
  planner: "agent-manager-research",
  clarifier: "agent-ceo",
  analyzer: "agent-manager-design",
  generator: "agent-worker-design",
  reviewer: "agent-manager-engineering",
  auditor: "agent-worker-engineering",
  operator: "agent-worker-research",
};

/**
 * 从 BlueprintRealtimeStore.rolePhases 中按 mission agent id 读取对应的 RolePhase。
 *
 * 优先策略（蓝图模式专用，对应 AC9：FSD 优先）：
 *   1. 反查 FSD roleId：遍历 FSD_TO_MISSION，找出所有映射到目标 mission agent id 的
 *      FSD roleId，若 rolePhases[fsdRoleId] 存在则优先返回；
 *   2. fallback 直读 mission agent id（对应 AC6 fallback）；
 *   3. 都没有则返回 undefined。
 *
 * mission-first 模式不调用此函数，组件直接 state.rolePhases[config.id] 读取。
 *
 * 容错：rolePhases 可能为 undefined / null / 空对象，全部安全返回 undefined。
 *
 * @param rolePhases BlueprintRealtimeStore 的 rolePhases 字典
 * @param missionAgentId 目标 mission agent id（PetWorkers 配置中 config.id）
 * @returns 对应的 RolePhase，不存在则 undefined
 */
export function readBlueprintRolePhase(
  rolePhases: Record<string, RolePhase> | undefined | null,
  missionAgentId: MissionAgentId
): RolePhase | undefined {
  if (!rolePhases) return undefined;

  // 反查：找出所有映射到该 mission agent id 的 FSD roleId
  for (const [fsdRoleId, mappedMissionId] of Object.entries(FSD_TO_MISSION)) {
    if (mappedMissionId === missionAgentId) {
      const phase = rolePhases[fsdRoleId];
      if (phase !== undefined) return phase;
    }
  }
  // fallback：直读 mission agent id
  return rolePhases[missionAgentId];
}

export function readBlueprintRoleRuntimeState(
  roleRuntimeStates: Record<string, RoleRuntimeState> | undefined | null,
  missionAgentId: MissionAgentId
): RoleRuntimeState | undefined {
  if (!roleRuntimeStates) return undefined;

  for (const [fsdRoleId, mappedMissionId] of Object.entries(FSD_TO_MISSION)) {
    if (mappedMissionId === missionAgentId) {
      const runtimeState = roleRuntimeStates[fsdRoleId];
      if (runtimeState !== undefined) return runtimeState;
    }
  }

  return roleRuntimeStates[missionAgentId];
}
