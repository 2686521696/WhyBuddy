import type {
  ClarificationAnswer,
  ClarificationQuestion,
} from "@shared/nl-command/contracts";
import type {
  SubmitCommandRequest,
  SubmitClarificationRequest,
} from "@shared/nl-command/api";

import {
  buildLaunchRoutePlan,
  evaluateLaunchRoute,
  type LaunchRouteDecision,
  type LaunchRouteCandidateId,
  type UnifiedLaunchInput,
} from "./launch-router";
import { useNLCommandStore, type TaskHubCommandSubmissionResult } from "./nl-command-store";
import {
  useProjectStore,
  type ProjectClarificationAnswerType,
  type ProjectArtifactType,
  type ProjectRouteKind,
  type ProjectRouteRiskLevel,
} from "./project-store";
import { useTasksStore } from "./tasks-store";
import {
  useWorkflowStore,
  type WorkflowLaunchResult,
} from "./workflow-store";

export interface UnifiedLaunchSubmitInput extends UnifiedLaunchInput {
  userId?: string;
  priority?: SubmitCommandRequest["priority"];
  timeframe?: SubmitCommandRequest["timeframe"];
  routeOverride?: "mission" | "workflow";
  selectedRouteId?: LaunchRouteCandidateId;
  attachmentsAlreadyRecorded?: boolean;
}

export type UnifiedLaunchResult =
  | {
      route: "mission";
      decision: LaunchRouteDecision;
      missionId: string | null;
      commandId: string;
      status: "created" | "needs_clarification";
    }
  | {
      route: "workflow";
      decision: LaunchRouteDecision;
      workflowId: string;
      missionId: string | null;
      status: "created";
      deduped: boolean;
    }
  | {
      route: "upgrade-required";
      decision: LaunchRouteDecision;
      upgraded: false;
    };

export interface UnifiedClarificationSubmitInput {
  commandId: string;
  answer: ClarificationAnswer;
  projectId?: string | null;
  projectName?: string | null;
}

function toMissionResult(
  decision: LaunchRouteDecision,
  submission: TaskHubCommandSubmissionResult
): UnifiedLaunchResult {
  return {
    route: "mission",
    decision,
    missionId: submission.missionId,
    commandId: submission.commandId,
    status: submission.status,
  };
}

function toWorkflowResult(
  decision: LaunchRouteDecision,
  submission: WorkflowLaunchResult
): UnifiedLaunchResult {
  return {
    route: "workflow",
    decision,
    workflowId: submission.workflowId,
    missionId: submission.missionId,
    status: "created",
    deduped: submission.deduped,
  };
}

function focusMissionIfAvailable(missionId: string | null) {
  if (!missionId) return;
  useTasksStore.getState().selectTask(missionId);
}

function compactRouteText(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function classifyProjectArtifact(
  name: string,
  mimeType: string
): ProjectArtifactType {
  const normalizedName = name.toLowerCase();
  if (normalizedName.endsWith(".svg")) return "svg";
  if (mimeType.startsWith("image/")) return "screenshot";
  if (
    mimeType.includes("json") ||
    normalizedName.endsWith(".csv") ||
    normalizedName.endsWith(".json")
  ) {
    return "dataset";
  }
  if (
    normalizedName.endsWith(".ts") ||
    normalizedName.endsWith(".tsx") ||
    normalizedName.endsWith(".js") ||
    normalizedName.endsWith(".jsx") ||
    normalizedName.endsWith(".py")
  ) {
    return "code";
  }
  return "doc";
}

function projectRouteKindFromCandidate(
  candidateId: LaunchRouteCandidateId | undefined,
  decision: LaunchRouteDecision
): ProjectRouteKind {
  if (candidateId === "fast-route") return "fast";
  if (candidateId === "deep-route" || decision.kind === "workflow") {
    return "deep";
  }
  if (candidateId === "clarify-first" || decision.kind === "clarify") {
    return "conservative";
  }
  if (candidateId === "standard-route" || decision.kind === "mission") {
    return "recommended";
  }
  return "custom";
}

function routeRiskFromDecision(
  decision: LaunchRouteDecision
): ProjectRouteRiskLevel {
  if (decision.kind === "upgrade-required" || decision.requiresAdvancedRuntime) {
    return "high";
  }
  if (decision.kind === "clarify" || decision.needsClarification) {
    return "medium";
  }
  return "low";
}

function rememberProjectArtifacts(input: UnifiedLaunchSubmitInput) {
  if (
    input.attachmentsAlreadyRecorded ||
    !input.projectId ||
    !input.attachments?.length
  ) {
    return;
  }
  const projectStore = useProjectStore.getState();
  input.attachments.forEach(attachment => {
    projectStore.addProjectArtifact({
      projectId: input.projectId ?? undefined,
      type: classifyProjectArtifact(attachment.name, attachment.mimeType),
      title: attachment.name,
      contentPreview:
        attachment.excerpt ||
        `${attachment.mimeType || "unknown type"} · ${attachment.size} bytes`,
    });
  });
}

function rememberProjectLaunch(input: UnifiedLaunchSubmitInput) {
  if (!input.projectId) return;
  const projectStore = useProjectStore.getState();
  projectStore.addProjectMessage({
    projectId: input.projectId,
    role: "user",
    kind: "chat",
    content: input.text,
    createEvidence: true,
    evidenceTitle: "Project launch input",
  });
}

function rememberProjectRoutePlan(
  input: UnifiedLaunchSubmitInput,
  decision: LaunchRouteDecision
) {
  if (!input.projectId) return null;

  const routePlan = buildLaunchRoutePlan(input);
  const selectedCandidate =
    routePlan.candidates.find(
      candidate => candidate.id === input.selectedRouteId
    ) ??
    routePlan.candidates.find(
      candidate => candidate.id === routePlan.recommendedRouteId
    ) ??
    routePlan.candidates[0];
  const title =
    selectedCandidate?.id === "clarify-first"
      ? "Clarify project waypoints"
      : selectedCandidate?.id === "fast-route"
        ? "Fast execution route"
        : selectedCandidate?.id === "deep-route"
          ? "Deep FSD execution route"
          : selectedCandidate?.id === "upgrade-runtime"
            ? "Runtime upgrade route"
            : "Recommended project route";
  const route = useProjectStore.getState().addProjectRoute({
    projectId: input.projectId,
    kind: projectRouteKindFromCandidate(selectedCandidate?.id, decision),
    title,
    summary: [
      compactRouteText(input.text),
      `Decision: ${decision.kind}`,
      decision.reasons.length ? `Signals: ${decision.reasons.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    steps: (selectedCandidate?.stages ?? []).map((stage, index) => ({
      id: `${selectedCandidate?.id ?? "route"}-${stage}-${index}`,
      title: stage.replace(/-/g, " "),
      status: index === 0 ? "running" : "pending",
    })),
    riskLevel: routeRiskFromDecision(decision),
    selected:
      selectedCandidate?.available === true &&
      decision.kind !== "clarify" &&
      decision.kind !== "upgrade-required",
  });

  if (route) {
    useProjectStore.getState().addProjectEvidence({
      projectId: input.projectId,
      type: "route",
      title: "Launch route evaluated",
      detail: route.summary,
    });
  }

  return route;
}

function rememberProjectSubmission(params: {
  projectId?: string | null;
  missionId: string | null;
  route: "mission" | "workflow";
  status: "created" | "needs_clarification";
  detail: string;
}) {
  if (!params.projectId) return;
  const projectStore = useProjectStore.getState();
  if (params.missionId) {
    projectStore.linkMissionToProject({
      projectId: params.projectId,
      missionId: params.missionId,
      status: params.status === "created" ? "queued" : "waiting",
    });
  }
  projectStore.addProjectEvidence({
    projectId: params.projectId,
    type: params.route === "workflow" ? "runtime" : "message",
    title:
      params.status === "created"
        ? "Launch created a project mission"
        : "Launch needs project clarification",
    detail: params.detail,
    sourceMissionId: params.missionId ?? undefined,
  });
}

function projectAnswerTypeFromClarificationQuestion(
  type: ClarificationQuestion["type"]
): ProjectClarificationAnswerType {
  if (type === "single_choice") return "single";
  if (type === "multi_choice") return "multi";
  return "text";
}

function rememberProjectClarificationAnswer(input: UnifiedClarificationSubmitInput) {
  const projectId =
    input.projectId ??
    (useNLCommandStore.getState().commandProjectContextById ?? {})[
      input.commandId
    ]?.projectId ??
    null;
  if (!projectId) return;
  const projectStore = useProjectStore.getState();
  const message = projectStore.addProjectMessage({
    projectId,
    role: "user",
    kind: "clarification",
    content: input.answer.text,
  });
  projectStore.answerProjectClarificationQuestion({
    projectId,
    questionId: input.answer.questionId,
    answer: input.answer.text,
  });
  const evidence = projectStore.addProjectEvidence({
    projectId,
    type: "clarification",
    title: "Project clarification answered",
    detail: [
      `Question: ${input.answer.questionId}`,
      `Answer: ${input.answer.text}`,
      input.answer.selectedOptions?.length
        ? `Selected: ${input.answer.selectedOptions.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  projectStore.addProjectSpec({
    projectId,
    title: "Clarification draft",
    content: [
      "# Clarification draft",
      "",
      `- Question: ${input.answer.questionId}`,
      `- Answer: ${input.answer.text}`,
      input.answer.selectedOptions?.length
        ? `- Selected options: ${input.answer.selectedOptions.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "draft",
    sourceMessageIds: message ? [message.id] : [],
    sourceEvidenceIds: evidence ? [evidence.id] : [],
  });
}

function rememberProjectClarificationQuestions(params: {
  projectId?: string | null;
  commandId: string;
}) {
  const projectId =
    params.projectId ??
    (useNLCommandStore.getState().commandProjectContextById ?? {})[
      params.commandId
    ]?.projectId ??
    null;
  if (!projectId) return;

  const session = useNLCommandStore.getState();
  const dialog = session.currentDialog;
  if (!dialog || dialog.commandId !== params.commandId) return;

  const unansweredQuestions = dialog.questions.filter(
    question =>
      !dialog.answers.some(answer => answer.questionId === question.questionId)
  );
  if (unansweredQuestions.length === 0) return;

  const projectStore = useProjectStore.getState();
  unansweredQuestions.forEach(question => {
    const message = projectStore.addProjectMessage({
      projectId,
      role: "assistant",
      kind: "clarification",
      content: question.text,
    });
    projectStore.addProjectClarificationQuestion({
      projectId,
      text: question.text,
      reason: question.context,
      scope: "goal",
      answerType: projectAnswerTypeFromClarificationQuestion(question.type),
      options: question.options,
      required: true,
      sourceCommandId: params.commandId,
      sourceQuestionId: question.questionId,
      sourceMessageId: message?.id,
    });
  });
  projectStore.addProjectEvidence({
    projectId,
    type: "clarification",
    title: "Launch needs clarification",
    detail: unansweredQuestions.map(question => question.text).join("\n"),
  });
}

function rememberProjectFailure(params: {
  projectId?: string | null;
  title: string;
  error: unknown;
}) {
  if (!params.projectId) return;
  const detail =
    params.error instanceof Error
      ? params.error.message
      : typeof params.error === "string"
        ? params.error
        : "Unknown launch failure";
  useProjectStore.getState().addProjectEvidence({
    projectId: params.projectId,
    type: "failure",
    title: params.title,
    detail,
  });
}

function resolveDecision(input: UnifiedLaunchSubmitInput): LaunchRouteDecision {
  const routePlan = input.selectedRouteId ? buildLaunchRoutePlan(input) : null;
  const selectedCandidate = routePlan?.candidates.find(
    candidate => candidate.id === input.selectedRouteId && candidate.available
  );
  const baseDecision = evaluateLaunchRoute(input);
  const decision = selectedCandidate
    ? {
        ...baseDecision,
        kind: selectedCandidate.launchKind,
      }
    : baseDecision;
  const selectedRouteOverride = input.selectedRouteId
    ? selectedCandidate?.routeOverride
    : null;
  const routeOverride = input.routeOverride ?? selectedRouteOverride;
  if (!routeOverride) {
    return decision;
  }

  if (routeOverride === "mission" && decision.kind !== "upgrade-required") {
    return {
      ...decision,
      kind: "mission",
      canOverride: true,
      needsClarification: decision.kind === "clarify",
    };
  }

  if (routeOverride === "workflow" && decision.kind !== "upgrade-required") {
    return {
      ...decision,
      kind: "workflow",
      canOverride: true,
      needsClarification: false,
    };
  }

  return decision;
}

export async function submitUnifiedLaunch(
  input: UnifiedLaunchSubmitInput
): Promise<UnifiedLaunchResult> {
  const decision = resolveDecision(input);
  rememberProjectLaunch(input);
  rememberProjectArtifacts(input);
  rememberProjectRoutePlan(input, decision);
  if (decision.kind === "upgrade-required") {
    if (input.projectId) {
      useProjectStore.getState().addProjectEvidence({
        projectId: input.projectId,
        type: "runtime",
        title: "Runtime upgrade required",
        detail: input.text,
      });
    }
    return {
      route: "upgrade-required",
      decision,
      upgraded: false,
    };
  }

  if (decision.kind === "workflow") {
    let workflowResult: WorkflowLaunchResult | null;
    try {
      workflowResult = await useWorkflowStore.getState().submitDirective({
        directive: input.text,
        attachments: input.attachments ?? [],
      });
    } catch (error) {
      rememberProjectFailure({
        projectId: input.projectId,
        title: "Workflow launch failed",
        error,
      });
      throw error;
    }
    if (!workflowResult) {
      const error = new Error("Workflow launch failed.");
      rememberProjectFailure({
        projectId: input.projectId,
        title: "Workflow launch failed",
        error,
      });
      throw error;
    }
    focusMissionIfAvailable(workflowResult.missionId);
    rememberProjectSubmission({
      projectId: input.projectId,
      missionId: workflowResult.missionId,
      route: "workflow",
      status: "created",
      detail: input.text,
    });
    return toWorkflowResult(decision, workflowResult);
  }

  let missionSubmission: TaskHubCommandSubmissionResult;
  try {
    missionSubmission = await useNLCommandStore.getState().submitTaskHubCommand({
      commandText: input.text,
      userId: input.userId ?? "office-user",
      priority: input.priority,
      timeframe: input.timeframe,
      projectId: input.projectId,
      projectName: input.projectName,
      createMission: useTasksStore.getState().createMission,
    });
  } catch (error) {
    rememberProjectFailure({
      projectId: input.projectId,
      title: "Mission launch failed",
      error,
    });
    throw error;
  }
  if (missionSubmission.status === "needs_clarification") {
    rememberProjectClarificationQuestions({
      projectId: input.projectId,
      commandId: missionSubmission.commandId,
    });
  }

  focusMissionIfAvailable(missionSubmission.missionId);
  rememberProjectSubmission({
    projectId: input.projectId,
    missionId: missionSubmission.missionId,
    route: "mission",
    status: missionSubmission.status,
    detail: input.text,
  });
  return toMissionResult(decision, missionSubmission);
}

export async function submitUnifiedClarification(
  input: UnifiedClarificationSubmitInput
): Promise<UnifiedLaunchResult | null> {
  rememberProjectClarificationAnswer(input);
  let submission: TaskHubCommandSubmissionResult | null;
  try {
    submission = await useNLCommandStore.getState().submitTaskHubClarification(
      input.commandId,
      {
        answer: input.answer,
      },
      {
        createMission: useTasksStore.getState().createMission,
        projectId: input.projectId,
        projectName: input.projectName,
      }
    );
  } catch (error) {
    rememberProjectFailure({
      projectId: input.projectId,
      title: "Clarification submission failed",
      error,
    });
    throw error;
  }

  if (!submission) {
    return null;
  }

  if (submission.status === "needs_clarification") {
    rememberProjectClarificationQuestions({
      projectId: input.projectId ?? submission.projectId,
      commandId: input.commandId,
    });
  }

  focusMissionIfAvailable(submission.missionId);
  rememberProjectSubmission({
    projectId: input.projectId ?? submission.projectId,
    missionId: submission.missionId,
    route: "mission",
    status: submission.status,
    detail: input.answer.text,
  });
  return {
    route: "mission",
    decision: {
      kind: submission.status === "created" ? "mission" : "clarify",
      reasons: [],
      requiresAdvancedRuntime: false,
      needsClarification: submission.status !== "created",
      canOverride: false,
    },
    missionId: submission.missionId,
    commandId: submission.commandId,
    status: submission.status,
  };
}
