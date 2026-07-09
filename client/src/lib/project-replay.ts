import type {
  AddProjectArtifactInput,
  ProjectArtifact,
  ProjectEvidence,
  ProjectMission,
  ProjectSpec,
} from "./project-store";

export type ProjectReplayTimelineItemKind =
  | "evidence"
  | "artifact"
  | "mission";

export interface ProjectReplayTimelineItem {
  id: string;
  projectId: string;
  kind: ProjectReplayTimelineItemKind;
  title: string;
  detail: string;
  occurredAt: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  artifactType?: ProjectArtifact["type"];
  evidenceType?: ProjectEvidence["type"];
  missionStatus?: ProjectMission["status"];
}

export interface BuildProjectReplayTimelineInput {
  projectId: string;
  evidence: ProjectEvidence[];
  artifacts: ProjectArtifact[];
  missions: ProjectMission[];
  limit?: number;
}

export interface ProjectReplaySummary {
  projectId: string;
  totalItems: number;
  evidenceCount: number;
  artifactCount: number;
  missionCount: number;
  sourceMissionCount: number;
  latestOccurredAt: string | null;
}

export interface ProjectCockpitEvidenceArtifactSummaryItem {
  id: string;
  projectId: string;
  kind: "evidence" | "artifact";
  title: string;
  detail: string;
  occurredAt: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  artifactType?: ProjectArtifact["type"];
  evidenceType?: ProjectEvidence["type"];
}

export interface ProjectCockpitEvidenceArtifactSummary {
  projectId: string;
  items: ProjectCockpitEvidenceArtifactSummaryItem[];
  evidenceCount: number;
  artifactCount: number;
  latestEvidenceAt: string | null;
  latestArtifactAt: string | null;
}

export interface BuildProjectCockpitEvidenceArtifactSummaryInput {
  projectId: string;
  evidence: ProjectEvidence[];
  artifacts: ProjectArtifact[];
  limit?: number;
}

export interface ProjectSpecSourceReference {
  id: string;
  projectId: string;
  kind: "evidence" | "artifact";
  title: string;
  detail: string;
  occurredAt: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  artifactType?: ProjectArtifact["type"];
  evidenceType?: ProjectEvidence["type"];
}

export interface ProjectSpecSourceReferenceSummary {
  specId: string;
  projectId: string;
  version: number;
  references: ProjectSpecSourceReference[];
  missingEvidenceIds: string[];
  missingArtifactIds: string[];
  evidenceCount: number;
  artifactCount: number;
}

export interface BuildProjectSpecSourceReferenceSummaryInput {
  spec: ProjectSpec;
  evidence: ProjectEvidence[];
  artifacts: ProjectArtifact[];
}

export interface ProjectTaskEvidenceArtifactItem {
  id: string;
  projectId: string;
  kind: "evidence" | "artifact";
  title: string;
  detail: string;
  occurredAt: string;
  sourceMissionId: string;
  sourceSpecId?: string;
  artifactType?: ProjectArtifact["type"];
  evidenceType?: ProjectEvidence["type"];
}

export interface ProjectTaskEvidenceArtifactSummary {
  projectId: string;
  missionId: string;
  items: ProjectTaskEvidenceArtifactItem[];
  evidenceCount: number;
  artifactCount: number;
  latestOccurredAt: string | null;
}

export interface BuildProjectTaskEvidenceArtifactSummaryInput {
  projectId: string;
  missionId: string;
  evidence: ProjectEvidence[];
  artifacts: ProjectArtifact[];
  limit?: number;
}

export interface BuildProjectSvgArtifactReferenceInput {
  projectId: string;
  title: string;
  path?: string;
  uri?: string;
  sourceMissionId?: string;
  sourceSpecId?: string;
  contentPreview?: string;
}

export type ProjectSvgArtifactReference = Omit<
  AddProjectArtifactInput,
  "type" | "path"
> & {
  type: "svg";
  path: string;
  uri?: string;
};

export function buildProjectSvgArtifactReference({
  projectId,
  title,
  path,
  uri,
  sourceMissionId,
  sourceSpecId,
  contentPreview,
}: BuildProjectSvgArtifactReferenceInput): ProjectSvgArtifactReference {
  const artifactPath = normalizeProjectSvgArtifactPath(path ?? uri ?? "");

  if (!artifactPath) {
    throw new Error("SVG artifact reference requires a path or uri.");
  }

  return {
    projectId,
    type: "svg",
    title,
    path: artifactPath,
    uri,
    sourceMissionId,
    sourceSpecId,
    contentPreview,
  };
}

function normalizeProjectSvgArtifactPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function compareReplayItems(
  left: Pick<ProjectReplayTimelineItem, "id" | "occurredAt">,
  right: Pick<ProjectReplayTimelineItem, "id" | "occurredAt">
) {
  const timeDiff =
    Date.parse(right.occurredAt || "") - Date.parse(left.occurredAt || "");
  if (timeDiff !== 0 && Number.isFinite(timeDiff)) return timeDiff;
  return right.id.localeCompare(left.id);
}

export function buildProjectReplayTimeline({
  projectId,
  evidence,
  artifacts,
  missions,
  limit,
}: BuildProjectReplayTimelineInput): ProjectReplayTimelineItem[] {
  const evidenceItems: ProjectReplayTimelineItem[] = evidence
    .filter(item => item.projectId === projectId)
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "evidence",
      title: item.title,
      detail: item.detail,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      evidenceType: item.type,
    }));

  const artifactItems: ProjectReplayTimelineItem[] = artifacts
    .filter(item => item.projectId === projectId)
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "artifact",
      title: item.title,
      detail: item.path ?? item.contentPreview ?? item.type,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      sourceSpecId: item.sourceSpecId,
      artifactType: item.type,
    }));

  const missionItems: ProjectReplayTimelineItem[] = missions
    .filter(item => item.projectId === projectId)
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "mission",
      title: `Mission ${item.missionId}`,
      detail: `Status: ${item.status}`,
      occurredAt: item.updatedAt || item.createdAt,
      sourceMissionId: item.missionId,
      missionStatus: item.status,
    }));

  const timeline = [...evidenceItems, ...artifactItems, ...missionItems].sort(
    compareReplayItems
  );

  return typeof limit === "number" && limit >= 0
    ? timeline.slice(0, limit)
    : timeline;
}

export function summarizeProjectReplayTimeline(
  projectId: string,
  timeline: ProjectReplayTimelineItem[]
): ProjectReplaySummary {
  const scopedItems = timeline.filter(item => item.projectId === projectId);
  const sourceMissionIds = new Set(
    scopedItems
      .map(item => item.sourceMissionId)
      .filter((item): item is string => Boolean(item))
  );

  return {
    projectId,
    totalItems: scopedItems.length,
    evidenceCount: scopedItems.filter(item => item.kind === "evidence").length,
    artifactCount: scopedItems.filter(item => item.kind === "artifact").length,
    missionCount: scopedItems.filter(item => item.kind === "mission").length,
    sourceMissionCount: sourceMissionIds.size,
    latestOccurredAt: scopedItems[0]?.occurredAt ?? null,
  };
}

export function buildProjectCockpitEvidenceArtifactSummary({
  projectId,
  evidence,
  artifacts,
  limit = 5,
}: BuildProjectCockpitEvidenceArtifactSummaryInput): ProjectCockpitEvidenceArtifactSummary {
  const evidenceItems: ProjectCockpitEvidenceArtifactSummaryItem[] = evidence
    .filter(item => item.projectId === projectId)
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "evidence",
      title: item.title,
      detail: item.detail,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      evidenceType: item.type,
    }));

  const artifactItems: ProjectCockpitEvidenceArtifactSummaryItem[] = artifacts
    .filter(item => item.projectId === projectId)
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "artifact",
      title: item.title,
      detail: item.path ?? item.contentPreview ?? item.type,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      sourceSpecId: item.sourceSpecId,
      artifactType: item.type,
    }));

  const allItems = [...evidenceItems, ...artifactItems].sort(compareReplayItems);
  const safeLimit = Math.max(0, limit);
  const latestEvidence = [...evidenceItems].sort(compareReplayItems)[0] ?? null;
  const latestArtifact =
    [...artifactItems].sort(compareReplayItems)[0] ?? null;

  return {
    projectId,
    items: allItems.slice(0, safeLimit),
    evidenceCount: evidenceItems.length,
    artifactCount: artifactItems.length,
    latestEvidenceAt: latestEvidence?.occurredAt ?? null,
    latestArtifactAt: latestArtifact?.occurredAt ?? null,
  };
}

export function buildProjectSpecSourceReferenceSummary({
  spec,
  evidence,
  artifacts,
}: BuildProjectSpecSourceReferenceSummaryInput): ProjectSpecSourceReferenceSummary {
  const evidenceById = new Map(
    evidence
      .filter(item => item.projectId === spec.projectId)
      .map(item => [item.id, item])
  );
  const artifactsById = new Map(
    artifacts
      .filter(item => item.projectId === spec.projectId)
      .map(item => [item.id, item])
  );
  const evidenceReferences: ProjectSpecSourceReference[] = [];
  const artifactReferences: ProjectSpecSourceReference[] = [];
  const missingEvidenceIds: string[] = [];
  const missingArtifactIds: string[] = [];

  spec.sourceEvidenceIds.forEach(id => {
    const item = evidenceById.get(id);
    if (!item) {
      missingEvidenceIds.push(id);
      return;
    }
    evidenceReferences.push({
      id: item.id,
      projectId: item.projectId,
      kind: "evidence",
      title: item.title,
      detail: item.detail,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      evidenceType: item.type,
    });
  });

  spec.sourceArtifactIds.forEach(id => {
    const item = artifactsById.get(id);
    if (!item) {
      missingArtifactIds.push(id);
      return;
    }
    artifactReferences.push({
      id: item.id,
      projectId: item.projectId,
      kind: "artifact",
      title: item.title,
      detail: item.path ?? item.contentPreview ?? item.type,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId,
      sourceSpecId: item.sourceSpecId,
      artifactType: item.type,
    });
  });

  const references = [...evidenceReferences, ...artifactReferences].sort(
    compareReplayItems
  );

  return {
    specId: spec.id,
    projectId: spec.projectId,
    version: spec.version,
    references,
    missingEvidenceIds,
    missingArtifactIds,
    evidenceCount: evidenceReferences.length,
    artifactCount: artifactReferences.length,
  };
}

export function buildProjectTaskEvidenceArtifactSummary({
  projectId,
  missionId,
  evidence,
  artifacts,
  limit = 6,
}: BuildProjectTaskEvidenceArtifactSummaryInput): ProjectTaskEvidenceArtifactSummary {
  const evidenceItems: ProjectTaskEvidenceArtifactItem[] = evidence
    .filter(
      item =>
        item.projectId === projectId && item.sourceMissionId === missionId
    )
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "evidence",
      title: item.title,
      detail: item.detail,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId ?? missionId,
      evidenceType: item.type,
    }));

  const artifactItems: ProjectTaskEvidenceArtifactItem[] = artifacts
    .filter(
      item =>
        item.projectId === projectId && item.sourceMissionId === missionId
    )
    .map(item => ({
      id: item.id,
      projectId: item.projectId,
      kind: "artifact",
      title: item.title,
      detail: item.path ?? item.contentPreview ?? item.type,
      occurredAt: item.createdAt,
      sourceMissionId: item.sourceMissionId ?? missionId,
      sourceSpecId: item.sourceSpecId,
      artifactType: item.type,
    }));

  const allItems = [...evidenceItems, ...artifactItems].sort(compareReplayItems);
  const safeLimit = Math.max(0, limit);

  return {
    projectId,
    missionId,
    items: allItems.slice(0, safeLimit),
    evidenceCount: evidenceItems.length,
    artifactCount: artifactItems.length,
    latestOccurredAt: allItems[0]?.occurredAt ?? null,
  };
}
