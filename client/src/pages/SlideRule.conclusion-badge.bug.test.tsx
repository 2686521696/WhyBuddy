/**
 * Conclusion badge binding — projection-layer regression (原 Property 1 页面级锁).
 * Spec: .kiro/specs/sliderule-goal-conclusion-gate/ (Task 1, Property 1)
 *
 * 2026-07-10 用户裁决：顶栏 STATUS 状态盒退役（换 Work/Code 模式切换），
 * 结论徽标不再有页面级 DOM 呈现。本测试从「页面渲染出徽标」下沉为
 * 「投影层正确转录 sessionState.goal.status」——原属性（结论绑定
 * goal.status、clear → 已收敛标签）在 projectConclusionBadge 层继续持有。
 *
 * Validates: Requirements 1.3, 2.4（投影层等价形式）
 */

import { describe, it, expect } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import { projectConclusionBadge } from "./sliderule/conclusion-badge";

describe("conclusion badge projection binds to sessionState.goal.status", () => {
  it('projects the "clear" label when goal.status === "clear"', () => {
    const base = createInitialSessionState(
      "做一个权限管理系统（支持 RBAC + 数据范围）",
      "sliderule-main-proto"
    );
    const state = { ...base, goal: { ...base.goal, status: "clear" as const } };

    const badge = projectConclusionBadge(state);
    expect(badge.label).toBe("已收敛 / clear");
    expect(badge.tone).toBe("clear");
  });

  it("projects 待细化 for a fresh (needs_refinement) session", () => {
    const state = createInitialSessionState(
      "做一个权限管理系统",
      "sliderule-main-proto-2"
    );
    const badge = projectConclusionBadge(state);
    expect(badge.label).toBe("待细化");
    expect(badge.tone).toBe("idle");
  });
});
