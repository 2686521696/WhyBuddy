/**
 * Autopilot v4 信任层 — `ChecksLedgerPanel`（QA_LEDGER 校验台账 · 问责中枢）。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 22–31
 * - requirements.md 需求 2（台账）/ 3（SP_INV）/ 4（QA_CONTENT）/ 8.7（companion_trace 交叉引用）
 *   / 13（loading/empty/error）/ 15（人是闸，非阻塞）
 *
 * 设计（design.md §Components 4）：
 * - 外层 `ChecksLedgerPanel` 把 `useChecksLedger(jobId)` 接到纯展示组件
 *   `ChecksLedgerView`，后者可被 SSR 组件测试直接以 fixture 驱动（本仓未集成
 *   `@testing-library/react`，effect-driven 异步态不在 SSR 跑）。
 * - 台账是 v4 汇聚点：schema / invariant / content_quality / companion_trace /
 *   preview_audit 五路结果都在此呈现；warn/fail 为评审信号，绝不自动拦截。
 */

import type { FC } from "react";
import { AlertTriangle, ClipboardList, RefreshCw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  applyLedgerFilters,
  groupLedgerByStage,
  selectByCheckType,
  sortWarnFailFirst,
} from "../trust";
import type {
  BlueprintChecksLedgerEntry,
  BlueprintChecksLedgerResponse,
  BlueprintCheckStatus,
  BlueprintCheckType,
  LedgerFilterState,
} from "../trust/types";
import {
  useChecksLedger,
  type ChecksLedgerStatus,
} from "../hooks/use-checks-ledger";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

const STATUS_TONE: Record<BlueprintCheckStatus, string> = {
  pass: "border-emerald-300 bg-emerald-50 text-emerald-700",
  warn: "border-amber-300 bg-amber-50 text-amber-700",
  fail: "border-rose-300 bg-rose-50 text-rose-700",
  skip: "border-slate-300 bg-slate-50 text-slate-500",
};

function statusLabel(status: BlueprintCheckStatus, locale: AppLocale): string {
  switch (status) {
    case "pass":
      return t(locale, "通过", "Pass");
    case "warn":
      return t(locale, "告警", "Warn");
    case "fail":
      return t(locale, "失败", "Fail");
    case "skip":
      return t(locale, "跳过", "Skip");
  }
}

function StatusBadge({
  status,
  count,
  locale,
}: {
  status: BlueprintCheckStatus;
  count: number;
  locale: AppLocale;
}) {
  return (
    <Badge
      variant="outline"
      data-testid={`ledger-summary-${status}`}
      className={cn(
        "rounded-full text-[10px] font-black tabular-nums",
        STATUS_TONE[status],
      )}
    >
      {statusLabel(status, locale)} {count}
    </Badge>
  );
}

function LedgerEntryRow({
  entry,
  locale,
}: {
  entry: BlueprintChecksLedgerEntry;
  locale: AppLocale;
}) {
  const isAttention = entry.status === "warn" || entry.status === "fail";
  return (
    <li
      data-testid="ledger-entry"
      data-check-type={entry.checkType}
      data-status={entry.status}
      className={cn(
        "rounded-[10px] border px-2.5 py-2",
        isAttention
          ? "border-amber-300 bg-amber-50/60"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-slate-700">
          {entry.checkName}
        </span>
        <Badge
          variant="outline"
          className={cn("rounded-full text-[9px] font-black", STATUS_TONE[entry.status])}
        >
          {statusLabel(entry.status, locale)}
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase tracking-tight text-slate-400">
        <span data-testid="ledger-entry-checktype">{entry.checkType}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{entry.validator}</span>
      </div>
      {entry.output ? (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-slate-500">
          {entry.output}
        </p>
      ) : null}
    </li>
  );
}

const FILTER_CHECK_TYPES: BlueprintCheckType[] = [
  "schema",
  "invariant",
  "content_quality",
  "companion_trace",
  "preview_audit",
];
const FILTER_STATUSES: BlueprintCheckStatus[] = ["pass", "warn", "fail", "skip"];

export interface ChecksLedgerViewProps {
  status: ChecksLedgerStatus;
  data: BlueprintChecksLedgerResponse | null;
  locale: AppLocale;
  filter?: LedgerFilterState;
  onFilterChange?: (next: LedgerFilterState) => void;
  onReload?: () => void;
}

/**
 * 纯展示组件（无 effect），SSR 组件测试以 fixture 直接驱动各状态。
 */
export const ChecksLedgerView: FC<ChecksLedgerViewProps> = ({
  status,
  data,
  locale,
  filter,
  onFilterChange,
  onReload,
}) => {
  if (status === "loading" || status === "idle") {
    return (
      <div data-testid="ledger-loading" className="p-3 text-xs text-slate-400">
        {t(locale, "正在加载校验台账…", "Loading checks ledger…")}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div data-testid="ledger-error" className="p-3 text-xs text-rose-600">
        <p className="font-bold">{t(locale, "台账加载失败", "Failed to load ledger")}</p>
        <Button
          variant="outline"
          size="sm"
          data-testid="ledger-retry"
          className="mt-2"
          onClick={onReload}
        >
          <RefreshCw className="mr-1 size-3" />
          {t(locale, "重试", "Retry")}
        </Button>
      </div>
    );
  }

  if (status === "empty" || !data) {
    return (
      <div data-testid="ledger-empty" className="p-3 text-xs text-slate-400">
        {t(locale, "校验台账未启用或暂无记录", "Checks ledger not enabled or empty")}
      </div>
    );
  }

  const filtered = applyLedgerFilters(data.entries, filter ?? {});
  const groups = groupLedgerByStage(filtered);
  const invariantEntries = sortWarnFailFirst(
    selectByCheckType(data.entries, "invariant"),
  );
  const contentEntries = sortWarnFailFirst(
    selectByCheckType(data.entries, "content_quality"),
  );
  const companionCount = selectByCheckType(data.entries, "companion_trace").length;

  return (
    <section data-testid="checks-ledger-panel" className="flex flex-col gap-3 p-1">
      {/* 摘要徽章（任务 23） */}
      <header className="flex flex-wrap items-center gap-1.5">
        <ClipboardList className="size-3.5 text-[#0f766e]" aria-hidden />
        <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">
          {t(locale, "校验台账", "Checks Ledger")}
        </span>
        <span
          data-testid="ledger-summary-total"
          className="text-[10px] font-black tabular-nums text-slate-400"
        >
          {data.summary.total}
        </span>
        <StatusBadge status="pass" count={data.summary.pass} locale={locale} />
        <StatusBadge status="warn" count={data.summary.warn} locale={locale} />
        <StatusBadge status="fail" count={data.summary.fail} locale={locale} />
        <StatusBadge status="skip" count={data.summary.skip} locale={locale} />
      </header>

      {/* 非阻塞声明（任务 30 / 需求 2.8 / 15.2） */}
      <p data-testid="ledger-nonblocking-note" className="text-[10px] text-slate-400">
        {t(
          locale,
          "以下为评审信号，由人判断，不自动拦截。",
          "Review signals for human judgement — nothing is auto-blocked.",
        )}
      </p>

      {/* 过滤栏（任务 25） */}
      <div data-testid="ledger-filter-bar" className="flex flex-wrap gap-1">
        {FILTER_CHECK_TYPES.map((ct) => (
          <button
            key={ct}
            type="button"
            data-testid={`ledger-filter-checktype-${ct}`}
            data-active={String(filter?.checkType === ct)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-bold",
              filter?.checkType === ct
                ? "border-[#0f766e] bg-[#0f766e]/10 text-[#0f766e]"
                : "border-slate-200 text-slate-500",
            )}
            onClick={() =>
              onFilterChange?.({
                ...filter,
                checkType: filter?.checkType === ct ? undefined : ct,
              })
            }
          >
            {ct}
          </button>
        ))}
        {FILTER_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            data-testid={`ledger-filter-status-${st}`}
            data-active={String(filter?.status === st)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] font-bold",
              filter?.status === st
                ? STATUS_TONE[st]
                : "border-slate-200 text-slate-500",
            )}
            onClick={() =>
              onFilterChange?.({
                ...filter,
                status: filter?.status === st ? undefined : st,
              })
            }
          >
            {statusLabel(st, locale)}
          </button>
        ))}
      </div>

      {/* 不变量守卫区 SP_INV（任务 26） */}
      {invariantEntries.length > 0 ? (
        <div data-testid="ledger-section-invariant" className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-slate-500">
            <ShieldCheck className="size-3" aria-hidden />
            {t(locale, "不变量守卫", "Invariant Guard")}
          </div>
          <ul className="flex flex-col gap-1.5">
            {invariantEntries.map((entry) => (
              <LedgerEntryRow key={entry.id} entry={entry} locale={locale} />
            ))}
          </ul>
        </div>
      ) : null}

      {/* 内容质量区 QA_CONTENT（任务 27） */}
      {contentEntries.length > 0 ? (
        <div data-testid="ledger-section-content-quality" className="flex flex-col gap-1.5">
          <div className="text-[10px] font-black uppercase tracking-tight text-slate-500">
            {t(locale, "内容质量 / EARS", "Content Quality / EARS")}
          </div>
          <ul className="flex flex-col gap-1.5">
            {contentEntries.map((entry) => (
              <LedgerEntryRow key={entry.id} entry={entry} locale={locale} />
            ))}
          </ul>
        </div>
      ) : null}

      {/* companion_trace 交叉引用（任务 28 / 需求 8.7） */}
      {companionCount > 0 ? (
        <div
          data-testid="ledger-companion-xref"
          className="flex items-center gap-1 rounded-[10px] border border-[#0f766e]/20 bg-[#0f766e]/5 px-2.5 py-1.5 text-[10px] font-semibold text-[#0f766e]"
        >
          <AlertTriangle className="size-3" aria-hidden />
          {t(
            locale,
            `伴随发现 ${companionCount} 条（见伴随面板）`,
            `${companionCount} companion finding(s) — see Companion panel`,
          )}
        </div>
      ) : null}

      {/* 全量分组列表 */}
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.stage} data-testid={`ledger-stage-${group.stage}`}>
            <div className="mb-1 text-[10px] font-black uppercase tracking-tight text-slate-400">
              {group.stage}
            </div>
            <ul className="flex flex-col gap-1.5">
              {sortWarnFailFirst(group.entries).map((entry) => (
                <LedgerEntryRow key={entry.id} entry={entry} locale={locale} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};

export interface ChecksLedgerPanelProps {
  jobId: string;
  locale: AppLocale;
}

export function ChecksLedgerPanel({ jobId, locale }: ChecksLedgerPanelProps) {
  const { status, data, reload } = useChecksLedger(jobId);
  return (
    <ChecksLedgerView
      status={status}
      data={data}
      locale={locale}
      onReload={reload}
    />
  );
}
