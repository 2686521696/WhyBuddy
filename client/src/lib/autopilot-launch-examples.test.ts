import { describe, expect, it } from "vitest";

import type { WorkflowInputAttachment } from "@shared/workflow-input";

import {
  AUTOPILOT_LAUNCH_EXAMPLES,
  buildLaunchDestinationPreview,
} from "./autopilot-launch-examples";
import { buildLaunchRoutePlan } from "./launch-router";

function makeAttachment(
  overrides?: Partial<WorkflowInputAttachment>
): WorkflowInputAttachment {
  return {
    id: "attachment-1",
    name: "需求说明.md",
    mimeType: "text/markdown",
    size: 1024,
    content: "# 需求说明",
    excerpt: "项目需要拆分目标、风险、工作包和验收标准。",
    excerptStatus: "parsed",
    ...overrides,
  };
}

describe("autopilot launch examples", () => {
  it("provides six destination example categories for launch onboarding chips", () => {
    expect(AUTOPILOT_LAUNCH_EXAMPLES.map(example => example.kind)).toEqual([
      "analysis",
      "generation",
      "implementation",
      "research",
      "attachment",
      "advanced-execution",
    ]);
    expect(AUTOPILOT_LAUNCH_EXAMPLES.map(example => example.routeId)).toEqual([
      "standard-route",
      "standard-route",
      "standard-route",
      "standard-route",
      "deep-route",
      "upgrade-runtime",
    ]);
    expect(AUTOPILOT_LAUNCH_EXAMPLES.every(example => example.label)).toBe(true);
    expect(
      AUTOPILOT_LAUNCH_EXAMPLES.every(example => example.englishLabel)
    ).toBe(true);
  });

  it("keeps examples aligned with currently supported route previews", () => {
    for (const example of AUTOPILOT_LAUNCH_EXAMPLES) {
      const plan = buildLaunchRoutePlan(example.input);
      const selected = plan.candidates.find(
        candidate => candidate.id === example.routeId
      );

      expect(selected, example.kind).toBeTruthy();
      expect(selected?.available, example.kind).toBe(true);
    }
  });

  it("builds a high-confidence preview for a complete destination input", () => {
    const preview = buildLaunchDestinationPreview({
      text:
        "本周内完成会员续费页改版说明稿，交付产品说明和验收清单，约束是兼容移动端和现有埋点，成功标准是方案可被设计和研发直接评审。",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(preview).toMatchObject({
      goal: "本周内完成会员续费页改版说明稿",
      deliverable: "产品说明和验收清单",
      constraints: ["兼容移动端", "现有埋点"],
      timeline: "本周内",
      successCriteria: ["方案可被设计", "研发直接评审"],
      missingFields: [],
      confidence: "high",
      attachmentInfluence: {
        count: 0,
        affectsRoute: false,
      },
      route: {
        kind: "mission",
        recommendedRouteId: "standard-route",
        mode: "standard",
        needsClarification: false,
        requiresAdvancedRuntime: false,
      },
    });
  });

  it("marks short destination input as clarification-first with missing fields", () => {
    const preview = buildLaunchDestinationPreview({
      text: "帮我推进这个任务",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(preview.goal).toBe("推进这个任务");
    expect(preview.deliverable).toBe("待确认交付物");
    expect(preview.missingFields).toEqual(
      expect.arrayContaining([
        "goal",
        "deliverable",
        "constraints",
        "timeline",
        "successCriteria",
      ])
    );
    expect(preview.confidence).toBe("low");
    expect(preview.route).toMatchObject({
      kind: "clarify",
      recommendedRouteId: "clarify-first",
      mode: "clarify",
      needsClarification: true,
    });
  });

  it("captures attachment influence and aligns attachment-heavy input to deep route", () => {
    const preview = buildLaunchDestinationPreview({
      text:
        "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，月底前交付排期、风险清单和验收标准。",
      runtimeMode: "advanced",
      attachments: [
        makeAttachment(),
        makeAttachment({ id: "attachment-2", name: "排期.xlsx" }),
      ],
    });

    expect(preview.attachmentInfluence).toMatchObject({
      count: 2,
      names: ["需求说明.md", "排期.xlsx"],
      affectsRoute: true,
    });
    expect(preview.attachmentInfluence.summary).toContain("已附 2 个材料");
    expect(preview.timeline).toBe("月底前");
    expect(preview.route).toMatchObject({
      kind: "workflow",
      recommendedRouteId: "deep-route",
      mode: "deep",
      needsClarification: false,
    });
    expect(preview.confidence).toBe("medium");
  });

  it("flags advanced execution input as runtime upgrade when launched from frontend mode", () => {
    const preview = buildLaunchDestinationPreview({
      text:
        "在沙箱里打开浏览器验证支付页面，抓取日志并输出测试结果、回滚建议和验收标准，今天完成。",
      runtimeMode: "frontend",
      attachments: [],
    });

    expect(preview.goal).toBe("在沙箱里打开浏览器验证支付页面");
    expect(preview.deliverable).toBe("测试结果、回滚建议和验收标准");
    expect(preview.constraints).toEqual([]);
    expect(preview.missingFields).toContain("constraints");
    expect(preview.timeline).toBe("今天完成");
    expect(preview.route).toMatchObject({
      kind: "upgrade-required",
      recommendedRouteId: "upgrade-runtime",
      mode: "upgrade",
      requiresAdvancedRuntime: true,
    });
  });

  it("normalizes mixed destination aliases for preview-safe fields", () => {
    const preview = buildLaunchDestinationPreview({
      destinationText:
        "Ship partner readiness by Friday with governance constraints and acceptance criteria.",
      destination: {
        destination_goal: "Ship partner readiness",
        user_request: "Prepare the readiness packet.",
        deliverable: "readiness-summary.md",
        success_criteria: [{ description: "Partner owner can approve." }],
        missing_info: [{ item: "Partner approver" }],
      },
      deliverables: ["risk-register.md"],
      constraints: [{ value: "Use approved evidence only" }],
      lock_state: "needs_clarification",
      runtimeMode: "advanced",
      attachments: [],
    });

    expect(preview).toMatchObject({
      goal: "Ship partner readiness",
      request: "Prepare the readiness packet.",
      deliverable: "readiness-summary.md, risk-register.md",
      deliverables: ["readiness-summary.md", "risk-register.md"],
      constraints: ["Use approved evidence only"],
      successCriteria: ["Partner owner can approve."],
      missingInfo: ["Partner approver"],
      lockState: "needs-reconfirm",
    });
    expect(preview.missingFields).not.toContain("deliverable");
    expect(preview.missingFields).not.toContain("constraints");
    expect(preview.missingFields).not.toContain("successCriteria");
  });
});
