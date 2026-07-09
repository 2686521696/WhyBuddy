/**
 * Autopilot v4 信任层 — 加厚交付包 `HandoffTrustBundle`（EP_HAND）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 56–59
 * - requirements.md 需求 9（交付包加厚：校验台账摘要 + 可追溯矩阵 + 带来源标注的
 *   视觉预览 + 未决项；既有 spec md/zip 导出保持不变；缺数据时优雅省略）
 * - design.md §8 Thickened handoff bundle
 *
 * 设计：作为**附加** section 挂在 `EngineeringHandoffPanel` 顶部，不改动既有
 * 落地计划 / 工程运行 / spec 导出逻辑。纯展示 `HandoffTrustBundleView` 由
 * 连接层 `HandoffTrustBundle` 接 `useChecksLedger` + `useTraceabilityMatrix`，
 * SSR 组件测试以 fixture 直接驱动各状态（含"无信任产物 → 优雅省略"）。
 */

import type { FC } from "react";
import { ClipboardCheck, Download, GitCompare, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchTraceabilityMatrix } from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  useChecksLedger,
  type ChecksLedgerStatus,
} from "../../hooks/use-checks-ledger";
import {
  useTraceabilityMatrix,
  type TraceabilityMatrixStatus,
} from "../../hooks/use-traceability-matrix";
import type {
  BlueprintChecksLedgerResponse,
  TraceabilityMatrix,
} from "../../trust/types";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/** 单条未决项（ledger warn/fail 或 matrix gap）。 */
export interface HandoffOpenItem {
  kind: "ledger" | "gap";
  id: string;
  label: string;
  detail: string;
}

/**
 * 任务 57：未决项 = 台账 warn/fail 条目 + 矩阵缺口。纯函数，缺数据时返回空数组。
 */
export function collectHandoffOpenItems(input: {
  ledger?: BlueprintChecksLedgerResponse | null;
  matrix?: TraceabilityMatrix | null;
}): HandoffOpenItem[] {
  const items: HandoffOpenItem[] = [];
  const entries = input.ledger?.entries ?? [];
  for (const entry of entries) {
    if (entry.status === "warn" || entry.status === "fail") {
      items.push({
        kind: "ledger",
        id: entry.id,
        label: `${entry.checkName} · ${entry.status}`,
        detail: entry.output ?? entry.checkType,
      });
    }
  }
  const gaps = input.matrix?.coverage?.gaps ?? [];
  for (const gap of gaps) {
    items.push({
      kind: "gap",
      id: gap.requirementId,
      label: `${gap.requirementId} ${gap.requirementTitle}`,
      detail: gap.missingLinks.join(", "),
    });
  }
  return items;
}

export interface HandoffTrustBundleViewProps {
  ledgerStatus: ChecksLedgerStatus;
  ledger: BlueprintChecksLedgerResponse | null;
  matrixStatus: TraceabilityMatrixStatus;
  matrix: TraceabilityMatrix | null;
  locale: AppLocale;
  onExportMarkdown?: () => void;
}

export const HandoffTrustBundleView: FC<HandoffTrustBundleViewProps> = ({
  ledgerStatus,
  ledger,
  matrixStatus,
  matrix,
  locale,
  onExportMarkdown,
}) => {
  const hasLedger =
    (ledgerStatus === "ready" || ledgerStatus === "empty") && ledger !== null;
  const hasMatrix =
    (matrixStatus === "ready" || matrixStatus === "stale") && matrix !== null;
  const openItems = collectHandoffOpenItems({ ledger, matrix });

  // 任务 58：缺信任产物时优雅省略（不渲染整块，但绝不报错 / 不影响既有导出）。
  if (!hasLedger && !hasMatrix) {
    return (
      <section
        data-testid="handoff-trust-bundle-omitted"
        className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-400"
      >
        {t(
          locale,
          "信任层产物（校验台账 / 可追溯矩阵）尚未就绪，将在生成后并入交付包。",
          "Trust artifacts (checks ledger / traceability matrix) are not ready yet; they will join the bundle once generated."
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="handoff-trust-bundle"
      className="flex flex-col gap-3 rounded-[12px] border border-slate-200 bg-white px-3 py-3"
    >
      <header className="flex items-center gap-1.5">
        <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">
          {t(locale, "信任层交付包", "Trust Bundle")}
        </span>
        <span className="text-[9px] font-semibold text-slate-400">
          {t(locale, "评审信号，人是闸", "review signals · human is the gate")}
        </span>
      </header>

      {/* 56.1 校验台账摘要 */}
      {hasLedger ? (
        <div
          data-testid="handoff-ledger-summary"
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-slate-400">
            <ClipboardCheck className="size-3" aria-hidden />
            {t(locale, "校验台账摘要", "Checks ledger summary")}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span
              data-testid="handoff-ledger-total"
              className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600"
            >
              {t(locale, "总计", "Total")} {ledger!.summary.total}
            </span>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
              pass {ledger!.summary.pass}
            </span>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
              warn {ledger!.summary.warn}
            </span>
            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
              fail {ledger!.summary.fail}
            </span>
            <span className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-500">
              skip {ledger!.summary.skip}
            </span>
          </div>
        </div>
      ) : null}

      {/* 56.2 可追溯矩阵摘要 + markdown 导出 */}
      {hasMatrix ? (
        <div
          data-testid="handoff-matrix-summary"
          className="flex flex-col gap-1"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-slate-400">
              <GitCompare className="size-3" aria-hidden />
              {t(locale, "可追溯矩阵", "Traceability matrix")}
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid="handoff-matrix-export"
              onClick={onExportMarkdown}
            >
              <Download className="mr-1 size-3" />
              {t(locale, "导出 MD", "Export MD")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
            <span data-testid="handoff-matrix-coverage">
              {t(locale, "覆盖率", "Coverage")}{" "}
              {Math.round(matrix!.coverage.coveragePercent)}%
            </span>
            <span>
              {t(locale, "需求", "Req")} {matrix!.coverage.totalRequirements}
            </span>
            <span>
              {t(locale, "缺口", "Gaps")} {matrix!.coverage.gaps.length}
            </span>
          </div>
        </div>
      ) : null}

      {/* 57 未决项（ledger warn/fail + matrix gaps） */}
      <div data-testid="handoff-open-items" className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-slate-400">
          <ListChecks className="size-3" aria-hidden />
          {t(
            locale,
            `未决项 ${openItems.length}`,
            `Open items ${openItems.length}`
          )}
        </div>
        {openItems.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {openItems.map(item => (
              <li
                key={`${item.kind}-${item.id}`}
                data-testid="handoff-open-item"
                data-kind={item.kind}
                className={cn(
                  "rounded-[8px] border px-2 py-1 text-[10px]",
                  item.kind === "gap"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                )}
              >
                <span className="font-bold">{item.label}</span>
                {item.detail ? (
                  <span className="opacity-70"> — {item.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div
            data-testid="handoff-open-items-empty"
            className="text-[10px] text-slate-400"
          >
            {t(locale, "无未决项", "No open items")}
          </div>
        )}
      </div>
    </section>
  );
};

export interface HandoffTrustBundleProps {
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

export function HandoffTrustBundle({ jobId, locale }: HandoffTrustBundleProps) {
  const { status: ledgerStatus, data: ledger } = useChecksLedger(jobId);
  const { status: matrixStatus, matrix } = useTraceabilityMatrix(jobId);

  const handleExport = async () => {
    const result = await fetchTraceabilityMatrix(jobId, "markdown");
    if (result.ok && result.kind === "markdown") {
      triggerMarkdownDownload(`traceability-matrix-${jobId}.md`, result.data);
    }
  };

  return (
    <HandoffTrustBundleView
      ledgerStatus={ledgerStatus}
      ledger={ledger}
      matrixStatus={matrixStatus}
      matrix={matrix}
      locale={locale}
      onExportMarkdown={() => void handleExport()}
    />
  );
}

export default HandoffTrustBundle;
