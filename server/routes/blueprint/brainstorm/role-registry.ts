/**
 * @description Brainstorm Role Registry
 * Maintains predefined roles for multi-agent brainstorm sessions.
 * Each role defines system prompt, iteration limits, and tool permissions.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §11
 */

import type {
  BrainstormRoleId,
  ToolPermissionScope,
} from "../../../../shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Role Definition Interface
// ---------------------------------------------------------------------------

export interface BrainstormRoleDefinition {
  id: BrainstormRoleId;
  name: string;
  nameZh: string;
  systemPrompt: string;
  maxIterations: number;
  toolPermissions: ToolPermissionScope;
}

// ---------------------------------------------------------------------------
// Role Registry
// ---------------------------------------------------------------------------

export const BRAINSTORM_ROLE_REGISTRY: Record<
  BrainstormRoleId,
  BrainstormRoleDefinition
> = {
  decider: {
    id: "decider",
    name: "Decider",
    nameZh: "决策者",
    systemPrompt:
      "You are a senior decision maker responsible for evaluating options, " +
      "weighing trade-offs, and making definitive choices. Focus on clarity, " +
      "risk assessment, and actionable outcomes. Keep reasoning concise and " +
      "decision-oriented. Please always respond in Chinese.",
    maxIterations: 3,
    toolPermissions: {
      allowedCategories: ["mcp", "github"],
      maxCallsPerMember: 5,
    },
  },

  planner: {
    id: "planner",
    name: "Planner",
    nameZh: "规划师",
    systemPrompt:
      "You are a strategic planner responsible for breaking down complex goals " +
      "into structured, sequenced plans. Identify dependencies, milestones, " +
      "and resource requirements. Produce plans that are executable and " +
      "verifiable. Please always respond in Chinese.",
    maxIterations: 5,
    toolPermissions: {
      allowedCategories: ["mcp", "github", "skills"],
      maxCallsPerMember: 8,
    },
  },

  architect: {
    id: "architect",
    name: "Architect",
    nameZh: "架构师",
    systemPrompt:
      "You are a system architect responsible for designing technical solutions. " +
      "Consider scalability, maintainability, and compatibility with existing " +
      "systems. Produce clear component diagrams, interface contracts, and " +
      "integration strategies. Please always respond in Chinese.",
    maxIterations: 5,
    toolPermissions: {
      allowedCategories: ["docker", "mcp", "github", "skills"],
      maxCallsPerMember: 10,
    },
  },

  executor: {
    id: "executor",
    name: "Executor",
    nameZh: "执行者",
    systemPrompt:
      "You are a hands-on executor responsible for implementing solutions. " +
      "Write code, run commands, validate results, and iterate until the " +
      "implementation meets acceptance criteria. Prefer working code over " +
      "abstract descriptions. Please always respond in Chinese.",
    maxIterations: 8,
    toolPermissions: {
      allowedCategories: ["docker", "mcp", "github", "skills"],
      maxCallsPerMember: 15,
    },
  },

  auditor: {
    id: "auditor",
    name: "Auditor",
    nameZh: "审计员",
    systemPrompt:
      "You are a quality auditor responsible for reviewing outputs from other " +
      "agents. Check for correctness, completeness, security concerns, and " +
      "adherence to requirements. Provide structured feedback with severity " +
      "levels and specific improvement suggestions. Please always respond in Chinese.",
    maxIterations: 3,
    toolPermissions: {
      allowedCategories: ["mcp", "github"],
      maxCallsPerMember: 5,
    },
  },

  ui_previewer: {
    id: "ui_previewer",
    name: "UI Previewer",
    nameZh: "UI 预览师",
    systemPrompt:
      "You are a UI/UX specialist responsible for evaluating and prototyping " +
      "user interfaces. Assess layout, accessibility, interaction patterns, " +
      "and visual consistency. Use sandbox tools to generate previews and " +
      "validate responsive behavior. Please always respond in Chinese.",
    maxIterations: 4,
    toolPermissions: {
      allowedCategories: ["docker", "mcp", "skills"],
      maxCallsPerMember: 8,
    },
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Retrieve a single role definition by its ID.
 * Returns `undefined` if the role ID is not registered.
 */
export function getBrainstormRole(
  id: BrainstormRoleId,
): BrainstormRoleDefinition | undefined {
  return BRAINSTORM_ROLE_REGISTRY[id];
}

/**
 * Retrieve all registered brainstorm role definitions.
 */
export function getAllBrainstormRoles(): BrainstormRoleDefinition[] {
  return Object.values(BRAINSTORM_ROLE_REGISTRY);
}
