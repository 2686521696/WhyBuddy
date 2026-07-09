/**
 * Autopilot v4 信任层 — `PreviewAuditBadge`（EP_VIS_AUDIT ◆◆ 出图审计裁决）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 33.1–33.4
 * - requirements.md 需求 6（批次裁决 / 欺诈类别 / 回炉状态 / 用户自跑问责语义）
 *
 * 纯展示组件（SSR 友好）：从 `derivePreviewAuditVerdict(ledgerEntries)` 得到的
 * `PreviewAuditVerdict` 渲染批次 pass/fail、三类欺诈发现、回炉 retryCount 与
 * 「回炉耗尽」态。无 preview_audit 数据时由调用方决定是否渲染空态。
 */

import type { FC } from "react";
import { ScanSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type {
  BlueprintCheckStatus,
  PreviewAuditVerdict,
} from "../../pages/autopilot/right-rail/trust/types";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

const BATCH_TONE: Record<BlueprintCheckStatus, string> = {
  pass: "border-emerald-300 bg-emerald-50 text-emerald-700",
  warn: "border-amber-300 bg-amber-50 text-amber-700",
  fail: "border-rose-300 bg-rose-50 text-rose-700",
  skip: "border-slate-300 bg-slate-50 text-slate-500",
};

const FRAUD_LABEL: Record<
  PreviewAuditVerdict["findings"][number]["reason"],
  { zh: string; en: string }
> = {
  fallback_pretending: { zh: "兜底冒充", en: "Fallback fraud" },
  fake_success: { zh: "假成功", en: "Fake success" },
  duplicate_content: { zh: "复制充数", en: "Duplicate" },
};

export interface PreviewAuditBadgeProps {
  verdict: PreviewAuditVerdict;
  locale: AppLocale;
  /** 是否有 preview_audit 台账数据；false 时渲染空态。 */
  hasData?: boolean;
}

export const PreviewAuditBadge: FC<PreviewAuditBadgeProps> = ({
  verdict,
  locale,
  hasData = true,
}) => {
  if (!hasData) {
    return (
      <div
        data-testid="preview-audit-empty"
        className="text-[10px] text-slate-400"
      >
        {t(locale, "暂无出图审计记录", "No preview audit records yet")}
      </div>
    );
  }

  return (
    <section
      data-testid="preview-audit-badge"
      data-batch-status={verdict.batchStatus}
      data-exhausted={String(verdict.exhausted)}
      className="flex flex-col gap-1.5 rounded-[10px] border border-[#0f766e]/20 bg-[#0f766e]/5 px-2.5 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <ScanSearch className="size-3.5 text-[#0f766e]" aria-hidden />
        <span className="text-[10px] font-black uppercase tracking-tight text-slate-500">
          {t(locale, "出图审计", "Preview Audit")}
        </span>
        <Badge
          variant="outline"
          data-testid="preview-audit-batch"
          className={cn(
            "rounded-full text-[9px] font-black",
            BATCH_TONE[verdict.batchStatus]
          )}
        >
          {verdict.batchStatus.toUpperCase()}
        </Badge>
        {verdict.retryCount > 0 ? (
          <span
            data-testid="preview-audit-retry"
            className="text-[9px] font-semibold text-slate-400"
          >
            {t(
              locale,
              `回炉 ${verdict.retryCount}`,
              `reforge ${verdict.retryCount}`
            )}
          </span>
        ) : null}
        {verdict.exhausted ? (
          <Badge
            variant="outline"
            data-testid="preview-audit-exhausted"
            className="rounded-full border-rose-300 bg-rose-50 text-[9px] font-black text-rose-700"
          >
            {t(locale, "回炉耗尽", "Retry exhausted")}
          </Badge>
        ) : null}
      </div>

      {verdict.findings.length > 0 ? (
        <ul
          data-testid="preview-audit-findings"
          className="flex flex-wrap gap-1"
        >
          {verdict.findings.map((f, i) => (
            <li
              key={`${f.reason}-${i}`}
              data-testid={`preview-audit-fraud-${f.reason}`}
              data-severity={f.severity}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[9px] font-bold",
                f.severity === "error"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-amber-300 bg-amber-50 text-amber-700"
              )}
            >
              {t(locale, FRAUD_LABEL[f.reason].zh, FRAUD_LABEL[f.reason].en)}
            </li>
          ))}
        </ul>
      ) : null}

      <p
        data-testid="preview-audit-accountability"
        className="text-[9px] text-slate-400"
      >
        {t(
          locale,
          "由用户自跑核验，agent 改不了这一步。",
          "User-run verification — the agent cannot alter this step."
        )}
      </p>
    </section>
  );
};
