/**
 * Autopilot v4 信任层 — `TraceabilityMatrixPanel`（EP_MATRIX 可追溯矩阵）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 38–45
 * - requirements.md 需求 7（覆盖率环 / 五元表 / 缺口 / stale / not_generated / markdown 导出）
 *   / 13（loading/empty/error/stale 状态）
 *
 * 设计：外层 `TraceabilityMatrixPanel` 接 `useTraceabilityMatrix(jobId)` 到纯展示
 * `TraceabilityMatrixView`（SSR 组件测试以 fixture 直接驱动各状态）。导出按钮调用
 * `fetchTraceabilityMatrix(jobId,"markdown")` 触发浏览器下载。
 */

import type { FC } from "react";
import { Download, GitCompareArrows, ListTree, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchTraceabilityMatrix } from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  useTraceabilityMatrix,
  type TraceabilityMatrixStatus,
} from "../hooks/use-traceability-matrix";
import type { TraceabilityMatrix } from "../trust/types";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function CoverageRing({
  percent,
  locale,
}: {
  percent: number;
  locale: AppLocale;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const tone =
    clamped >= 80
      ? "text-emerald-600"
      : clamped >= 50
        ? "text-amber-600"
        : "text-rose-600";
  return (
    <div
      data-testid="matrix-coverage-ring"
      data-coverage-percent={clamped}
      className="flex items-center gap-2"
    >
      <span className={cn("text-2xl font-black tabular-nums", tone)}>
        {clamped}%
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-tight text-slate-400">
        {t(locale, "覆盖率", "Coverage")}
      </span>
    </div>
  );
}

export interface TraceabilityMatrixViewProps {
  status: TraceabilityMatrixStatus;
  matrix: TraceabilityMatrix | null;
  locale: AppLocale;
  onReload?: () => void;
  onExportMarkdown?: () => void;
}

export const TraceabilityMatrixView: FC<TraceabilityMatrixViewProps> = ({
  status,
  matrix,
  locale,
  onReload,
  onExportMarkdown,
}) => {
  if (status === "idle" || status === "loading") {
    return (
      <div data-testid="matrix-loading" className="p-3 text-xs text-slate-400">
        {t(locale, "正在加载追溯矩阵…", "Loading traceability matrix…")}
      </div>
    );
  }

  if (status === "not_generated") {
    return (
      <div
        data-testid="matrix-not-generated"
        className="p-3 text-xs text-slate-400"
      >
        {t(
          locale,
          "追溯矩阵尚未生成（需先完成规格文档）。",
          "Traceability matrix not generated yet (finish spec documents first)."
        )}
      </div>
    );
  }

  if (status === "error" || !matrix) {
    return (
      <div data-testid="matrix-error" className="p-3 text-xs text-rose-600">
        <p className="font-bold">
          {t(locale, "矩阵加载失败", "Failed to load matrix")}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="matrix-retry"
          className="mt-2"
          onClick={onReload}
        >
          <RefreshCw className="mr-1 size-3" />
          {t(locale, "重试", "Retry")}
        </Button>
      </div>
    );
  }

  const { coverage, entries } = matrix;

  return (
    <section
      data-testid="traceability-matrix-panel"
      className="flex flex-col gap-3 p-1"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ListTree className="size-3.5 text-[#0f766e]" aria-hidden />
          <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">
            {t(locale, "可追溯矩阵", "Traceability Matrix")}
          </span>
          {status === "stale" ? (
            <span
              data-testid="matrix-stale-badge"
              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700"
            >
              {t(locale, "已失效", "Stale")}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="matrix-export-markdown"
          onClick={onExportMarkdown}
        >
          <Download className="mr-1 size-3" />
          {t(locale, "导出 MD", "Export MD")}
        </Button>
      </header>

      {/* 覆盖率环 + 维度计数（任务 39） */}
      <div className="flex flex-wrap items-center gap-3">
        <CoverageRing percent={coverage.coveragePercent} locale={locale} />
        <dl className="flex flex-wrap gap-2 text-[10px] font-semibold text-slate-500">
          <span data-testid="matrix-dim-total">
            {t(locale, "需求", "Req")} {coverage.totalRequirements}
          </span>
          <span data-testid="matrix-dim-design">
            设计 {coverage.coveredByDesign}
          </span>
          <span data-testid="matrix-dim-tasks">
            任务 {coverage.coveredByTasks}
          </span>
          <span data-testid="matrix-dim-evidence">
            证据 {coverage.coveredByEvidence}
          </span>
          <span data-testid="matrix-dim-tests">
            用例 {coverage.coveredByTests}
          </span>
        </dl>
      </div>

      {/* 缺口列表（任务 41） */}
      {coverage.gaps.length > 0 ? (
        <div
          data-testid="matrix-gaps"
          className="rounded-[10px] border border-amber-300 bg-amber-50/60 px-2.5 py-2"
        >
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-amber-700">
            <GitCompareArrows className="size-3" aria-hidden />
            {t(
              locale,
              `缺口 ${coverage.gaps.length}`,
              `${coverage.gaps.length} gap(s)`
            )}
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {coverage.gaps.map(gap => (
              <li
                key={gap.requirementId}
                data-testid="matrix-gap-row"
                className="text-[11px] text-amber-800"
              >
                <span className="font-bold">{gap.requirementId}</span>{" "}
                {gap.requirementTitle} —{" "}
                <span className="font-semibold">
                  {gap.missingLinks.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 五元表（任务 40） */}
      <div data-testid="matrix-table" className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-1.5 py-1">
                {t(locale, "需求", "Requirement")}
              </th>
              <th className="px-1.5 py-1">{t(locale, "设计", "Design")}</th>
              <th className="px-1.5 py-1">{t(locale, "任务", "Tasks")}</th>
              <th className="px-1.5 py-1">{t(locale, "证据", "Evidence")}</th>
              <th className="px-1.5 py-1">{t(locale, "用例", "Tests")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr
                key={entry.requirementId}
                data-testid="matrix-row"
                data-requirement-id={entry.requirementId}
                className="border-t border-slate-100 align-top"
              >
                <td className="px-1.5 py-1 font-bold text-slate-700">
                  {entry.requirementId} {entry.requirementTitle}
                </td>
                <td className="px-1.5 py-1 text-slate-500">
                  {entry.designSections.length}
                </td>
                <td className="px-1.5 py-1 text-slate-500">
                  {entry.taskIds.length}
                </td>
                <td className="px-1.5 py-1 text-slate-500">
                  {entry.evidenceSources.length}
                </td>
                <td className="px-1.5 py-1 text-slate-500">
                  {entry.testCases.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export interface TraceabilityMatrixPanelProps {
  jobId: string;
  locale: AppLocale;
}

function triggerMarkdownDownload(filename: string, markdown: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function TraceabilityMatrixPanel({
  jobId,
  locale,
}: TraceabilityMatrixPanelProps) {
  const { status, matrix, reload } = useTraceabilityMatrix(jobId);

  const handleExport = async () => {
    const result = await fetchTraceabilityMatrix(jobId, "markdown");
    if (result.ok && result.kind === "markdown") {
      triggerMarkdownDownload(`traceability-matrix-${jobId}.md`, result.data);
    }
  };

  return (
    <TraceabilityMatrixView
      status={status}
      matrix={matrix}
      locale={locale}
      onReload={reload}
      onExportMarkdown={() => void handleExport()}
    />
  );
}
