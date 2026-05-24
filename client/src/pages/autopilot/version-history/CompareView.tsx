import type {
  BlueprintGenerationArtifactType,
  BlueprintGenerationStage,
} from "@shared/blueprint";

import type { StaleAwareArtifact, VersionHistoryJob } from "./types";

interface CompareViewProps {
  leftJob: VersionHistoryJob;
  rightJob: VersionHistoryJob;
  familyJobIds?: string[];
}

type CompareStatus = "fresh" | "stale" | "missing";

const STAGE_ARTIFACT_TYPES: Array<{
  stage: BlueprintGenerationStage;
  artifactTypes: BlueprintGenerationArtifactType[];
}> = [
  { stage: "input", artifactTypes: ["intake", "github_source", "project_context"] },
  { stage: "clarification", artifactTypes: ["clarification_session"] },
  { stage: "route_generation", artifactTypes: ["route_set", "route_selection"] },
  { stage: "spec_tree", artifactTypes: ["spec_tree", "spec_tree_version"] },
  { stage: "spec_docs", artifactTypes: ["requirements", "design", "tasks", "spec_document_version"] },
  { stage: "preview", artifactTypes: ["preview"] },
  { stage: "effect_preview", artifactTypes: ["effect_preview"] },
  { stage: "prompt_packaging", artifactTypes: ["prompt_pack"] },
  {
    stage: "runtime_capability",
    artifactTypes: [
      "capability_registry",
      "agent_crew",
      "role_timeline",
      "capability_invocation",
      "capability_evidence",
      "sandbox_derivation_job",
    ],
  },
  { stage: "engineering_handoff", artifactTypes: ["engineering_plan"] },
  { stage: "engineering_landing", artifactTypes: ["engineering_run"] },
];

function latestStageArtifact(
  job: VersionHistoryJob,
  artifactTypes: BlueprintGenerationArtifactType[],
): StaleAwareArtifact | null {
  const candidates = job.artifacts
    .filter((artifact): artifact is StaleAwareArtifact =>
      artifactTypes.includes(artifact.type),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return candidates[0] ?? null;
}

function getArtifactStatus(
  job: VersionHistoryJob,
  artifact: StaleAwareArtifact | null,
): CompareStatus {
  if (!artifact) {
    return "missing";
  }

  if (
    artifact.staleSince ||
    artifact.invalidatedBy ||
    job.staleArtifactIds?.includes(artifact.id)
  ) {
    return "stale";
  }

  return "fresh";
}

function CompareCell({
  job,
  artifact,
}: {
  job: VersionHistoryJob;
  artifact: StaleAwareArtifact | null;
}) {
  const status = getArtifactStatus(job, artifact);

  return (
    <td data-status={status} className="px-3 py-2 align-top">
      <div className="text-xs font-semibold uppercase tracking-normal">{status}</div>
      <div className="text-xs text-[#4b5563]">
        {artifact ? artifact.createdAt : "—"}
      </div>
      {status === "stale" && artifact?.staleSince ? (
        <div className="text-xs text-[#b45309]">stale since {artifact.staleSince}</div>
      ) : null}
    </td>
  );
}

export function CompareView({ leftJob, rightJob, familyJobIds }: CompareViewProps) {
  const familySet = familyJobIds ? new Set(familyJobIds) : null;
  if (familySet && (!familySet.has(leftJob.id) || !familySet.has(rightJob.id))) {
    return (
      <section data-testid="version-compare-view" data-state="cross-family">
        Jobs are not in the current family.
      </section>
    );
  }

  return (
    <section data-testid="version-compare-view" data-state="ready">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2">stage</th>
            <th className="px-3 py-2">{leftJob.id}</th>
            <th className="px-3 py-2">{rightJob.id}</th>
          </tr>
        </thead>
        <tbody>
          {STAGE_ARTIFACT_TYPES.map(({ stage, artifactTypes }) => {
            const leftArtifact = latestStageArtifact(leftJob, artifactTypes);
            const rightArtifact = latestStageArtifact(rightJob, artifactTypes);
            return (
              <tr key={stage} data-stage={stage}>
                <th className="px-3 py-2 font-medium">{stage}</th>
                <CompareCell job={leftJob} artifact={leftArtifact} />
                <CompareCell job={rightJob} artifact={rightArtifact} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
