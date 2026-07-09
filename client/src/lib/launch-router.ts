import type { WorkflowInputAttachment } from "@shared/workflow-input";

export type LaunchRuntimeMode = "frontend" | "advanced";

export type LaunchRouteKind =
  | "clarify"
  | "mission"
  | "workflow"
  | "upgrade-required";

export type LaunchRouteCandidateId =
  | "clarify-first"
  | "fast-route"
  | "standard-route"
  | "deep-route"
  | "upgrade-runtime";

export type LaunchRouteCandidateMode =
  | "clarify"
  | "fast"
  | "standard"
  | "deep"
  | "upgrade";

export type LaunchReason =
  | "command_too_short"
  | "missing_outcome"
  | "missing_timeline"
  | "missing_constraints"
  | "attachments_present"
  | "attachment_context_requested"
  | "team_or_workflow_requested"
  | "advanced_runtime_required"
  | "complete_task_brief";

export interface UnifiedLaunchInput {
  text: string;
  attachments?: WorkflowInputAttachment[];
  runtimeMode: LaunchRuntimeMode;
  projectId?: string | null;
  projectName?: string | null;
  projectContext?: {
    status?: string | null;
    currentSpecTitle?: string | null;
    currentRouteTitle?: string | null;
    recentMessages?: Array<{
      content: string;
      kind?: string;
    }>;
    activeMissionCount?: number;
  } | null;
}

export interface LaunchRouteDecision {
  kind: LaunchRouteKind;
  reasons: LaunchReason[];
  requiresAdvancedRuntime: boolean;
  needsClarification: boolean;
  canOverride: boolean;
}

export interface LaunchRouteCandidate {
  id: LaunchRouteCandidateId;
  mode: LaunchRouteCandidateMode;
  launchKind: LaunchRouteKind;
  routeOverride?: "mission" | "workflow";
  recommended: boolean;
  available: boolean;
  disabledReason:
    | "needs_destination_detail"
    | "requires_runtime_upgrade"
    | "not_needed"
    | null;
  reasons: LaunchReason[];
  stages: Array<
    | "destination"
    | "clarification"
    | "route"
    | "fleet"
    | "execution"
    | "review"
    | "evidence"
  >;
  takeoverPoints: Array<
    "clarification" | "runtime-upgrade" | "route-selection" | "final-review"
  >;
}

export interface LaunchRoutePlan {
  decision: LaunchRouteDecision;
  recommendedRouteId: LaunchRouteCandidateId;
  candidates: LaunchRouteCandidate[];
}

function normalizeLaunchText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasTimelineSignal(text: string): boolean {
  return /今天|明天|本周|本周内|下周|下周内|月底|本月|本季度|时间安排|排期|里程碑|timeline|截止|deadline|launch|release|ship|before|by\s+\w+/i.test(
    text
  );
}

function hasConstraintSignal(text: string): boolean {
  return /零停机|zero downtime|回滚|rollback|预算|budget|风险|risk|约束|constraint|兼容|compliance|sla|测试|test/i.test(
    text
  );
}

function hasOutcomeSignal(text: string): boolean {
  return /交付|deliverable|结果|outcome|验收|acceptance|完成标准|metric|指标|目标|success/i.test(
    text
  );
}

function requestsAttachmentContext(text: string): boolean {
  return /附件|文档|材料|表格|图片|ocr|pdf|excel|word|根据附件|基于附件|结合附件|from the attachment|from the document|using the file/i.test(
    text
  );
}

function requestsWorkflowOrTeamSetup(text: string): boolean {
  return /workflow|团队|小队|team|squad|工作包|brief|角色分工|组织团队|先组织|先拆分工/i.test(
    text
  );
}

function requiresAdvancedRuntime(text: string): boolean {
  return /运行命令|执行脚本|打开网页|浏览器|抓日志|容器|沙盒|sandbox|terminal|command|shell|docker|browser|screenshot|navigate/i.test(
    text
  );
}

function requestsProjectCarryover(text: string): boolean {
  return /继续|推进|下一步|按这个|基于这个|照这个|继续做|continue|next|proceed|carry on/i.test(
    text
  );
}

export function evaluateLaunchRoute(
  input: UnifiedLaunchInput
): LaunchRouteDecision {
  const text = normalizeLaunchText(input.text);
  const attachments = input.attachments ?? [];
  const projectContextText = normalizeLaunchText(
    [
      input.projectName,
      input.projectContext?.currentSpecTitle,
      input.projectContext?.currentRouteTitle,
      ...(input.projectContext?.recentMessages ?? []).map(
        message => message.content
      ),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const hasProjectCarryover =
    Boolean(input.projectId) &&
    (Boolean(input.projectContext?.currentSpecTitle) ||
      Boolean(input.projectContext?.currentRouteTitle) ||
      (input.projectContext?.recentMessages?.length ?? 0) > 0);
  const reasons: LaunchReason[] = [];

  const missingOutcome =
    !hasOutcomeSignal(text) && !hasOutcomeSignal(projectContextText);
  const missingTimeline =
    !hasTimelineSignal(text) && !hasTimelineSignal(projectContextText);
  const missingConstraints =
    !hasConstraintSignal(text) && !hasConstraintSignal(projectContextText);
  const missingTopicsCount = [
    missingOutcome,
    missingTimeline,
    missingConstraints,
  ].filter(Boolean).length;
  const wouldNeedClarification =
    text.length < 20 ||
    missingTopicsCount >= 2 ||
    (text.length < 36 && missingTopicsCount >= 1);
  const wantsAttachmentContext = requestsAttachmentContext(text);
  const wantsWorkflowOrTeamSetup = requestsWorkflowOrTeamSetup(text);
  const wantsAdvancedRuntime = requiresAdvancedRuntime(text);
  const wantsProjectCarryover = requestsProjectCarryover(text);
  const projectContextCanCarry =
    hasProjectCarryover &&
    (text.length >= 12 || wantsProjectCarryover) &&
    (input.projectContext?.status === "spec_ready" ||
      input.projectContext?.status === "planning" ||
      input.projectContext?.status === "executing" ||
      Boolean(input.projectContext?.currentSpecTitle));
  const needsClarification =
    wouldNeedClarification && !projectContextCanCarry;

  if (text.length < 36) {
    reasons.push("command_too_short");
  }
  if (missingOutcome) {
    reasons.push("missing_outcome");
  }
  if (missingTimeline) {
    reasons.push("missing_timeline");
  }
  if (missingConstraints) {
    reasons.push("missing_constraints");
  }
  if (attachments.length > 0) {
    reasons.push("attachments_present");
  }
  if (wantsAttachmentContext) {
    reasons.push("attachment_context_requested");
  }
  if (wantsWorkflowOrTeamSetup) {
    reasons.push("team_or_workflow_requested");
  }
  if (wantsAdvancedRuntime) {
    reasons.push("advanced_runtime_required");
  }

  if (wantsAdvancedRuntime && input.runtimeMode === "frontend") {
    return {
      kind: "upgrade-required",
      reasons,
      requiresAdvancedRuntime: true,
      needsClarification,
      canOverride: false,
    };
  }

  if (needsClarification) {
    return {
      kind: "clarify",
      reasons,
      requiresAdvancedRuntime: wantsAdvancedRuntime,
      needsClarification: true,
      canOverride: false,
    };
  }

  if (attachments.length > 0 || wantsAttachmentContext || wantsWorkflowOrTeamSetup) {
    return {
      kind: "workflow",
      reasons,
      requiresAdvancedRuntime: wantsAdvancedRuntime,
      needsClarification: false,
      canOverride: true,
    };
  }

  return {
    kind: "mission",
    reasons: [...reasons, "complete_task_brief"],
    requiresAdvancedRuntime: wantsAdvancedRuntime,
    needsClarification: false,
    canOverride: true,
  };
}

function getRecommendedRouteId(
  decision: LaunchRouteDecision
): LaunchRouteCandidateId {
  if (decision.kind === "upgrade-required") {
    return "upgrade-runtime";
  }
  if (decision.kind === "clarify") {
    return "clarify-first";
  }
  if (decision.kind === "workflow") {
    return "deep-route";
  }
  return "standard-route";
}

export function buildLaunchRoutePlan(
  input: UnifiedLaunchInput
): LaunchRoutePlan {
  const decision = evaluateLaunchRoute(input);
  const recommendedRouteId = getRecommendedRouteId(decision);
  const blockedByUpgrade = decision.kind === "upgrade-required";
  const blockedByClarification = decision.kind === "clarify";
  const canDrive =
    !blockedByUpgrade && !blockedByClarification && input.text.trim().length > 0;

  const candidates: LaunchRouteCandidate[] = [
    {
      id: "clarify-first",
      mode: "clarify",
      launchKind: "clarify",
      recommended: recommendedRouteId === "clarify-first",
      available: blockedByClarification,
      disabledReason: blockedByClarification ? null : "not_needed",
      reasons: decision.reasons,
      stages: ["destination", "clarification", "route", "execution"],
      takeoverPoints: ["clarification", "route-selection"],
    },
    {
      id: "fast-route",
      mode: "fast",
      launchKind: "mission",
      routeOverride: "mission",
      recommended: recommendedRouteId === "fast-route",
      available: canDrive,
      disabledReason: blockedByUpgrade
        ? "requires_runtime_upgrade"
        : blockedByClarification
          ? "needs_destination_detail"
          : null,
      reasons: decision.reasons,
      stages: ["destination", "route", "execution", "evidence"],
      takeoverPoints: ["final-review"],
    },
    {
      id: "standard-route",
      mode: "standard",
      launchKind: "mission",
      routeOverride: "mission",
      recommended: recommendedRouteId === "standard-route",
      available: canDrive,
      disabledReason: blockedByUpgrade
        ? "requires_runtime_upgrade"
        : blockedByClarification
          ? "needs_destination_detail"
          : null,
      reasons: [...decision.reasons, "complete_task_brief"],
      stages: ["destination", "route", "fleet", "execution", "review", "evidence"],
      takeoverPoints: ["route-selection", "final-review"],
    },
    {
      id: "deep-route",
      mode: "deep",
      launchKind: "workflow",
      routeOverride: "workflow",
      recommended: recommendedRouteId === "deep-route",
      available: canDrive,
      disabledReason: blockedByUpgrade
        ? "requires_runtime_upgrade"
        : blockedByClarification
          ? "needs_destination_detail"
          : null,
      reasons: decision.reasons,
      stages: ["destination", "route", "fleet", "execution", "review", "evidence"],
      takeoverPoints: ["route-selection", "runtime-upgrade", "final-review"],
    },
    {
      id: "upgrade-runtime",
      mode: "upgrade",
      launchKind: "upgrade-required",
      recommended: recommendedRouteId === "upgrade-runtime",
      available: blockedByUpgrade,
      disabledReason: blockedByUpgrade ? null : "not_needed",
      reasons: decision.reasons,
      stages: ["destination", "route", "execution"],
      takeoverPoints: ["runtime-upgrade"],
    },
  ];

  return {
    decision,
    recommendedRouteId,
    candidates,
  };
}

