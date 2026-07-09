/**
 * Autopilot 驾驶舱右栏收敛 — `ArtifactMemoryPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.8（`ArtifactMemoryPanel` 只接受 `{ jobId, locale }` +
 *   面板私有字段 `initialEntries / initialReplays / initialFeedback`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::ArtifactMemoryWorkbenchPanel`
 * （~行 1815–2638）逐字符搬运函数体，并按 design.md「面板抽离总表」第 8 行
 * 把组件名从 `ArtifactMemoryWorkbenchPanel` 更名为 `ArtifactMemoryPanel`
 * （对齐 `AutopilotRailSubStage === "artifact_memory"` 契约）。
 *
 * 调整点：
 * 1. 组件更名为 `ArtifactMemoryPanel`
 * 2. 签名切换到 `ArtifactMemoryPanelProps = Pick<AutopilotRightRailProps, "jobId" | "locale">`
 *    + 面板私有字段 `initialEntries / initialReplays / initialFeedback`
 * 3. 必要的辅助函数与组件（`panelText` / `blueprintCopy` / `formatGeneratedAt` /
 *    `formatEffectPreviewDate` / `artifactTokenLabel` / `SummaryTile` /
 *    `RouteMetric` / `ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS` /
 *    `ARTIFACT_FEEDBACK_STATUS_OPTIONS`）同步复制到本文件，保持 canonical
 *    panel 的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo / useState / useEffect / useCallback` 语义、
 *   JSX 结构、className 与 data-testid 均保持逐字符一致
 * - 辅助函数 `blueprintCopy / panelText / formatGeneratedAt / formatEffectPreviewDate /
 *   artifactTokenLabel` 在原实现里通过 `useAppStore.getState().locale` 读取 locale；
 *   canonical panel 禁止 import `@/lib/store`（需求 2.9 / 8.2），因此改为接收
 *   `locale: AppLocale` 参数，`locale` 由 `AutopilotRightRailProps.locale` /
 *   `BlueprintProgressPanel` 组合时注入。输出行为等价。
 * - `ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS` 与 `ARTIFACT_FEEDBACK_STATUS_OPTIONS`
 *   的 label 在原实现里为中文字面量，保持逐字符一致（未做 locale 化，与原行为等价）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import {
  CheckCircle2,
  Clipboard,
  GitBranch,
  PlayCircle,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApiRequestError } from "@/lib/api-client";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  diffBlueprintArtifacts,
  fetchBlueprintArtifactLedger,
  fetchBlueprintArtifactReplays,
  recordBlueprintArtifactFeedback,
  replayBlueprintArtifact,
  type BlueprintArtifactDiff,
  type BlueprintArtifactFeedback,
  type BlueprintArtifactLedgerEntry,
  type BlueprintArtifactReplay,
} from "@/lib/blueprint-api";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 8 行：`Pick<AutopilotRightRailProps, "jobId" | "locale">`。
 *
 * 本面板额外接受 canonical-panel 私有字段：
 * - `initialEntries`：对应原 local function 的 `initialEntries` 参数
 * - `initialReplays`：对应原 local function 的 `initialReplays` 参数
 * - `initialFeedback`：对应原 local function 的 `initialFeedback` 参数
 *
 * `<AutopilotRightRail>` 在 fabric stage 调用本面板时默认不传这组字段，
 * 由 `BlueprintProgressPanel` 组合时注入。
 */
export type ArtifactMemoryPanelProps = Pick<
  AutopilotRightRailProps,
  "jobId" | "locale"
> & {
  initialEntries?: BlueprintArtifactLedgerEntry[];
  initialReplays?: BlueprintArtifactReplay[];
  initialFeedback?: BlueprintArtifactFeedback[];
};

// region Helpers: locale-aware copy 工具
function blueprintCopy(value: string | undefined, locale: AppLocale): string {
  return translateBlueprintCopy(value, locale);
}

function panelText(zh: string, en: string, locale: AppLocale): string {
  return locale === "zh-CN" ? zh : en;
}

function formatGeneratedAt(value: string, locale: AppLocale): string {
  if (!value) return locale === "zh-CN" ? "待同步" : "Pending sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEffectPreviewDate(
  value: string | undefined,
  locale: AppLocale
): string {
  if (!value) return locale === "zh-CN" ? "预览草稿" : "Preview draft";
  return formatGeneratedAt(value, locale);
}

function artifactTokenLabel(
  value: string | undefined,
  fallback: string,
  locale: AppLocale
): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return translateBlueprintCopy(fallback, locale);
  const translated = translateBlueprintCopy(normalized, locale);
  if (translated !== normalized) return translated;

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
// endregion

// region Local components: SummaryTile / RouteMetric
function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-normal text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-500">
        {detail}
      </div>
    </div>
  );
}

function RouteMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-xs font-black text-slate-700">{value}</div>
    </div>
  );
}
// endregion

// region Feedback options
const ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS = [
  { id: "positive", label: "正向" },
  { id: "neutral", label: "中性" },
  { id: "negative", label: "负向" },
  { id: "mixed", label: "混合" },
];

const ARTIFACT_FEEDBACK_STATUS_OPTIONS = [
  { id: "verified", label: "已验证" },
  { id: "needs_backfill", label: "待回填" },
  { id: "blocked", label: "阻塞" },
  { id: "recorded", label: "已记录" },
];
// endregion

/**
 * `ArtifactMemoryPanel` —— 对应 `AutopilotRailSubStage === "artifact_memory"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::ArtifactMemoryWorkbenchPanel`，
 * 组件更名为 `ArtifactMemoryPanel`，并把内部辅助函数
 * `panelText / blueprintCopy / formatGeneratedAt / formatEffectPreviewDate /
 * artifactTokenLabel` 从「读 store.locale」改为「接收 props.locale」，以满足需求 2.9
 * 与 8.2（canonical panel 禁止 import `@/lib/store`）。
 */
export const ArtifactMemoryPanel: FC<ArtifactMemoryPanelProps> = ({
  jobId,
  locale,
  initialEntries,
  initialReplays,
  initialFeedback,
}) => {
  return (
    <ArtifactMemoryPanelInner
      jobId={jobId}
      initialEntries={initialEntries}
      initialReplays={initialReplays}
      initialFeedback={initialFeedback}
      locale={locale}
    />
  );
};

function ArtifactMemoryPanelInner({
  jobId,
  initialEntries,
  initialReplays,
  initialFeedback,
  locale,
}: {
  jobId?: string | null;
  initialEntries?: BlueprintArtifactLedgerEntry[];
  initialReplays?: BlueprintArtifactReplay[];
  initialFeedback?: BlueprintArtifactFeedback[];
  locale: AppLocale;
}) {
  const [entries, setEntries] = useState<BlueprintArtifactLedgerEntry[]>(
    initialEntries ?? []
  );
  const [replays, setReplays] = useState<BlueprintArtifactReplay[]>(
    initialReplays ?? []
  );
  const [feedback, setFeedback] = useState<BlueprintArtifactFeedback[]>(
    initialFeedback ?? []
  );
  const [selectedEntryId, setSelectedEntryId] = useState(
    initialEntries?.[0]?.id ?? ""
  );
  const [activeReplayId, setActiveReplayId] = useState(
    initialReplays?.[0]?.id ?? ""
  );
  const [leftEntryId, setLeftEntryId] = useState(initialEntries?.[0]?.id ?? "");
  const [rightEntryId, setRightEntryId] = useState(
    initialEntries?.[1]?.id ?? initialEntries?.[0]?.id ?? ""
  );
  const [diff, setDiff] = useState<BlueprintArtifactDiff | null>(null);
  const [feedbackEntryId, setFeedbackEntryId] = useState(
    initialEntries?.[0]?.id ?? ""
  );
  const [feedbackSentiment, setFeedbackSentiment] = useState("positive");
  const [feedbackStatus, setFeedbackStatus] = useState("verified");
  const [feedbackSummary, setFeedbackSummary] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [loadingReplays, setLoadingReplays] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [recordingFeedback, setRecordingFeedback] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const publishEntries = useCallback(
    (nextEntries: BlueprintArtifactLedgerEntry[]) => {
      const firstEntryId = nextEntries[0]?.id ?? "";
      const secondEntryId = nextEntries[1]?.id ?? firstEntryId;

      setEntries(nextEntries);
      setSelectedEntryId(current =>
        nextEntries.some(entry => entry.id === current) ? current : firstEntryId
      );
      setFeedbackEntryId(current =>
        nextEntries.some(entry => entry.id === current) ? current : firstEntryId
      );
      setLeftEntryId(current =>
        nextEntries.some(entry => entry.id === current) ? current : firstEntryId
      );
      setRightEntryId(current =>
        nextEntries.some(entry => entry.id === current)
          ? current
          : secondEntryId
      );
    },
    []
  );

  const publishReplays = useCallback(
    (nextReplays: BlueprintArtifactReplay[]) => {
      setReplays(nextReplays);
      setActiveReplayId(current =>
        nextReplays.some(replay => replay.id === current)
          ? current
          : (nextReplays[0]?.id ?? "")
      );
    },
    []
  );

  const publishFeedback = useCallback(
    (nextFeedback: BlueprintArtifactFeedback[]) => {
      setFeedback(nextFeedback);
    },
    []
  );

  useEffect(() => {
    publishEntries(initialEntries ?? []);
  }, [initialEntries, publishEntries]);

  useEffect(() => {
    publishReplays(initialReplays ?? []);
  }, [initialReplays, publishReplays]);

  useEffect(() => {
    publishFeedback(initialFeedback ?? []);
  }, [initialFeedback, publishFeedback]);

  const selectedEntry = useMemo(
    () =>
      entries.find(entry => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId]
  );
  const activeReplay = useMemo(
    () =>
      replays.find(replay => replay.id === activeReplayId) ??
      replays[0] ??
      null,
    [activeReplayId, replays]
  );
  const stageGroups = useMemo(() => {
    const groups = new Map<string, BlueprintArtifactLedgerEntry[]>();
    entries.forEach(entry => {
      const stage = entry.stage || "artifact_memory";
      groups.set(stage, [...(groups.get(stage) ?? []), entry]);
    });

    return Array.from(groups.entries())
      .map(([stage, stageEntries]) => ({
        stage,
        entries: stageEntries.sort((left, right) =>
          (right.createdAt || "").localeCompare(left.createdAt || "")
        ),
      }))
      .sort((left, right) => left.stage.localeCompare(right.stage));
  }, [entries]);
  const lineageEdgeCount = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.lineageEdgeCount, 0),
    [entries]
  );
  const canReplay = Boolean(jobId && selectedEntry);
  const canDiff = Boolean(
    jobId && leftEntryId && rightEntryId && leftEntryId !== rightEntryId
  );
  const canRecordFeedback = Boolean(
    jobId && feedbackEntryId && feedbackSummary.trim()
  );

  const handleRefreshLedger = useCallback(async () => {
    if (!jobId) return;

    setLoadingLedger(true);
    setError(null);

    try {
      const result = await fetchBlueprintArtifactLedger(jobId);
      if (result.ok) {
        publishEntries(result.data.entries);
      } else if (result.error.status === 404) {
        publishEntries([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingLedger(false);
    }
  }, [jobId, publishEntries]);

  const handleRefreshReplays = useCallback(async () => {
    if (!jobId) return;

    setLoadingReplays(true);
    setError(null);

    try {
      const result = await fetchBlueprintArtifactReplays(jobId);
      if (result.ok) {
        publishReplays(result.data.replays);
      } else if (result.error.status === 404) {
        publishReplays([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingReplays(false);
    }
  }, [jobId, publishReplays]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([handleRefreshLedger(), handleRefreshReplays()]);
  }, [handleRefreshLedger, handleRefreshReplays]);

  const handleReplayEntry = useCallback(async () => {
    if (!jobId || !selectedEntry) return;

    setReplaying(true);
    setError(null);

    try {
      const result = await replayBlueprintArtifact(jobId, {
        entryId: selectedEntry.id,
        stage: selectedEntry.stage,
      });
      if (result.ok) {
        const nextReplays = [
          result.data.replay,
          ...replays.filter(replay => replay.id !== result.data.replay.id),
        ];
        publishReplays(nextReplays);
        setActiveReplayId(result.data.replay.id);
      } else if (result.error.status === 404) {
        publishReplays([]);
      } else {
        setError(result.error);
      }
    } finally {
      setReplaying(false);
    }
  }, [jobId, publishReplays, replays, selectedEntry]);

  const handleDiffEntries = useCallback(async () => {
    if (!jobId || !canDiff) return;

    setDiffing(true);
    setError(null);

    try {
      const result = await diffBlueprintArtifacts(jobId, {
        leftEntryId,
        rightEntryId,
      });
      if (result.ok) {
        setDiff(result.data.diff);
      } else if (result.error.status === 404) {
        setDiff(null);
      } else {
        setError(result.error);
      }
    } finally {
      setDiffing(false);
    }
  }, [canDiff, jobId, leftEntryId, rightEntryId]);

  const handleRecordFeedback = useCallback(async () => {
    if (!jobId || !feedbackEntryId || !feedbackSummary.trim()) return;

    setRecordingFeedback(true);
    setError(null);

    try {
      const result = await recordBlueprintArtifactFeedback(jobId, {
        entryId: feedbackEntryId,
        sentiment: feedbackSentiment,
        status: feedbackStatus,
        summary: feedbackSummary.trim(),
        notes: feedbackNotes.trim() || undefined,
      });
      if (result.ok) {
        publishFeedback([
          result.data.feedback,
          ...feedback.filter(item => item.id !== result.data.feedback.id),
        ]);
        setFeedbackSummary("");
        setFeedbackNotes("");
      } else if (result.error.status !== 404) {
        setError(result.error);
      }
    } finally {
      setRecordingFeedback(false);
    }
  }, [
    feedback,
    feedbackEntryId,
    feedbackNotes,
    feedbackSentiment,
    feedbackStatus,
    feedbackSummary,
    jobId,
    publishFeedback,
  ]);

  useEffect(() => {
    if (!jobId || entries.length > 0) return;
    void handleRefreshLedger();
  }, [entries.length, handleRefreshLedger, jobId]);

  useEffect(() => {
    if (!jobId || replays.length > 0) return;
    void handleRefreshReplays();
  }, [handleRefreshReplays, jobId, replays.length]);

  return (
    <div
      className="grid gap-3"
      data-testid="artifact-memory-workbench"
    >
      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-none border-[#CCCCCC] bg-white font-black text-black hover:bg-[#F3F3F3]"
            disabled={!jobId || loadingLedger || loadingReplays || replaying}
            onClick={handleRefreshAll}
            data-testid="artifact-memory-refresh-button"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (loadingLedger || loadingReplays) && "animate-spin"
              )}
              aria-hidden="true"
            />
            {panelText("刷新", "Refresh", locale)}
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-none bg-black font-black text-white hover:bg-[#333]"
            disabled={!canReplay || loadingLedger || replaying}
            onClick={handleReplayEntry}
            data-testid="artifact-replay-button"
          >
            {replaying ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="size-3.5" aria-hidden="true" />
            )}
            {panelText("回放快照", "Replay snapshot", locale)}
          </Button>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <SummaryTile
          label={panelText("台账记录", "Ledger entries", locale)}
          value={entries.length}
          detail={panelText(
            `${stageGroups.length} 个阶段`,
            `${stageGroups.length} stages`,
            locale
          )}
        />
        <SummaryTile
          label={panelText("回放", "Replays", locale)}
          value={replays.length}
          detail={panelText("快照历史", "Snapshot history", locale)}
        />
        <SummaryTile
          label={panelText("血缘边", "Lineage edges", locale)}
          value={lineageEdgeCount}
          detail={panelText("来源链接", "Source links", locale)}
        />
        <SummaryTile
          label={panelText("反馈", "Feedback", locale)}
          value={feedback.length}
          detail={panelText("回填记录", "Backfilled records", locale)}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(250px,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("时间线 / 台账", "Timeline / ledger", locale)}
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
            >
              {panelText(`${entries.length} 条记录`, `${entries.length} entries`, locale)}
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[500px] pr-2">
            <div className="grid gap-3" data-testid="artifact-ledger-timeline">
              {stageGroups.length ? (
                stageGroups.map(group => (
                  <div
                    key={group.stage}
                    className="rounded-[14px] border border-slate-200 bg-slate-50 p-2"
                    data-testid="artifact-ledger-stage-group"
                  >
                    <div className="flex items-center justify-between gap-2 px-1 py-1">
                      <span className="text-xs font-black uppercase tracking-normal text-slate-500">
                        {artifactTokenLabel(group.stage, "Artifact memory", locale)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {panelText(
                          `${group.entries.length} 条记录`,
                          `${group.entries.length} entries`,
                          locale
                        )}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2">
                      {group.entries.map(entry => {
                        const selected = selectedEntry?.id === entry.id;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={cn(
                              "w-full rounded-[12px] border px-3 py-3 text-left transition",
                              selected
                                ? "border-slate-950 bg-white"
                                : "border-slate-200 bg-white/80 hover:border-slate-300"
                            )}
                            onClick={() => {
                              setSelectedEntryId(entry.id);
                              setFeedbackEntryId(entry.id);
                            }}
                            data-testid="artifact-ledger-entry"
                            aria-pressed={selected}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="truncate text-sm font-black text-slate-900">
                                {blueprintCopy(entry.title, locale)}
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                {artifactTokenLabel(
                                  entry.artifactType,
                                  "Artifact",
                                  locale
                                )}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                              {blueprintCopy(entry.summary, locale)}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                              <span>
                                {formatEffectPreviewDate(
                                  entry.recordedAt ?? entry.createdAt,
                                  locale
                                )}
                              </span>
                              <span>{blueprintCopy(entry.status, locale)}</span>
                              <span>{entry.lineageEdgeCount} 条边</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  {panelText(
                    "后端记忆层记录任务时间线后，资产台账会显示在这里。",
                    "The ledger will appear here after the backend memory layer records the task timeline.",
                    locale
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  {panelText("已选资产", "Selected asset", locale)}
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {selectedEntry?.title
                    ? blueprintCopy(selectedEntry.title, locale)
                    : panelText("资产台账已就绪", "Asset ledger ready", locale)}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {selectedEntry
                  ? artifactTokenLabel(selectedEntry.stage, "Artifact memory", locale)
                  : panelText("暂无记录", "No entries yet", locale)}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {selectedEntry?.summary
                ? blueprintCopy(selectedEntry.summary, locale)
                : panelText(
                    "工作台已连接，正在等待资产台账内容。",
                    "Workbench is connected and waiting for ledger content.",
                    locale
                  )}
            </p>
            {selectedEntry ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <RouteMetric
                  label={panelText("资产", "Asset", locale)}
                  value={artifactTokenLabel(
                    selectedEntry.artifactType,
                    "Artifact",
                    locale
                  )}
                />
                <RouteMetric
                  label={panelText("状态", "Status", locale)}
                  value={blueprintCopy(selectedEntry.status, locale)}
                />
                <RouteMetric
                  label={panelText("血缘", "Lineage", locale)}
                  value={panelText(
                    `${selectedEntry.lineageEdgeCount} 条边`,
                    `${selectedEntry.lineageEdgeCount} edges`,
                    locale
                  )}
                />
              </div>
            ) : null}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-replay-summary"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <PlayCircle className="size-3.5" aria-hidden="true" />
                  {panelText("回放快照摘要", "Replay snapshot summary", locale)}
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activeReplay?.title
                    ? blueprintCopy(activeReplay.title, locale)
                    : panelText("回放快照已就绪", "Replay snapshot ready", locale)}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {activeReplay?.status
                  ? blueprintCopy(activeReplay.status, locale)
                  : panelText("暂无回放", "No replay yet", locale)}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activeReplay?.summary
                ? blueprintCopy(activeReplay.summary, locale)
                : panelText(
                    "回放摘要会显示某条台账记录的恢复时间线。",
                    "The replay summary shows the restored timeline for a ledger entry.",
                    locale
                  )}
            </p>

            {replays.length ? (
              <div
                className="mt-3 flex flex-wrap gap-2"
                data-testid="artifact-replay-list"
              >
                {replays.map(replay => {
                  const selected = activeReplay?.id === replay.id;
                  return (
                    <button
                      key={replay.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-black transition",
                        selected
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                      )}
                      onClick={() => setActiveReplayId(replay.id)}
                      aria-pressed={selected}
                    >
                      {blueprintCopy(replay.title, locale)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <RouteMetric
                label="快照"
                value={activeReplay?.snapshots.length ?? 0}
              />
              <RouteMetric
                label="血缘"
                value={`${activeReplay?.lineageEdgeCount ?? 0} 条边`}
              />
            </div>

            {activeReplay?.snapshots.length ? (
              <div className="mt-3 grid gap-2">
                {activeReplay.snapshots.slice(0, 4).map(snapshot => (
                  <div
                    key={snapshot.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">
                        {blueprintCopy(snapshot.title, locale)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {artifactTokenLabel(snapshot.stage, "Artifact memory", locale)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(snapshot.summary, locale)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-diff-controls"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <Clipboard className="size-3.5" aria-hidden="true" />
                资产差异
              </div>
              <Button
                type="button"
                size="sm"
                className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={!canDiff || diffing}
                onClick={handleDiffEntries}
                data-testid="artifact-diff-compare-button"
              >
                {diffing ? (
                  <RefreshCw
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <GitBranch className="size-3.5" aria-hidden="true" />
                )}
                对比记录
              </Button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                左侧记录
                <select
                  value={leftEntryId}
                  onChange={event => setLeftEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择左侧记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                右侧记录
                <select
                  value={rightEntryId}
                  onChange={event => setRightEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择右侧记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title, locale)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {diff ? (
              <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm font-black text-slate-900">
                  {blueprintCopy(diff.title, locale)}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  {blueprintCopy(diff.summary, locale)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-normal text-slate-500">
                  <span>{diff.added} 新增</span>
                  <span>{diff.removed} 删除</span>
                  <span>{diff.changed} 变更</span>
                  <span>{diff.unchanged} 未变更</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                选择两条台账记录来比较资产版本。
              </div>
            )}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-feedback-recorder"
          >
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              反馈回填记录器
            </div>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                台账记录
                <select
                  value={feedbackEntryId}
                  onChange={event => setFeedbackEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  情绪
                  <select
                    value={feedbackSentiment}
                    onChange={event => setFeedbackSentiment(event.target.value)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  状态
                  <select
                    value={feedbackStatus}
                    onChange={event => setFeedbackStatus(event.target.value)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ARTIFACT_FEEDBACK_STATUS_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                value={feedbackSummary}
                onChange={event => setFeedbackSummary(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="反馈摘要"
              />
              <textarea
                value={feedbackNotes}
                onChange={event => setFeedbackNotes(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="回填备注"
              />
              <Button
                type="button"
                className="w-fit gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={!canRecordFeedback || recordingFeedback}
                onClick={handleRecordFeedback}
                data-testid="artifact-feedback-record-button"
              >
                {recordingFeedback ? (
                  <RefreshCw
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                )}
                记录反馈
              </Button>
            </div>

            <div
              className="mt-4 grid gap-2"
              data-testid="artifact-feedback-list"
            >
              {feedback.length ? (
                feedback.slice(0, 4).map(item => (
                  <div
                    key={item.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">
                        {blueprintCopy(item.summary, locale)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {artifactTokenLabel(item.status, "Recorded", locale)}
                      </span>
                    </div>
                    {item.notes ? (
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(item.notes, locale)}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  执行评审后，反馈回填记录会显示在这里。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
