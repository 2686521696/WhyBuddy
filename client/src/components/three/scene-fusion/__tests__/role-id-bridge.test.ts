/**
 * autopilot-scene-fusion / Wave B
 * role-id-bridge 纯函数测试。
 *
 * 沿用本仓 example-based 测试模式（vitest 内置 describe / it / expect），
 * 不引入 PBT、不引入新依赖。
 */

import { describe, it, expect } from "vitest";

import type { RolePhase } from "@/lib/blueprint-realtime-store";
import {
  readBlueprintRolePhase,
  readBlueprintRoleRuntimeState,
  type FsdRoleId,
  type MissionAgentId,
} from "../role-id-bridge";

describe("readBlueprintRolePhase / FSD roleId 映射", () => {
  // FSD → mission agent id 的 7 条映射规则（来自 requirements.md AC6）
  const cases: Array<[FsdRoleId, MissionAgentId]> = [
    ["planner", "agent-manager-research"],
    ["clarifier", "agent-ceo"],
    ["analyzer", "agent-manager-design"],
    ["generator", "agent-worker-design"],
    ["reviewer", "agent-manager-engineering"],
    ["auditor", "agent-worker-engineering"],
    ["operator", "agent-worker-research"],
  ];

  for (const [fsdRoleId, missionAgentId] of cases) {
    it(`FSD ${fsdRoleId} → mission ${missionAgentId}`, () => {
      const rolePhases: Record<string, RolePhase> = {
        [fsdRoleId]: "thinking" as RolePhase,
      };
      expect(readBlueprintRolePhase(rolePhases, missionAgentId)).toBe(
        "thinking"
      );
    });
  }
});

describe("readBlueprintRoleRuntimeState / FSD runtime evidence mapping", () => {
  it("maps planner runtime state to agent-manager-research", () => {
    const runtimeStates = {
      planner: {
        roleId: "planner",
        jobId: "job-1",
        stageId: "spec_tree",
        status: "ready",
        runtimeKind: "fallback",
        containerMode: "lite",
        executionMode: "simulated_fallback",
        fallbackReason: "executor unreachable",
        lastUpdated: 123,
      },
    } as const;

    expect(
      readBlueprintRoleRuntimeState(
        runtimeStates,
        "agent-manager-research"
      )
    ).toMatchObject({
      roleId: "planner",
      runtimeKind: "fallback",
      status: "ready",
    });
  });

  it("falls back to mission agent id when no FSD runtime state exists", () => {
    const runtimeStates = {
      "agent-ceo": {
        roleId: "agent-ceo",
        status: "ready",
        runtimeKind: "real",
        containerMode: "real",
        executionMode: "real",
        lastUpdated: 456,
      },
    } as const;

    expect(
      readBlueprintRoleRuntimeState(runtimeStates, "agent-ceo")
    ).toMatchObject({
      roleId: "agent-ceo",
      runtimeKind: "real",
      status: "ready",
    });
  });
});

describe("readBlueprintRolePhase / 兼容与降级", () => {
  it("未知 FSD roleId 时 fallback 到 mission agent id 直读", () => {
    const rolePhases: Record<string, RolePhase> = {
      "agent-ceo": "acting" as RolePhase,
    };
    expect(readBlueprintRolePhase(rolePhases, "agent-ceo")).toBe("acting");
  });

  it("rolePhases 只含 mission agent id 时直读命中", () => {
    const rolePhases: Record<string, RolePhase> = {
      "agent-manager-research": "observing" as RolePhase,
    };
    expect(readBlueprintRolePhase(rolePhases, "agent-manager-research")).toBe(
      "observing"
    );
  });

  it("空 rolePhases 返回 undefined", () => {
    expect(readBlueprintRolePhase({}, "agent-ceo")).toBeUndefined();
  });

  it("undefined rolePhases 返回 undefined（容错）", () => {
    expect(readBlueprintRolePhase(undefined, "agent-ceo")).toBeUndefined();
  });

  it("null rolePhases 返回 undefined（容错）", () => {
    expect(readBlueprintRolePhase(null, "agent-ceo")).toBeUndefined();
  });

  it("同时含 FSD roleId 与 mission agent id 时 FSD 优先（AC9）", () => {
    const rolePhases: Record<string, RolePhase> = {
      planner: "thinking" as RolePhase,
      "agent-manager-research": "completed" as RolePhase,
    };
    expect(readBlueprintRolePhase(rolePhases, "agent-manager-research")).toBe(
      "thinking"
    );
  });

  it("含其他 FSD roleId 但目标 mission agent id 不命中时仍走 fallback", () => {
    const rolePhases: Record<string, RolePhase> = {
      reviewer: "reviewing" as RolePhase, // 映射到 agent-manager-engineering
      "agent-ceo": "completed" as RolePhase,
    };
    // 查 agent-ceo（FSD 反查命中 clarifier，但 rolePhases 没有 clarifier）
    // → fallback 直读 agent-ceo
    expect(readBlueprintRolePhase(rolePhases, "agent-ceo")).toBe("completed");
  });
});
