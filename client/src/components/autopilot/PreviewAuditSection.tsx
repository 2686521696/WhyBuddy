/**
 * Autopilot v4 信任层 — `PreviewAuditSection`（EP_VIS_AUDIT 连接式区块）。
 *
 * 对应 spec：tasks.md 任务 35 / 35.1；requirements.md 需求 6.1 / 6.5。
 *
 * 把 `useChecksLedger(jobId)` 的 `preview_audit` 条目经 `derivePreviewAuditVerdict`
 * 派生为裁决，交给纯展示组件 `PreviewAuditBadge`。无 preview_audit 数据 / gate 关闭
 * 时渲染空态（badge `hasData=false`）。供 `EffectPreviewPanel` 内嵌。
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { useChecksLedger } from "../../pages/autopilot/right-rail/hooks/use-checks-ledger";
import {
  derivePreviewAuditVerdict,
  selectByCheckType,
} from "../../pages/autopilot/right-rail/trust";
import { PreviewAuditBadge } from "./PreviewAuditBadge";

export interface PreviewAuditSectionProps {
  jobId: string;
  locale: AppLocale;
}

export const PreviewAuditSection: FC<PreviewAuditSectionProps> = ({
  jobId,
  locale,
}) => {
  const { data } = useChecksLedger(jobId, { checkType: "preview_audit" });
  const entries = data?.entries ?? [];
  const auditEntries = selectByCheckType(entries, "preview_audit");
  const verdict = derivePreviewAuditVerdict(entries);

  return (
    <div data-testid="preview-audit-section">
      <PreviewAuditBadge
        verdict={verdict}
        locale={locale}
        hasData={auditEntries.length > 0}
      />
    </div>
  );
};
