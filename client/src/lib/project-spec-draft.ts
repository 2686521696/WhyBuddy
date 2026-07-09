import type {
  AddProjectSpecInput,
  Project,
  ProjectArtifact,
  ProjectClarificationQuestion,
  ProjectEvidence,
  ProjectMessage,
  ProjectMission,
  ProjectSpec,
} from "./project-store";

export interface BuildInitialProjectSpecDraftInput {
  project: Project;
  messages?: ProjectMessage[];
  clarificationQuestions?: ProjectClarificationQuestion[];
  title?: string;
  makeCurrent?: boolean;
}

export interface BuildProjectSpecUpdateSuggestionInput {
  spec?: ProjectSpec | null;
  projectId?: string;
  evidence?: ProjectEvidence[];
  artifacts?: ProjectArtifact[];
  missions?: ProjectMission[];
  title?: string;
  limit?: number;
}

export interface ProjectSpecUpdateSuggestion {
  projectId: string;
  specId?: string;
  title: string;
  content: string;
  rationale: string;
  sourceEvidenceIds: string[];
  sourceArtifactIds: string[];
  sourceMissionIds: string[];
}

type SpecUpdateSignalKind = "evidence" | "artifact" | "mission";

interface SpecUpdateSignal {
  id: string;
  kind: SpecUpdateSignalKind;
  title: string;
  detail: string;
  occurredAt: string;
  sourceMissionId?: string;
  reason: string;
  sourceEvidenceId?: string;
  sourceArtifactId?: string;
  sourceSpecId?: string;
  priority: number;
}

const SPEC_UPDATE_EVIDENCE_TYPES: ProjectEvidence["type"][] = [
  "decision",
  "runtime",
  "log",
  "failure",
  "artifact-link",
  "source",
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function compareSpecUpdateSignals(
  left: Pick<SpecUpdateSignal, "id" | "occurredAt" | "priority">,
  right: Pick<SpecUpdateSignal, "id" | "occurredAt" | "priority">
) {
  const priorityDiff = right.priority - left.priority;
  if (priorityDiff !== 0) return priorityDiff;

  const timeDiff =
    Date.parse(right.occurredAt || "") - Date.parse(left.occurredAt || "");
  if (timeDiff !== 0 && Number.isFinite(timeDiff)) return timeDiff;

  return right.id.localeCompare(left.id);
}

function formatSignalLine(signal: SpecUpdateSignal) {
  const detail = normalizeText(signal.detail);
  const source = signal.sourceMissionId
    ? ` Source mission: ${signal.sourceMissionId}.`
    : "";
  return `- ${signal.title}: ${detail || signal.reason}.${source}`;
}

function formatClarification(question: ProjectClarificationQuestion) {
  const answer = normalizeText(question.answer || question.defaultAssumption);
  const suffix = question.skippedAt ? " (assumption)" : "";
  return `- ${question.text}: ${answer || "Pending"}${suffix}`;
}

export function buildInitialProjectSpecDraft({
  project,
  messages = [],
  clarificationQuestions = [],
  title,
  makeCurrent,
}: BuildInitialProjectSpecDraftInput): AddProjectSpecInput {
  const projectMessages = messages.filter(
    message => message.projectId === project.id
  );
  const projectClarifications = clarificationQuestions.filter(
    question => question.projectId === project.id
  );
  const answeredClarifications = projectClarifications.filter(
    question => question.answer || question.defaultAssumption
  );
  const openClarifications = projectClarifications.filter(
    question => !question.answer && !question.defaultAssumption
  );
  const latestUserMessage = [...projectMessages]
    .reverse()
    .find(message => message.role === "user");
  const sourceMessageIds = uniq([
    latestUserMessage?.id,
    ...answeredClarifications.map(question => question.sourceMessageId),
  ]);
  const goal = normalizeText(project.goal);
  const summary = normalizeText(project.summary);
  const clarificationLines = answeredClarifications.length
    ? answeredClarifications.map(formatClarification).join("\n")
    : "- No answered clarification has been captured yet.";
  const openQuestionLines = openClarifications.length
    ? openClarifications.map(question => `- ${question.text}`).join("\n")
    : "- None captured.";

  return {
    projectId: project.id,
    title: title?.trim() || `${project.name} Initial Spec`,
    status: "draft",
    sourceMessageIds,
    sourceEvidenceIds: [],
    sourceArtifactIds: [],
    makeCurrent,
    content: [
      `# ${project.name} Initial Spec`,
      "",
      "## Goal",
      goal || "Goal is not defined yet.",
      "",
      "## Current Understanding",
      summary || latestUserMessage?.content || "No summary has been captured yet.",
      "",
      "## Clarifications",
      clarificationLines,
      "",
      "## Scope",
      "- Convert the clarified project intent into an executable spec.",
      "- Keep route planning, execution, and evidence tied to this project.",
      "",
      "## Acceptance Criteria",
      "- The project goal is explicit enough to select a route.",
      "- Constraints and assumptions are visible before execution starts.",
      "- Evidence expectations are recorded for delivery review.",
      "",
      "## Evidence Expectations",
      "- Link future missions, artifacts, decisions, and replay records back to this spec.",
      "",
      "## Open Questions",
      openQuestionLines,
    ].join("\n"),
  };
}

export function buildProjectSpecUpdateSuggestion({
  spec,
  projectId,
  evidence = [],
  artifacts = [],
  missions = [],
  title,
  limit = 6,
}: BuildProjectSpecUpdateSuggestionInput): ProjectSpecUpdateSuggestion | null {
  const scopedProjectId = projectId ?? spec?.projectId;
  if (!scopedProjectId) return null;

  const existingEvidenceIds = new Set(spec?.sourceEvidenceIds ?? []);
  const existingArtifactIds = new Set(spec?.sourceArtifactIds ?? []);
  const existingMissionIds = new Set<string>();
  const safeLimit = Math.max(1, limit);

  const evidenceSignals: SpecUpdateSignal[] = evidence
    .filter(item => item.projectId === scopedProjectId)
    .filter(item => SPEC_UPDATE_EVIDENCE_TYPES.includes(item.type))
    .filter(item => !existingEvidenceIds.has(item.id))
    .map(item => ({
      id: item.id,
      kind: "evidence",
      title:
        item.type === "decision"
          ? `Decision: ${item.title}`
          : `Execution evidence: ${item.title}`,
      detail: item.detail,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      sourceEvidenceId: item.id,
      sourceSpecId: item.sourceSpecId,
      reason:
        item.type === "decision"
          ? "A user decision may change scope, acceptance criteria, or constraints."
          : "Execution evidence may reveal a requirement, constraint, risk, or implementation note that should be reflected in the spec.",
      priority: item.type === "decision" ? 40 : item.type === "failure" ? 35 : 25,
    }));

  const artifactSignals: SpecUpdateSignal[] = artifacts
    .filter(item => item.projectId === scopedProjectId)
    .filter(item => !existingArtifactIds.has(item.id))
    .map(item => ({
      id: item.id,
      kind: "artifact",
      title: `Artifact: ${item.title}`,
      detail: item.contentPreview ?? item.path ?? item.type,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      sourceArtifactId: item.id,
      sourceSpecId: item.sourceSpecId,
      reason:
        "A produced artifact can add concrete deliverables, examples, paths, or review criteria to the project spec.",
      priority: 30,
    }));

  const missionSignals: SpecUpdateSignal[] = missions
    .filter(item => item.projectId === scopedProjectId)
    .filter(item => item.status === "completed" || item.status === "failed")
    .filter(item => {
      const sourceMissionId = item.missionId || item.id;
      if (existingMissionIds.has(sourceMissionId)) return false;
      existingMissionIds.add(sourceMissionId);
      return true;
    })
    .map(item => ({
      id: item.id,
      kind: "mission",
      title:
        item.status === "failed"
          ? `Mission failed: ${item.missionId}`
          : `Mission completed: ${item.missionId}`,
      detail:
        item.status === "failed"
          ? "Execution failed and the spec may need risk, constraint, or recovery updates."
          : "Execution completed and the spec may need to record the completed deliverable or acceptance evidence.",
      occurredAt: item.updatedAt || item.createdAt,
      sourceMissionId: item.missionId || item.id,
      sourceSpecId: item.specId,
      reason:
        item.status === "failed"
          ? "A failed mission is a strong signal that risks, blockers, or acceptance criteria should be clarified."
          : "A completed mission can confirm deliverables or close acceptance criteria in the spec.",
      priority: item.status === "failed" ? 34 : 20,
    }));

  const signals = [
    ...evidenceSignals,
    ...artifactSignals,
    ...missionSignals,
  ]
    .sort(compareSpecUpdateSignals)
    .slice(0, safeLimit);

  if (!signals.length) return null;

  const sourceEvidenceIds = uniq(signals.map(signal => signal.sourceEvidenceId));
  const sourceArtifactIds = uniq(
    signals.map(signal => signal.sourceArtifactId)
  );
  const sourceMissionIds = uniq(signals.map(signal => signal.sourceMissionId));
  const reasons = uniq(signals.map(signal => signal.reason));
  const specLabel = spec ? `v${spec.version} ${spec.title}` : "the current spec";

  return {
    projectId: scopedProjectId,
    specId: spec?.id,
    title:
      title?.trim() ||
      `Spec update suggestion from ${signals.length} project signal${
        signals.length === 1 ? "" : "s"
      }`,
    sourceEvidenceIds,
    sourceArtifactIds,
    sourceMissionIds,
    rationale: reasons.join(" "),
    content: [
      `# Suggested update for ${specLabel}`,
      "",
      "## Why update",
      reasons.map(reason => `- ${reason}`).join("\n"),
      "",
      "## Project signals",
      signals.map(formatSignalLine).join("\n"),
      "",
      "## Suggested spec change",
      "- Review the current scope, constraints, acceptance criteria, and evidence expectations against these project signals.",
      "- Promote only user-visible project outcomes and decisions into the spec; keep internal execution-node details out of the spec text.",
    ].join("\n"),
  };
}
