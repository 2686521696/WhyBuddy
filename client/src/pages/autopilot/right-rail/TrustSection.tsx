/**
 * Autopilot v4 信任层 — 跨阶段 "Trust" section（`TrustSection`）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 52–55（rail 集成）
 * - design.md §9 Rail integration：把 ChecksLedger / TraceabilityMatrix /
 *   Companion 作为「跨阶段」的 tab 组挂进右栏，而**不**新增
 *   `AutopilotRailSubStage` 值（保持 `resolve-rail-sub-stage.ts` 8-substage
 *   契约与其纯函数测试不变）。
 * - requirements.md 需求 10.1 / 10.2 / 13.3
 *
 * 纪律：
 * - 只读、附加；不写 realtime store；不改后端契约。
 * - 可用性 gating：台账 / 伴随发现在 spec_tree 存在后可用；可追溯矩阵在
 *   spec docs 存在后可用；在此之前渲染各自的空态（"未启用"由面板内部状态承载）。
 * - 每个面板包在既有 `CardErrorBoundary` 内，渲染失败只塌缩单卡，不连累右栏。
 */

import { useState } from "react";
import { ClipboardCheck, GitCompare, ShieldQuestion } from "lucide-react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { CardErrorBoundary } from "@/components/tasks/CardErrorBoundary";
import {
  ChecksLedgerPanel,
  CompanionFindingsPanel,
  TraceabilityMatrixPanel,
} from "./panels";
import type { CompanionFindingsSource } from "./trust/companion";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

export type TrustTab = "ledger" | "matrix" | "companion";

export interface TrustSectionProps {
  jobId: string;
  /** 伴随发现来源（job 负载）；可空。 */
  job: CompanionFindingsSource | null | undefined;
  locale: AppLocale;
  /** spec_tree 是否已存在（台账 / 伴随发现可用性）。 */
  hasSpecTree: boolean;
  /** spec docs 是否已存在（可追溯矩阵可用性）。 */
  hasSpecDocs: boolean;
  /** 初始 tab（测试可注入；默认 ledger）。 */
  initialTab?: TrustTab;
}

interface TabDef {
  id: TrustTab;
  zh: string;
  en: string;
  icon: typeof ClipboardCheck;
  /** 该 tab 是否可用（由可用性 gating 计算）。 */
  available: boolean;
}

export function TrustSection({
  jobId,
  job,
  locale,
  hasSpecTree,
  hasSpecDocs,
  initialTab = "ledger",
}: TrustSectionProps) {
  const [activeTab, setActiveTab] = useState<TrustTab>(initialTab);

  const tabs: TabDef[] = [
    {
      id: "ledger",
      zh: "校验台账",
      en: "Checks Ledger",
      icon: ClipboardCheck,
      available: hasSpecTree,
    },
    {
      id: "matrix",
      zh: "可追溯矩阵",
      en: "Traceability",
      icon: GitCompare,
      available: hasSpecDocs,
    },
    {
      id: "companion",
      zh: "伴随发现",
      en: "Companion",
      icon: ShieldQuestion,
      available: hasSpecTree,
    },
  ];

  return (
    <section
      data-testid="autopilot-trust-section"
      className="mt-2 flex flex-shrink-0 flex-col gap-2 border-t border-slate-200/70 px-1 pt-2"
    >
      <header className="flex items-center gap-1.5">
        <ShieldQuestion className="size-3.5 text-[#0f766e]" aria-hidden />
        <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">
          {t(locale, "信任层", "Trust")}
        </span>
        <span className="text-[9px] font-semibold text-slate-400">
          {t(locale, "评审信号，人是闸", "review signals · human is the gate")}
        </span>
      </header>

      {/* 跨阶段 tab 组（非线性 sub-stage） */}
      <div
        role="tablist"
        aria-label={t(locale, "信任层视图", "Trust views")}
        data-testid="trust-tablist"
        className="flex flex-wrap gap-1"
      >
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={!tab.available}
              data-testid={`trust-tab-${tab.id}`}
              data-available={tab.available ? "true" : "false"}
              data-active={isActive ? "true" : "false"}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition",
                isActive
                  ? "border-[#0f766e] bg-[#0f766e]/10 text-[#0f766e]"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                !tab.available && "opacity-50"
              )}
            >
              <Icon className="size-3" aria-hidden />
              {t(locale, tab.zh, tab.en)}
            </button>
          );
        })}
      </div>

      <div data-testid={`trust-panel-${activeTab}`} className="min-h-0">
        {activeTab === "ledger" ? (
          hasSpecTree ? (
            <CardErrorBoundary locale={locale} cardName="ChecksLedger">
              <ChecksLedgerPanel jobId={jobId} locale={locale} />
            </CardErrorBoundary>
          ) : (
            <TrustGatedEmpty
              testId="trust-ledger-gated"
              locale={locale}
              zh="校验台账将在规格树生成后可用"
              en="Checks ledger becomes available after the spec tree is generated"
            />
          )
        ) : null}

        {activeTab === "matrix" ? (
          hasSpecDocs ? (
            <CardErrorBoundary locale={locale} cardName="TraceabilityMatrix">
              <TraceabilityMatrixPanel jobId={jobId} locale={locale} />
            </CardErrorBoundary>
          ) : (
            <TrustGatedEmpty
              testId="trust-matrix-gated"
              locale={locale}
              zh="可追溯矩阵将在规格文档生成后可用"
              en="Traceability matrix becomes available after spec documents are generated"
            />
          )
        ) : null}

        {activeTab === "companion" ? (
          hasSpecTree ? (
            <CardErrorBoundary locale={locale} cardName="CompanionFindings">
              <CompanionFindingsPanel job={job} locale={locale} />
            </CardErrorBoundary>
          ) : (
            <TrustGatedEmpty
              testId="trust-companion-gated"
              locale={locale}
              zh="伴随发现将在规格树生成后可用"
              en="Companion findings become available after the spec tree is generated"
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function TrustGatedEmpty({
  testId,
  locale,
  zh,
  en,
}: {
  testId: string;
  locale: AppLocale;
  zh: string;
  en: string;
}) {
  return (
    <div data-testid={testId} className="p-3 text-xs text-slate-400">
      {t(locale, zh, en)}
    </div>
  );
}

export default TrustSection;
