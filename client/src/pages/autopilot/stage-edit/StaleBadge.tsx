import type { AppLocale } from "@/lib/locale";

export interface StaleBadgeInvalidatedBy {
  stage?: string;
  reason?: string;
  triggeredAt?: string;
}

export interface StaleBadgeProps {
  staleSince?: string | null;
  invalidatedBy?: StaleBadgeInvalidatedBy | null;
  locale?: AppLocale;
}

const STAGE_LABELS_ZH: Record<string, string> = {
  input: "输入",
  clarification: "澄清",
  route_generation: "路线",
  route_selection: "路线选择",
  spec_tree: "规格树",
  spec_docs: "规格文档",
  spec_documents: "规格文档",
  effect_preview: "效果预览",
  prompt_packaging: "提示包",
  runtime_capability: "运行能力",
  engineering_handoff: "工程交接",
  engineering_landing: "落地页",
};

function formatStageLabel(stage: string, locale: AppLocale): string {
  if (locale === "zh-CN") {
    return STAGE_LABELS_ZH[stage] ?? stage;
  }
  return stage;
}

export function StaleBadge({
  staleSince,
  invalidatedBy,
  locale = "en-US",
}: StaleBadgeProps) {
  if (!staleSince) {
    return null;
  }

  const stage = invalidatedBy?.stage ?? "upstream edit";
  const reason = invalidatedBy?.reason ?? "upstream content changed";
  const triggeredAt = invalidatedBy?.triggeredAt ?? staleSince;
  const stageLabel = formatStageLabel(stage, locale);
  const label =
    locale === "zh-CN"
      ? `已过期：${stageLabel} 在 ${triggeredAt} 变更。原因：${reason}`
      : `Stale because ${stageLabel} changed (${reason}) at ${triggeredAt}`;

  return (
    <span
      className="inline-flex max-w-full shrink-0 items-center truncate rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
      data-testid="autopilot-stale-badge"
      title={label}
    >
      {locale === "zh-CN" ? "已过期" : "Stale"}
    </span>
  );
}
