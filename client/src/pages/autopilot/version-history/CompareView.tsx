import type {
  BlueprintGenerationArtifactType,
  BlueprintGenerationStage,
} from "@shared/blueprint";

import type { AppLocale } from "@/lib/locale";

import type { StaleAwareArtifact, VersionHistoryJob } from "./types";

interface CompareViewProps {
  leftJob: VersionHistoryJob;
  rightJob: VersionHistoryJob;
  familyJobIds?: string[];
  locale?: AppLocale;
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

const STAGE_LABELS_ZH: Record<BlueprintGenerationStage, string> = {
  input: "输入",
  clarification: "澄清",
  route_generation: "路线",
  spec_tree: "规格树",
  spec_docs: "规格文档",
  preview: "预览",
  effect_preview: "效果预览",
  prompt_packaging: "提示包",
  runtime_capability: "运行能力",
  engineering_handoff: "工程交接",
  engineering_landing: "工程落地",
};

const STATUS_LABELS_ZH: Record<CompareStatus, string> = {
  fresh: "最新",
  stale: "已过期",
  missing: "缺失",
};

function stageLabel(stage: BlueprintGenerationStage, locale: AppLocale): string {
  if (locale === "zh-CN") {
    return STAGE_LABELS_ZH[stage] ?? stage;
  }
  return stage;
}

function statusLabel(status: CompareStatus, locale: AppLocale): string {
  if (locale === "zh-CN") return STATUS_LABELS_ZH[status];
  return status;
}

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
  locale,
}: {
  job: VersionHistoryJob;
  artifact: StaleAwareArtifact | null;
  locale: AppLocale;
}) {
  const status = getArtifactStatus(job, artifact);
  const stalePrefix = locale === "zh-CN" ? "过期于" : "stale since";

  return (
    <td data-status={status} className="px-3 py-2 align-top">
      <div className="text-xs font-semibold uppercase tracking-normal">
        {statusLabel(status, locale)}
      </div>
      <div className="text-xs text-[#4b5563]">
        {artifact ? artifact.createdAt : "—"}
      </div>
      {status === "stale" && artifact?.staleSince ? (
        <div className="text-xs text-[#b45309]">
          {stalePrefix} {artifact.staleSince}
        </div>
      ) : null}
    </td>
  );
}

export function CompareView({
  leftJob,
  rightJob,
  familyJobIds,
  locale = "en-US",
}: CompareViewProps) {
  const familySet = familyJobIds ? new Set(familyJobIds) : null;
  if (familySet && (!familySet.has(leftJob.id) || !familySet.has(rightJob.id))) {
    const crossFamilyMessage =
      locale === "zh-CN"
        ? "两个任务不在当前家族中。"
        : "Jobs are not in the current family.";
    return (
      <section data-testid="version-compare-view" data-state="cross-family">
        {crossFamilyMessage}
      </section>
    );
  }

  const stageHeader = locale === "zh-CN" ? "阶段" : "stage";

  return (
    <section data-testid="version-compare-view" data-state="ready">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2">{stageHeader}</th>
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
                <th className="px-3 py-2 font-medium">{stageLabel(stage, locale)}</th>
                <CompareCell job={leftJob} artifact={leftArtifact} locale={locale} />
                <CompareCell job={rightJob} artifact={rightArtifact} locale={locale} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
