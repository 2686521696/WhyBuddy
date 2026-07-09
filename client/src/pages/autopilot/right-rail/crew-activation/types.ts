/**
 * Agent Crew 阶段激活可视化 — 类型定义。
 *
 * 定义角色状态、讨论条目、阶段切换事件与 hook 返回值接口。
 * 对应 `.kiro/specs/autopilot-agent-crew-stage-activation` Task 1.2。
 */

/**
 * 角色状态枚举。
 * - active: 正在参与当前阶段工作
 * - watching: 观察中，未主动参与
 * - reviewing: 审阅中
 * - sleeping: 休眠，未参与当前阶段
 */
export type RoleCrewStatus = 'active' | 'watching' | 'reviewing' | 'sleeping';

/**
 * 角色 Crew 条目接口。
 * 表示单个角色在 Crew 中的实时状态。
 */
export interface RoleCrewEntry {
  /** 角色唯一标识 */
  roleId: string;
  /** 角色显示名称 */
  roleName: string;
  /** 当前状态 */
  status: RoleCrewStatus;
  /** 所属阶段索引（0-based） */
  stageIndex: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
}

/**
 * 讨论条目类型枚举。
 * - discussion: 普通讨论
 * - decision: 决策结论
 * - handoff: 交接/移交
 */
export type DiscussionType = 'discussion' | 'decision' | 'handoff';

/**
 * 讨论时间线条目接口。
 * 表示角色之间的一条讨论或决策记录。
 */
export interface DiscussionEntry {
  /** 条目唯一标识 */
  id: string;
  /** 发起角色 ID */
  roleId: string;
  /** 发起角色名称 */
  roleName: string;
  /** 讨论内容 */
  content: string;
  /** 条目类型 */
  type: DiscussionType;
  /** 时间戳（ms） */
  timestamp: number;
  /** 所属阶段索引 */
  stageIndex: number;
}

/**
 * 阶段切换事件接口。
 * 描述从一个阶段切换到另一个阶段时的角色变化。
 */
export interface StageTransitionEvent {
  /** 来源阶段索引 */
  fromStage: number;
  /** 目标阶段索引 */
  toStage: number;
  /** 在目标阶段被激活的角色 ID 列表 */
  activatedRoles: string[];
  /** 在目标阶段被停用的角色 ID 列表 */
  deactivatedRoles: string[];
}

/**
 * useRoleCrewState hook 返回值接口。
 */
export interface UseRoleCrewStateReturn {
  /** 所有角色状态列表 */
  roles: RoleCrewEntry[];
  /** 当前处于 active 状态的角色列表 */
  activeRoles: RoleCrewEntry[];
  /** 当前阶段索引 */
  currentStageIndex: number;
  /** 讨论时间线条目列表 */
  discussions: DiscussionEntry[];
}
