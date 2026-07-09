import type { AutopilotLocalStage } from "./derive-downstream-impact";
import type { AppLocale } from "@/lib/locale";

export interface RightRailStaleArtifact {
  id: string;
  stage: AutopilotLocalStage;
  staleSince?: string | null;
  invalidatedBy?: {
    stage?: string;
    reason?: string;
    triggeredAt?: string;
  } | null;
}

export interface RightRailStaleStatus {
  isRegenerating?: boolean;
  isUpstreamRunning?: boolean;
  runningStage?: string;
}

export interface RightRailStaleIndicatorProps {
  artifact?: RightRailStaleArtifact | null;
  currentStage: AutopilotLocalStage;
  locale?: AppLocale;
  status?: RightRailStaleStatus;
  onRegenerate: (stage: AutopilotLocalStage, artifactId: string) => void;
}

const REGENERATE_LABELS: Record<
  AppLocale,
  Partial<Record<AutopilotLocalStage, string>>
> = {
  "zh-CN": {
    spec_tree: "重新生成规格树",
    spec_documents: "重新生成规格文档",
    effect_preview: "重新生成效果预览",
    prompt_packaging: "重新生成提示包",
    runtime_capability: "重新生成运行能力",
    engineering_handoff: "重新生成工程交接",
    engineering_landing: "重新生成落地页",
  },
  "en-US": {
    spec_tree: "Regenerate spec tree",
    spec_documents: "Regenerate documents",
    effect_preview: "Regenerate preview",
    prompt_packaging: "Regenerate prompt package",
    runtime_capability: "Regenerate runtime capability",
    engineering_handoff: "Regenerate handoff",
    engineering_landing: "Regenerate landing page",
  },
};

const STAGE_LABELS: Partial<Record<AutopilotLocalStage, string>> = {
  input: "输入",
  clarification: "澄清",
  route_generation: "路线",
  route_selection: "路线选择",
  spec_tree: "规格树",
  spec_documents: "规格文档",
  effect_preview: "效果预览",
  prompt_packaging: "提示包",
  runtime_capability: "运行能力",
  engineering_handoff: "工程交接",
  engineering_landing: "落地页",
  agent_crew: "角色编组",
};

export function getRegenerateLabel(
  stage: AutopilotLocalStage,
  locale: AppLocale = "en-US"
): string {
  return (
    REGENERATE_LABELS[locale]?.[stage] ??
    (locale === "zh-CN" ? "重新生成当前阶段" : "Regenerate stage")
  );
}

export function RightRailStaleIndicator({
  artifact,
  currentStage,
  locale = "en-US",
  status,
  onRegenerate,
}: RightRailStaleIndicatorProps) {
  if (!artifact?.staleSince || artifact.stage !== currentStage) {
    return null;
  }

  const isDisabled = Boolean(
    status?.isRegenerating || status?.isUpstreamRunning
  );
  const runningStage = status?.runningStage ?? "upstream stage";
  const hint =
    locale === "zh-CN"
      ? status?.isUpstreamRunning
        ? `等待上游阶段：${STAGE_LABELS[runningStage as AutopilotLocalStage] ?? runningStage}`
        : (artifact.invalidatedBy?.reason ?? `过期时间：${artifact.staleSince}`)
      : status?.isUpstreamRunning
        ? `Waiting for ${runningStage}`
        : (artifact.invalidatedBy?.reason ??
          `Stale since ${artifact.staleSince}`);
  const title =
    locale === "zh-CN"
      ? "当前阶段产物已过期"
      : "Current stage artifact is stale";
  const actionLabel = status?.isRegenerating
    ? locale === "zh-CN"
      ? "正在重新生成..."
      : "Regenerating..."
    : getRegenerateLabel(currentStage, locale);

  return (
    <section
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      data-testid="autopilot-right-rail-stale-indicator"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-medium">{title}</p>
          <p className="m-0 mt-1 text-xs text-amber-800">{hint}</p>
        </div>
        <button
          className="shrink-0 rounded-md bg-amber-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
          disabled={isDisabled}
          onClick={() => onRegenerate(currentStage, artifact.id)}
          type="button"
        >
          {actionLabel}
        </button>
      </div>
    </section>
  );
}
