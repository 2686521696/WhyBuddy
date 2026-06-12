import React from "react";
import type { Artifact } from "@shared/blueprint/v5-reasoning-state";
import { parseReportSections } from "./parse-report-sections";
import { autopilotTheme } from "./autopilot-theme";

export function WhyBuddyReportReader({
  report,
  onEvidenceRefClick,
  onClose,
}: {
  report: Artifact;
  onEvidenceRefClick?: (artifactId: string) => void;
  onClose?: () => void;
}) {
  const sections = parseReportSections(report);

  return (
    <div
      className="flex h-full flex-col bg-white"
      data-testid="whybuddy-report-reader"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {report.title || "可行性报告"}
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500">
            report.write · {sections.length} 段
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {sections.map((sec) => (
          <section
            key={sec.id}
            className="mb-4 border-b border-slate-100 pb-4 last:border-0"
            data-testid={`report-section-${sec.id}`}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {sec.label}
            </h3>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-700">
              {sec.body.trim() || "（空）"}
            </pre>
            {sec.evidenceRefs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sec.evidenceRefs.map((refId) => (
                  <button
                    key={refId}
                    type="button"
                    data-testid={`evidence-ref-${refId}`}
                    onClick={() => onEvidenceRefClick?.(refId)}
                    className={autopilotTheme.hintChip}
                  >
                    证据 {refId}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}