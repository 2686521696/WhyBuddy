/**
 * Autopilot v4 信任层 — `CompanionFindingsPanel`（CO 伴随发现 · Critic / Grounding）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 46–51
 * - requirements.md 需求 8（role / severity / stage / findings / suggestedActions /
 *   citations / repoFilesRead；warn/error 优先；空态；按阶段关联）/ R2.8 露出
 *
 * 数据来自 `job.companionFindings`（无新真相源）。纯展示组件
 * `CompanionFindingsView` 由外层 hook 接入，SSR 组件测试以 fixture 驱动。
 */

import type { FC } from "react";
import { Microscope, ShieldQuestion } from "lucide-react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useCompanionFindings } from "../hooks/use-companion-findings";
import { groupCompanionByStage, sortBySeverity } from "../trust";
import type { CompanionFinding } from "../trust/types";
import type { CompanionFindingsSource } from "../trust/companion";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

const SEVERITY_TONE: Record<CompanionFinding["severity"], string> = {
  error: "border-rose-300 bg-rose-50 text-rose-700",
  warn: "border-amber-300 bg-amber-50 text-amber-700",
  info: "border-slate-300 bg-slate-50 text-slate-500",
};

function FindingCard({
  finding,
  locale,
}: {
  finding: CompanionFinding;
  locale: AppLocale;
}) {
  const roleLabel =
    finding.role === "critic"
      ? t(locale, "挑刺者", "Critic")
      : t(locale, "接地者", "Grounding");
  return (
    <li
      data-testid="companion-finding-card"
      data-role={finding.role}
      data-severity={finding.severity}
      data-stage={finding.stage}
      className={cn(
        "rounded-[10px] border px-2.5 py-2",
        SEVERITY_TONE[finding.severity]
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {finding.role === "critic" ? (
          <ShieldQuestion className="size-3" aria-hidden />
        ) : (
          <Microscope className="size-3" aria-hidden />
        )}
        <span className="text-[10px] font-black uppercase tracking-tight">
          {roleLabel}
        </span>
        <span className="rounded-full border border-current px-1.5 text-[9px] font-black uppercase">
          {finding.severity}
        </span>
        <span className="text-[9px] font-semibold opacity-70">
          {finding.stage}
        </span>
      </div>
      {finding.findings.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-[11px]">
          {finding.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      ) : null}
      {finding.suggestedActions.length > 0 ? (
        <div
          data-testid="companion-finding-actions"
          className="mt-1 text-[10px] opacity-80"
        >
          {t(locale, "建议：", "Actions: ")}
          {finding.suggestedActions.join("; ")}
        </div>
      ) : null}
      {finding.citations.length > 0 ? (
        <div
          data-testid="companion-finding-citations"
          className="mt-1 text-[10px] opacity-70"
        >
          {t(locale, "引用：", "Citations: ")}
          {finding.citations.join(", ")}
        </div>
      ) : null}
      {finding.repoFilesRead && finding.repoFilesRead.length > 0 ? (
        <div
          data-testid="companion-finding-repofiles"
          className="mt-1 text-[10px] opacity-70"
        >
          {t(locale, "读取仓库文件：", "Repo files: ")}
          {finding.repoFilesRead.join(", ")}
        </div>
      ) : null}
    </li>
  );
}

export interface CompanionFindingsViewProps {
  findings: CompanionFinding[];
  locale: AppLocale;
}

export const CompanionFindingsView: FC<CompanionFindingsViewProps> = ({
  findings,
  locale,
}) => {
  if (findings.length === 0) {
    return (
      <div data-testid="companion-empty" className="p-3 text-xs text-slate-400">
        {t(locale, "暂无伴随发现", "No companion findings yet")}
      </div>
    );
  }

  const groups = groupCompanionByStage(findings);

  return (
    <section
      data-testid="companion-findings-panel"
      className="flex flex-col gap-3 p-1"
    >
      <header className="flex items-center gap-1.5">
        <ShieldQuestion className="size-3.5 text-[#0f766e]" aria-hidden />
        <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">
          {t(locale, "伴随发现", "Companion Findings")}
        </span>
      </header>
      {groups.map(group => (
        <div key={group.stage} data-testid={`companion-stage-${group.stage}`}>
          <div className="mb-1 text-[10px] font-black uppercase tracking-tight text-slate-400">
            {group.stage}
          </div>
          <ul className="flex flex-col gap-1.5">
            {/* warn/error 优先（R2.8） */}
            {sortBySeverity(group.findings).map(finding => (
              <FindingCard key={finding.id} finding={finding} locale={locale} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

export interface CompanionFindingsPanelProps {
  job: CompanionFindingsSource | null | undefined;
  locale: AppLocale;
}

export function CompanionFindingsPanel({
  job,
  locale,
}: CompanionFindingsPanelProps) {
  const { sorted } = useCompanionFindings(job);
  return <CompanionFindingsView findings={sorted} locale={locale} />;
}
