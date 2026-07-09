import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

import { EmptyHintBlock } from "@/components/tasks/EmptyHintBlock";
import { useI18n } from "@/i18n";
import {
  formatTimestamp,
  useSandboxStore,
  type LogLine,
} from "@/lib/sandbox-store";
import { cn } from "@/lib/utils";

export interface ExecutorTerminalPanelProps {
  missionId: string;
  missionStatus?: string;
  executorStatus?: string;
  fallbackLogUrl?: string;
}

const MAX_VISIBLE_LINES = 200;

function formatLine(line: LogLine): {
  text: string;
  isError: boolean;
  timestamp: string;
} {
  return {
    text: line.data,
    isError: line.stream === "stderr",
    timestamp: formatTimestamp(line.timestamp),
  };
}

function isExecutorUnavailable(status?: string): boolean {
  const normalized = status?.toLowerCase() ?? "";
  return (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("unreach") ||
    normalized.includes("disconnect")
  );
}

export function ExecutorTerminalPanel({
  missionId,
  missionStatus,
  executorStatus,
  fallbackLogUrl,
}: ExecutorTerminalPanelProps) {
  const { copy } = useI18n();
  const logLines = useSandboxStore(s => s.logLines);
  const activeMissionId = useSandboxStore(s => s.activeMissionId);
  const isStreaming = useSandboxStore(s => s.isStreaming);
  const setActiveMission = useSandboxStore(s => s.setActiveMission);
  const requestLogHistory = useSandboxStore(s => s.requestLogHistory);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [fallbackLines, setFallbackLines] = useState<LogLine[]>([]);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    setFallbackLines([]);
    setFallbackLoading(false);
  }, [missionId, fallbackLogUrl]);

  useEffect(() => {
    if (!missionId) {
      return;
    }

    if (activeMissionId !== missionId) {
      setActiveMission(missionId);
      return;
    }

    requestLogHistory(missionId);
  }, [missionId, activeMissionId, requestLogHistory, setActiveMission]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScrollEnabled) {
      el.scrollTop = el.scrollHeight;
    }
  }, [autoScrollEnabled, logLines.length]);

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [missionId]);

  const visibleLines = logLines.slice(-MAX_VISIBLE_LINES);
  const displayLines =
    visibleLines.length > 0
      ? visibleLines
      : fallbackLines.slice(-MAX_VISIBLE_LINES);
  const hasLines = displayLines.length > 0;
  const unavailable = isExecutorUnavailable(executorStatus);
  const emptyDescription =
    unavailable || missionStatus === "failed"
      ? copy.tasks.executor.unavailableLogsDescription
      : copy.tasks.executor.emptyLogsDescription;
  const emptyTone =
    missionStatus === "queued" || missionStatus === "waiting"
      ? "neutral"
      : unavailable
        ? "warning"
        : "info";

  return (
    <div
      className="flex min-h-[220px] min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-stone-200/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(249,244,238,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
      data-testid="executor-terminal-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-200/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-[#b16f44]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600">
            {copy.tasks.executor.terminalTitle}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              {copy.tasks.executor.terminalLive}
            </span>
          ) : null}
          {!isStreaming && fallbackLines.length > 0 ? (
            <span className="text-[10px] font-medium text-stone-500">
              log replay
            </span>
          ) : null}
          <button
            type="button"
            className="rounded-full border border-stone-200/80 bg-white/82 px-2 py-0.5 text-[10px] font-medium text-stone-600 transition hover:border-stone-300 hover:bg-white hover:text-stone-900"
            onClick={() => setAutoScrollEnabled(current => !current)}
          >
            {autoScrollEnabled
              ? copy.tasks.executor.pauseAutoScroll
              : copy.tasks.executor.resumeAutoScroll}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={event => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
          if (autoScrollEnabled && !nearBottom) {
            setAutoScrollEnabled(false);
          } else if (!autoScrollEnabled && nearBottom) {
            setAutoScrollEnabled(true);
          }
        }}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto bg-[#fcfaf7] px-2 py-2",
          !hasLines && "flex items-center"
        )}
        data-testid="executor-terminal-output"
      >
        {hasLines ? (
          <div className="overflow-hidden rounded-[14px] bg-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
            <div className="divide-y divide-stone-200/70">
              {displayLines.map((line, idx) => {
                const { text, isError, timestamp } = formatLine(line);
                return (
                  <div
                    key={`${line.timestamp}-${idx}`}
                    className={cn(
                      "grid grid-cols-[72px_minmax(0,1fr)] gap-3 px-3 py-2",
                      isError && "bg-rose-50/78"
                    )}
                  >
                    <div className="pt-0.5">
                      <div
                        className={cn(
                          "text-[10px] font-medium leading-4",
                          isError ? "text-rose-600" : "text-stone-500"
                        )}
                      >
                        {timestamp}
                      </div>
                      {isError ? (
                        <div className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-700">
                          stderr
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "min-w-0 whitespace-pre-wrap break-all font-mono text-[12px] leading-5",
                        isError ? "text-rose-900" : "text-stone-800"
                      )}
                    >
                      {text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyHintBlock
            icon={<Terminal className="size-4" />}
            title={copy.tasks.executor.emptyLogsTitle}
            description={emptyDescription}
            actionLabel={copy.tasks.executor.retryLogs}
            hint={
              fallbackLoading ? "Loading stored executor.log..." : undefined
            }
            onAction={() => {
              requestLogHistory(missionId);
              if (!fallbackLogUrl) return;
              setFallbackLoading(true);
              fetch(fallbackLogUrl)
                .then(response => {
                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                  }
                  return response.text();
                })
                .then(text => {
                  const loadedAt = new Date().toISOString();
                  setFallbackLines(
                    text
                      .split(/\r?\n/)
                      .filter(line => line.trim().length > 0)
                      .slice(-MAX_VISIBLE_LINES)
                      .map((line, index) => ({
                        stepIndex: index,
                        stream: line.includes("[stderr]") ? "stderr" : "stdout",
                        data: line,
                        timestamp: loadedAt,
                      }))
                  );
                })
                .catch(() => {
                  setFallbackLines([]);
                })
                .finally(() => {
                  setFallbackLoading(false);
                });
            }}
            tone={emptyTone}
            className="w-full border-stone-200/70 bg-white/82 text-left shadow-none"
          />
        )}
      </div>
    </div>
  );
}
