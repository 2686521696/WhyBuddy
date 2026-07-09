/**
 * Autopilot v4 信任层 — `PreviewProvenanceChip`（EP_VIS_GEN ◆ 出图来源标识）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 32.1–32.3
 * - requirements.md 需求 5（每图 provenance chip + source/ok/errorIndicators）
 *
 * 纯展示组件（SSR 友好）：根据 `classifyProvenance` 把单图来源标为
 * `model_ok`（真实生成）/ `fallback` / `failed`，并展示 modelUsed / retryCount /
 * errorIndicators。非颜色单一编码（带图标 + 文案 + data-* 属性）。
 */

import type { FC } from "react";
import { BadgeCheck, CircleSlash, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { classifyProvenance } from "../../pages/autopilot/right-rail/trust/provenance";
import type {
  BlueprintPreviewProvenance,
  ProvenanceClass,
} from "../../pages/autopilot/right-rail/trust/types";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

const CLASS_TONE: Record<ProvenanceClass, string> = {
  model_ok: "border-emerald-300 bg-emerald-50 text-emerald-700",
  fallback: "border-amber-300 bg-amber-50 text-amber-700",
  failed: "border-rose-300 bg-rose-50 text-rose-700",
};

function classLabel(klass: ProvenanceClass, locale: AppLocale): string {
  switch (klass) {
    case "model_ok":
      return t(locale, "真实生成", "Model");
    case "fallback":
      return t(locale, "兜底", "Fallback");
    case "failed":
      return t(locale, "失败", "Failed");
  }
}

function ClassIcon({ klass }: { klass: ProvenanceClass }) {
  if (klass === "model_ok")
    return <BadgeCheck className="size-3" aria-hidden />;
  if (klass === "fallback")
    return <TriangleAlert className="size-3" aria-hidden />;
  return <CircleSlash className="size-3" aria-hidden />;
}

export interface PreviewProvenanceChipProps {
  provenance: BlueprintPreviewProvenance | null | undefined;
  locale: AppLocale;
}

export const PreviewProvenanceChip: FC<PreviewProvenanceChipProps> = ({
  provenance,
  locale,
}) => {
  const klass = classifyProvenance(provenance);
  const modelUsed = provenance?.modelUsed;
  const retryCount = provenance?.retryCount ?? 0;
  const errorIndicators = provenance?.errorIndicators ?? [];

  return (
    <span
      data-testid="preview-provenance-chip"
      data-provenance-class={klass}
      data-source={provenance?.source ?? "unknown"}
      data-ok={String(provenance?.ok ?? false)}
      className="inline-flex flex-wrap items-center gap-1"
    >
      <Badge
        variant="outline"
        className={cn(
          "inline-flex items-center gap-1 rounded-full text-[9px] font-black",
          CLASS_TONE[klass]
        )}
      >
        <ClassIcon klass={klass} />
        {classLabel(klass, locale)}
      </Badge>
      {modelUsed ? (
        <span
          data-testid="preview-provenance-model"
          className="text-[9px] font-semibold text-slate-400"
        >
          {modelUsed}
        </span>
      ) : null}
      {retryCount > 0 ? (
        <span
          data-testid="preview-provenance-retry"
          className="text-[9px] font-semibold text-slate-400"
        >
          {t(locale, `重试 ${retryCount}`, `retry ${retryCount}`)}
        </span>
      ) : null}
      {errorIndicators.length > 0 ? (
        <span
          data-testid="preview-provenance-errors"
          className="text-[9px] font-semibold text-rose-500"
        >
          {errorIndicators.join(", ")}
        </span>
      ) : null}
    </span>
  );
};
