import { describe, expect, it } from "vitest";

import {
  BlueprintEventName,
  resolveBlueprintEventFamily,
  type BlueprintGenerationEventFamily,
  type BlueprintGenerationEventType,
} from "../events.js";

/**
 * 事件目录的 co-located 单测。
 *
 * 这里不追求语义行为覆盖，只做两件事：
 * 1. 锁定 `BlueprintEventName` 常量与 `BlueprintGenerationEventType` union 之间的同构关系。
 * 2. 验证 `resolveBlueprintEventFamily` 与 13 个家族定义一致。
 *
 * 本文件是 example-based 断言，不是 PBT。
 */

const KNOWN_FAMILIES: ReadonlySet<BlueprintGenerationEventFamily> = new Set([
  "job",
  "clarification",
  "route",
  "spec",
  "preview",
  "prompt",
  "mission",
  "evidence",
  "role",
  "capability",
  "crew",
  "sandbox",
  "brainstorm",
  "checks",
]);

describe("BlueprintEventName", () => {
  it("ships 14 families, matching the design inventory", () => {
    expect(KNOWN_FAMILIES.size).toBe(14);
  });

  it("每个常量值都是合法的 BlueprintGenerationEventType", () => {
    const values = Object.values(BlueprintEventName);
    const uniqueValues = new Set(values);

    expect(uniqueValues.size).toBe(values.length);
    for (const value of values) {
      const family = resolveBlueprintEventFamily(value);
      expect(KNOWN_FAMILIES.has(family)).toBe(true);
    }
  });

  it("常量键名使用 PascalCase，不与事件名混用", () => {
    for (const key of Object.keys(BlueprintEventName)) {
      expect(key).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(key).not.toContain(".");
    }
  });

  it("exposes RoleSleeping constant matching role.sleeping", () => {
    expect(BlueprintEventName.RoleSleeping).toBe("role.sleeping");
  });

  it("exposes ReplanTriggered constant in the job lifecycle family", () => {
    expect(BlueprintEventName.ReplanTriggered).toBe("replan.triggered");
    expect(resolveBlueprintEventFamily(BlueprintEventName.ReplanTriggered)).toBe(
      "job",
    );
  });

  it("`role.agent.thinking` 仍按首段 `.` 归入 role 家族", () => {
    // `autopilot-agent-reasoning-stream` spec Task 2.4：单独一条聚焦断言，
    // 防止后续把 `resolveBlueprintEventFamily` 改成字面量映射时漏掉
    // 带两个 `.` 的子家族事件，导致 `BlueprintSocketRelay.DEFAULT_RELAY_FAMILIES`
    // 过滤出错。
    expect(resolveBlueprintEventFamily("role.agent.thinking")).toBe("role");
  });

  it("resolveBlueprintEventFamily 返回事件名的首段", () => {
    const samples: Array<{ type: BlueprintGenerationEventType; family: BlueprintGenerationEventFamily }> = [
      { type: BlueprintEventName.JobCreated, family: "job" },
      { type: BlueprintEventName.ClarificationAnswered, family: "clarification" },
      { type: BlueprintEventName.RouteSelected, family: "route" },
      { type: BlueprintEventName.SpecTreeVersioned, family: "spec" },
      { type: BlueprintEventName.SpecDocumentReviewed, family: "spec" },
      { type: BlueprintEventName.ReplanTriggered, family: "job" },
      { type: BlueprintEventName.PreviewGenerated, family: "preview" },
      { type: BlueprintEventName.PromptPackaged, family: "prompt" },
      { type: BlueprintEventName.MissionHandoff, family: "mission" },
      { type: BlueprintEventName.EvidenceRecorded, family: "evidence" },
      // autopilot-mirofish-stream（2026-05-17）：3 条新事件归入既有家族,
      // 不扩展 12 家族目录。
      { type: BlueprintEventName.SpecNodeCompleted, family: "spec" },
      { type: BlueprintEventName.EvidenceArtifactCreated, family: "evidence" },
      { type: BlueprintEventName.RoleCapabilityInvoked, family: "role" },
      { type: BlueprintEventName.CapabilityFailed, family: "capability" },
      { type: BlueprintEventName.CrewContextUpdated, family: "crew" },
      { type: BlueprintEventName.SandboxJobCompleted, family: "sandbox" },
      { type: BlueprintEventName.RoleSleeping, family: "role" },
      // `autopilot-role-container-loader` spec Task 1.4：新增 4 条角色容器
      // 生命周期事件，仍归入 `role` 家族，不扩展 12 家族目录。
      { type: BlueprintEventName.RoleContainerProvisioning, family: "role" },
      { type: BlueprintEventName.RoleContainerReady, family: "role" },
      { type: BlueprintEventName.RoleContainerTeardown, family: "role" },
      { type: BlueprintEventName.RoleContainerFailed, family: "role" },
      // `autopilot-agent-reasoning-stream` spec Task 2.4：新增 7 条 Agent ReAct
      // 事件，按首段 `.` 截取仍归入 `role` 家族；这里逐条断言以防 family
      // resolver 改动后悄悄把它们漂移到其它家族。
      { type: BlueprintEventName.RoleAgentIterationStarted, family: "role" },
      { type: BlueprintEventName.RoleAgentThinking, family: "role" },
      { type: BlueprintEventName.RoleAgentActing, family: "role" },
      { type: BlueprintEventName.RoleAgentObserving, family: "role" },
      { type: BlueprintEventName.RoleAgentIterationCompleted, family: "role" },
      { type: BlueprintEventName.RoleAgentError, family: "role" },
      { type: BlueprintEventName.RoleAgentCompleted, family: "role" },
      // `autopilot-multi-agent-brainstorm` spec Task 1.2：新增 9 条 brainstorm
      // 事件，引入第 13 个家族 `brainstorm`。
      { type: BlueprintEventName.BrainstormSessionStarted, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormSessionCompleted, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormSessionFailed, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormModeSelected, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormNodeCreated, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormNodeUpdated, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormToolCompleted, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormToolFailed, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormDegraded, family: "brainstorm" },
      // `blueprint-v4-full-loop-completion` Task 1.2：新增 deliberation /
      // companion / preview batch events. Companion events deliberately map
      // into the existing checks family.
      { type: BlueprintEventName.BrainstormRoundCompleted, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormChallengeIssued, family: "brainstorm" },
      { type: BlueprintEventName.BrainstormVoteCompleted, family: "brainstorm" },
      // `autopilot-brainstorm-real-collaboration` spec Task 1.2：新增结构化反驳
      // 事件，按首段 `.` 截取仍归入 `brainstorm` 家族，不扩展家族目录。
      { type: BlueprintEventName.BrainstormRebuttalIssued, family: "brainstorm" },
      { type: BlueprintEventName.CompanionChallengeStarted, family: "checks" },
      { type: BlueprintEventName.CompanionChallengeResolved, family: "checks" },
      { type: BlueprintEventName.PreviewBatchCompleted, family: "preview" },
      { type: BlueprintEventName.ChecksEntryRecorded, family: "checks" },
      { type: BlueprintEventName.ChecksGatePassed, family: "checks" },
      { type: BlueprintEventName.ChecksGateFailed, family: "checks" },
    ];

    for (const sample of samples) {
      expect(resolveBlueprintEventFamily(sample.type)).toBe(sample.family);
    }
  });

  it("覆盖当前 contracts 里已有的 21 个历史事件名", () => {
    const legacyEventNames: BlueprintGenerationEventType[] = [
      "job.created",
      "job.stage",
      "job.completed",
      "job.failed",
      "crew.context.updated",
      "capability.invoked",
      "capability.completed",
      "capability.failed",
      "role.activated",
      "role.watching",
      "role.capability_invoked",
      "role.review_started",
      "role.review_completed",
      "role.completed",
      "preview.generated",
      "prompt.packaged",
      "mission.handoff",
      "sandbox.job.started",
      "sandbox.job.completed",
      "sandbox.job.failed",
    ];

    const enumValues = new Set<BlueprintGenerationEventType>(
      Object.values(BlueprintEventName) as BlueprintGenerationEventType[]
    );

    for (const name of legacyEventNames) {
      expect(enumValues.has(name)).toBe(true);
    }
  });

  it("resolves companion challenge events to the checks family", () => {
    expect(
      resolveBlueprintEventFamily("companion.challenge.started"),
    ).toBe("checks");
    expect(
      resolveBlueprintEventFamily("companion.challenge.resolved"),
    ).toBe("checks");
  });

  it("exposes v4 full-loop event constants", () => {
    expect(BlueprintEventName.BrainstormRoundCompleted).toBe(
      "brainstorm.round.completed",
    );
    expect(BlueprintEventName.BrainstormChallengeIssued).toBe(
      "brainstorm.challenge.issued",
    );
    expect(BlueprintEventName.BrainstormVoteCompleted).toBe(
      "brainstorm.vote.completed",
    );
    expect(BlueprintEventName.CompanionChallengeStarted).toBe(
      "companion.challenge.started",
    );
    expect(BlueprintEventName.CompanionChallengeResolved).toBe(
      "companion.challenge.resolved",
    );
    expect(BlueprintEventName.PreviewBatchCompleted).toBe(
      "preview.batch.completed",
    );
  });

  it("exposes the brainstorm.rebuttal.issued event in the brainstorm family", () => {
    // `autopilot-brainstorm-real-collaboration` spec Task 1.2
    expect(BlueprintEventName.BrainstormRebuttalIssued).toBe(
      "brainstorm.rebuttal.issued",
    );
    expect(
      resolveBlueprintEventFamily("brainstorm.rebuttal.issued"),
    ).toBe("brainstorm");
  });
});
