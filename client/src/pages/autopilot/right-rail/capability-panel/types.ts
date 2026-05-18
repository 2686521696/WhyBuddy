/**
 * 能力 Bridge 运行时面板 — 类型定义
 *
 * 定义 BridgeInvocation、BridgeTypeConfig、BRIDGE_TYPE_CONFIG 常量映射
 * 以及 UseCapabilityBridgeStateReturn 接口。
 *
 * 对应 spec：`.kiro/specs/autopilot-capability-bridge-runtime-panel/`
 * - 需求 3.1, 3.2, 3.3, 3.4
 */

// ---------------------------------------------------------------------------
// BridgeInvocation 接口
// ---------------------------------------------------------------------------

/**
 * 单次能力 Bridge 调用实例。
 *
 * 每条记录对应一次 `capability.invoked` 事件创建的调用，
 * 后续通过 `capability.running / completed / failed` 事件更新状态。
 */
export interface BridgeInvocation {
  /** 调用唯一标识（通常为 capabilityId + 时间戳） */
  id: string;
  /** Bridge 类型：docker / mcp / aigc-node / skill */
  bridgeType: "docker" | "mcp" | "aigc-node" | "skill";
  /** 调用名称（如能力名或工具名） */
  name: string;
  /** 当前状态 */
  status: "pending" | "running" | "completed" | "failed" | "retrying";
  /** 调用开始时间戳（ms） */
  startedAt: number;
  /** 调用完成时间戳（ms），仅 completed / failed 时有值 */
  completedAt?: number;
  /** 调用耗时（ms），仅 completed / failed 时有值 */
  durationMs?: number;
  /** 错误信息，仅 failed 时有值 */
  error?: string;
  /** 重试次数 */
  retryCount?: number;
  /** 阶段索引，用于时间线排序 */
  stageIndex: number;
}

// ---------------------------------------------------------------------------
// BridgeTypeConfig 接口
// ---------------------------------------------------------------------------

/**
 * Bridge 类型视觉配置。
 *
 * 每种 bridgeType 对应一组图标、颜色和标签，用于 UI 差异化展示。
 */
export interface BridgeTypeConfig {
  /** 类型图标（emoji） */
  icon: string;
  /** Tailwind 颜色类（文字色 + 背景色） */
  color: string;
  /** 中文标签 */
  label: string;
}

// ---------------------------------------------------------------------------
// BRIDGE_TYPE_CONFIG 常量映射
// ---------------------------------------------------------------------------

/**
 * 4 种 Bridge 类型的视觉配置常量。
 *
 * - docker: 容器图标，蓝色
 * - mcp: 工具图标，紫色
 * - aigc-node: 节点图标，翠绿色
 * - skill: 技能图标，琥珀色
 */
export const BRIDGE_TYPE_CONFIG: Record<
  BridgeInvocation["bridgeType"],
  BridgeTypeConfig
> = {
  docker: { icon: "🐳", color: "text-blue-600 bg-blue-50", label: "Docker" },
  mcp: { icon: "🔧", color: "text-purple-600 bg-purple-50", label: "MCP" },
  "aigc-node": {
    icon: "⚡",
    color: "text-emerald-600 bg-emerald-50",
    label: "AIGC",
  },
  skill: { icon: "🎯", color: "text-amber-600 bg-amber-50", label: "Skill" },
};

// ---------------------------------------------------------------------------
// UseCapabilityBridgeStateReturn 接口
// ---------------------------------------------------------------------------

/**
 * `useCapabilityBridgeState` hook 的返回值类型。
 *
 * - invocations: 全部调用记录（含已折叠的旧记录）
 * - activeInvocations: 当前活跃调用（pending / running / retrying）
 * - summary: 状态摘要统计
 */
export interface UseCapabilityBridgeStateReturn {
  /** 全部调用记录列表 */
  invocations: BridgeInvocation[];
  /** 当前活跃调用（pending / running / retrying） */
  activeInvocations: BridgeInvocation[];
  /** 状态摘要：total / running / completed / failed 计数 */
  summary: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}
