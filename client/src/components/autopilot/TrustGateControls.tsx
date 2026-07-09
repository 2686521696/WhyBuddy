/**
 * Autopilot v4 信任层 — RT_GATE / ESC / QA_MERGE 三个治理控件。
 *
 * 对应 spec：`.kiro/specs/autopilot-v4-frontend-alignment/`
 * - tasks.md 任务 60–63；design.md §Components 10；requirements.md 需求 11。
 *
 * 纪律（v4「人是闸」）：
 * - RT_GATE：路线确认闸——在既有 `selectBlueprintRoute` 之上做**表现层强调**，
 *   不替代其确认语义，不自动放行。
 * - ESC：中止 / 转人工——接到既有 replan / escalation；不可用时给出**明确标注的
 *   信息占位**，绝不伪造成功。
 * - QA_MERGE：只读合并门状态——由台账 `test` + `content_quality` 结果**派生**，
 *   框定为「由人判定」，从不自动拦截 / 自动合并。
 */

import type { FC } from "react";
import { AlertTriangle, GitMerge, ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type {
  BlueprintCheckStatus,
  BlueprintChecksLedgerEntry,
} from "@/pages/autopilot/right-rail/trust/types";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

// ── QA_MERGE 纯派生 ──────────────────────────────────────────────────────────

export interface MergeGateStatus {
  /** `test` 类校验的综合状态。 */
  testStatus: BlueprintCheckStatus | "none";
  /** `content_quality` 类校验的综合状态。 */
  contentStatus: BlueprintCheckStatus | "none";
  /** 综合（fail > warn > pass > none）；仅供人判定参考，不自动拦截。 */
  overall: BlueprintCheckStatus | "none";
}

const STATUS_PRIORITY: Record<BlueprintCheckStatus | "none", number> = {
  fail: 3,
  warn: 2,
  pass: 1,
  skip: 0,
  none: -1,
};

function combineStatus(
  current: BlueprintCheckStatus | "none",
  next: BlueprintCheckStatus,
): BlueprintCheckStatus | "none" {
  return STATUS_PRIORITY[next] > STATUS_PRIORITY[current] ? next : current;
}

/**
 * 任务 62：从台账派生只读合并门状态。纯函数、不抛错、缺数据返回 `none`。
 */
export function deriveMergeGateStatus(
  entries: readonly BlueprintChecksLedgerEntry[] | null | undefined,
): MergeGateStatus {
  let testStatus: BlueprintCheckStatus | "none" = "none";
  let contentStatus: BlueprintCheckStatus | "none" = "none";
  for (const entry of entries ?? []) {
    if (!entry) continue;
    if (entry.checkType === "test") {
      testStatus = combineStatus(testStatus, entry.status);
    } else if (entry.checkType === "content_quality") {
      contentStatus = combineStatus(contentStatus, entry.status);
    }
  }
  const overall =
    STATUS_PRIORITY[testStatus] >= STATUS_PRIORITY[contentStatus]
      ? testStatus
      : contentStatus;
  return { testStatus, contentStatus, overall };
}

// ── RT_GATE：路线确认闸（表现层强调） ────────────────────────────────────────

export interface RouteConfirmGateProps {
  locale: AppLocale;
  /** 是否已选择路线（来自既有 selectBlueprintRoute 状态）。 */
  routeSelected: boolean;
  /** 确认放行回调（接既有 selectBlueprintRoute 确认语义）。 */
  onConfirm?: () => void;
  disabled?: boolean;
}

export const RouteConfirmGate: FC<RouteConfirmGateProps> = ({
  locale,
  routeSelected,
  onConfirm,
  disabled,
}) => {
  return (
    <div
      data-testid="rt-gate"
      data-route-selected={routeSelected ? "true" : "false"}
      className="flex flex-col gap-1 rounded-[10px] border border-indigo-200 bg-indigo-50/60 px-2.5 py-2"
    >
      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-indigo-700">
        <ShieldCheck className="size-3" aria-hidden />
        {t(locale, "路线确认闸", "Route confirm gate")}
      </div>
      <p className="text-[10px] text-indigo-900/70">
        {routeSelected
          ? t(locale, "已选择路线，确认后进入规格生成。", "Route selected; confirm to proceed to spec generation.")
          : t(locale, "请先选择一条路线。", "Select a route first.")}
      </p>
      <Button
        size="sm"
        variant="outline"
        data-testid="rt-gate-confirm"
        disabled={!routeSelected || disabled}
        onClick={onConfirm}
        className="self-start"
      >
        {t(locale, "确认路线", "Confirm route")}
      </Button>
    </div>
  );
};

// ── ESC：中止 / 转人工 ───────────────────────────────────────────────────────

export interface AbortEscalateControlProps {
  locale: AppLocale;
  /** 中止 / 转人工回调；未提供时进入信息占位（不伪造成功）。 */
  onEscalate?: () => void;
}

export const AbortEscalateControl: FC<AbortEscalateControlProps> = ({
  locale,
  onEscalate,
}) => {
  const available = typeof onEscalate === "function";
  return (
    <div
      data-testid="esc-control"
      data-available={available ? "true" : "false"}
      className="flex flex-col gap-1 rounded-[10px] border border-rose-200 bg-rose-50/60 px-2.5 py-2"
    >
      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-rose-700">
        <ShieldAlert className="size-3" aria-hidden />
        {t(locale, "中止 / 转人工", "Abort / Escalate")}
      </div>
      {available ? (
        <Button
          size="sm"
          variant="outline"
          data-testid="esc-action"
          onClick={onEscalate}
          className="self-start"
        >
          {t(locale, "中止并转人工", "Abort & escalate")}
        </Button>
      ) : (
        <p data-testid="esc-placeholder" className="text-[10px] text-rose-900/70">
          {t(
            locale,
            "当前阶段暂不支持中止 / 转人工（信息占位，未触发任何动作）。",
            "Abort / escalate is unavailable at this stage (informational only; no action taken).",
          )}
        </p>
      )}
    </div>
  );
};

// ── QA_MERGE：只读合并门状态 ─────────────────────────────────────────────────

export interface MergeGateStatusViewProps {
  locale: AppLocale;
  status: MergeGateStatus;
}

const MERGE_TONE: Record<BlueprintCheckStatus | "none", string> = {
  fail: "border-rose-300 bg-rose-50 text-rose-700",
  warn: "border-amber-300 bg-amber-50 text-amber-700",
  pass: "border-emerald-300 bg-emerald-50 text-emerald-700",
  skip: "border-slate-300 bg-slate-50 text-slate-500",
  none: "border-slate-200 bg-slate-50 text-slate-400",
};

export const MergeGateStatusView: FC<MergeGateStatusViewProps> = ({
  locale,
  status,
}) => {
  return (
    <div
      data-testid="qa-merge"
      data-overall={status.overall}
      className={cn(
        "flex flex-col gap-1 rounded-[10px] border px-2.5 py-2",
        MERGE_TONE[status.overall],
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-tight">
        <GitMerge className="size-3" aria-hidden />
        {t(locale, "合并门（人判定）", "Merge gate (human-judged)")}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
        <span data-testid="qa-merge-test">
          {t(locale, "测试", "Tests")}: {status.testStatus}
        </span>
        <span data-testid="qa-merge-content">
          {t(locale, "内容质量", "Content")}: {status.contentStatus}
        </span>
      </div>
      <p className="flex items-center gap-1 text-[9px] opacity-80">
        <AlertTriangle className="size-2.5" aria-hidden />
        {t(
          locale,
          "评审信号，不自动拦截 / 不自动合并。",
          "Review signal; never auto-blocks or auto-merges.",
        )}
      </p>
    </div>
  );
};
