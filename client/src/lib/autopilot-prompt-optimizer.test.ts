import { describe, expect, it } from "vitest";

import {
  buildAutopilotPromptOptimizationMessages,
  normalizeOptimizedAutopilotPrompt,
} from "./autopilot-prompt-optimizer";

describe("autopilot prompt optimizer", () => {
  it("builds an LLM request with project and runtime context", () => {
    const messages = buildAutopilotPromptOptimizationMessages({
      text: "帮我把权限系统跑起来",
      locale: "zh-CN",
      projectName: "权限管理系统",
      projectStatus: "planning",
      currentSpecTitle: "RBAC 登录与账户 spec",
      currentRouteTitle: "需求澄清 -> Spec -> 执行",
      activeTaskTitle: "澄清目标与边界",
      runtimeMode: "advanced",
      attachmentCount: 2,
      activeMissionCount: 1,
      recentMessages: [
        {
          kind: "user",
          content: "需要真实邮箱验证码登录，并沉淀执行证据。",
        },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain(
      "Return only the optimized prompt text"
    );
    expect(messages[0].content).toContain("Simplified Chinese");
    expect(messages[1].content).toContain("权限管理系统");
    expect(messages[1].content).toContain("advanced");
    expect(messages[1].content).toContain("帮我把权限系统跑起来");
  });

  it("normalizes common LLM wrappers around optimized prompt text", () => {
    expect(
      normalizeOptimizedAutopilotPrompt(
        "```text\n优化提示词：请围绕项目目标补齐验收标准。\n```"
      )
    ).toBe("请围绕项目目标补齐验收标准。");

    expect(
      normalizeOptimizedAutopilotPrompt(
        '"Optimized prompt: Audit the Docker runtime capabilities."'
      )
    ).toBe("Audit the Docker runtime capabilities.");
  });
});
