import { describe, expect, it } from "vitest";

import type { WorkflowInputAttachment } from "@shared/workflow-input";

import { buildLaunchRoutePlan, evaluateLaunchRoute } from "./launch-router";

function makeAttachment(
  overrides?: Partial<WorkflowInputAttachment>
): WorkflowInputAttachment {
  return {
    id: "attachment-1",
    name: "brief.md",
    mimeType: "text/markdown",
    size: 128,
    content: "# brief",
    excerpt: "# brief",
    excerptStatus: "parsed",
    ...overrides,
  };
}

describe("launch-router", () => {
  it("routes a complete text-only brief to the mission path", () => {
    const decision = evaluateLaunchRoute({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(decision.kind).toBe("mission");
    expect(decision.needsClarification).toBe(false);
    expect(decision.reasons).toContain("complete_task_brief");
  });

  it("routes underspecified input to the clarification path", () => {
    const decision = evaluateLaunchRoute({
      text: "帮我推进这个任务",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(decision.kind).toBe("clarify");
    expect(decision.needsClarification).toBe(true);
    expect(decision.reasons).toContain("command_too_short");
  });

  it("routes attachment-heavy input to the workflow path", () => {
    const decision = evaluateLaunchRoute({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [makeAttachment()],
    });

    expect(decision.kind).toBe("workflow");
    expect(decision.needsClarification).toBe(false);
    expect(decision.reasons).toContain("attachments_present");
    expect(decision.reasons).toContain("attachment_context_requested");
  });

  it("requires a runtime upgrade when the request needs real execution in frontend mode", () => {
    const decision = evaluateLaunchRoute({
      text: "在沙盒里打开浏览器验证支付页面，抓日志并输出测试结果和回滚建议。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(decision.kind).toBe("upgrade-required");
    expect(decision.requiresAdvancedRuntime).toBe(true);
    expect(decision.reasons).toContain("advanced_runtime_required");
  });

  it("builds a visible route plan with the standard route recommended for complete briefs", () => {
    const plan = buildLaunchRoutePlan({
      text: "本周内重构支付模块，要求零停机和可回滚，并给出验收标准与交付结果。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(plan.recommendedRouteId).toBe("standard-route");
    expect(plan.candidates).toHaveLength(5);
    expect(plan.candidates.map(candidate => candidate.id)).toEqual([
      "clarify-first",
      "fast-route",
      "standard-route",
      "deep-route",
      "upgrade-runtime",
    ]);
    expect(
      plan.candidates.find(candidate => candidate.id === "standard-route")
    ).toMatchObject({
      available: true,
      recommended: true,
      launchKind: "mission",
      routeOverride: "mission",
    });
  });

  it("recommends the clarification route when the destination is underspecified", () => {
    const plan = buildLaunchRoutePlan({
      text: "帮我推进这个任务",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(plan.recommendedRouteId).toBe("clarify-first");
    expect(
      plan.candidates.find(candidate => candidate.id === "clarify-first")
    ).toMatchObject({
      available: true,
      recommended: true,
      launchKind: "clarify",
    });
    expect(
      plan.candidates.find(candidate => candidate.id === "fast-route")
    ).toMatchObject({
      available: false,
      disabledReason: "needs_destination_detail",
    });
  });

  it("uses existing project spec context to avoid repeating clarification", () => {
    const decision = evaluateLaunchRoute({
      text: "继续推进第一版",
      runtimeMode: "advanced",
      attachments: [],
      projectId: "project-1",
      projectName: "Permission System",
      projectContext: {
        status: "spec_ready",
        currentSpecTitle:
          "权限系统第一版 spec，包含 RBAC、审计、验收标准、本周时间安排和回滚约束。",
        recentMessages: [
          {
            kind: "clarification",
            content: "本周内交付第一版，要求包含验收标准和回滚方案。",
          },
        ],
      },
    });

    expect(decision.kind).toBe("mission");
    expect(decision.needsClarification).toBe(false);
  });

  it("recommends the deep route when attachments or workflow context are present", () => {
    const plan = buildLaunchRoutePlan({
      text: "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，最后输出交付结果和时间安排。",
      runtimeMode: "advanced",
      attachments: [makeAttachment()],
    });

    expect(plan.recommendedRouteId).toBe("deep-route");
    expect(
      plan.candidates.find(candidate => candidate.id === "deep-route")
    ).toMatchObject({
      available: true,
      recommended: true,
      launchKind: "workflow",
      routeOverride: "workflow",
    });
  });

  it("blocks driving routes and recommends runtime upgrade when execution needs advanced runtime", () => {
    const plan = buildLaunchRoutePlan({
      text: "在沙盒里打开浏览器验证支付页面，抓日志并输出测试结果和回滚建议。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(plan.recommendedRouteId).toBe("upgrade-runtime");
    expect(
      plan.candidates.find(candidate => candidate.id === "upgrade-runtime")
    ).toMatchObject({
      available: true,
      recommended: true,
      launchKind: "upgrade-required",
    });
    expect(
      plan.candidates.find(candidate => candidate.id === "deep-route")
    ).toMatchObject({
      available: false,
      disabledReason: "requires_runtime_upgrade",
    });
  });
});

