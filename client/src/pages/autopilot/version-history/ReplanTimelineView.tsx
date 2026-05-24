import type { BlueprintGenerationEvent } from "@shared/blueprint";
import type { AppLocale } from "@/lib/locale";

interface ReplanTimelineViewProps {
  events: BlueprintGenerationEvent[];
  locale?: AppLocale;
}

interface ReplanTimelinePayload {
  mode?: "in_place" | "branch";
  parentJobId?: string;
  fromStage?: string;
  triggeredAt?: string;
  markedStaleArtifactCount?: number;
  inheritedUpstreamArtifactCount?: number;
  reason?: string;
}

function replanPayload(event: BlueprintGenerationEvent): ReplanTimelinePayload {
  return (event.payload ?? {}) as ReplanTimelinePayload;
}

function eventTime(event: BlueprintGenerationEvent): string {
  const payload = replanPayload(event);
  return payload?.triggeredAt ?? event.occurredAt;
}

function eventCount(payload: ReplanTimelinePayload): number | null {
  if (payload.mode === "branch") {
    return payload.inheritedUpstreamArtifactCount ?? null;
  }
  if (payload.mode === "in_place") {
    return payload.markedStaleArtifactCount ?? null;
  }
  return payload.markedStaleArtifactCount ?? payload.inheritedUpstreamArtifactCount ?? null;
}

function truncateReason(reason: string): string {
  return reason.length > 200 ? `${reason.slice(0, 200)}...` : reason;
}

function shortJobId(jobId: string): string {
  return jobId.length > 12 ? `${jobId.slice(0, 8)}...` : jobId;
}

function modeLabel(mode: ReplanTimelinePayload["mode"], locale: AppLocale): string {
  if (locale === "zh-CN") {
    if (mode === "branch") return "创建分支";
    if (mode === "in_place") return "原地重规划";
    return "重规划";
  }
  if (mode === "branch") return "Branch";
  if (mode === "in_place") return "In place";
  return "Replan";
}

const STAGE_LABELS_ZH: Record<string, string> = {
  input: "输入",
  clarification: "澄清",
  route_generation: "路线",
  route_selection: "路线选择",
  spec_tree: "规格树",
  spec_docs: "规格文档",
  spec_documents: "规格文档",
  preview: "预览",
  effect_preview: "效果预览",
  prompt_packaging: "提示包",
  runtime_capability: "运行能力",
  engineering_handoff: "工程交接",
  engineering_landing: "工程落地",
};

function stageLabel(stage: string, locale: AppLocale): string {
  if (locale === "zh-CN") return STAGE_LABELS_ZH[stage] ?? stage;
  return stage;
}

export function ReplanTimelineView({
  events,
  locale = "en-US",
}: ReplanTimelineViewProps) {
  const replanEvents = events
    .filter((event) => event.type === ("replan.triggered" as BlueprintGenerationEvent["type"]))
    .sort((a, b) => {
      const byTime = Date.parse(eventTime(b)) - Date.parse(eventTime(a));
      return byTime === 0 ? a.jobId.localeCompare(b.jobId) : byTime;
    });

  const emptyText = locale === "zh-CN" ? "暂无重规划记录。" : "No replan events.";

  return (
    <section data-testid="replan-timeline-view" data-state={replanEvents.length ? "ready" : "empty"}>
      {replanEvents.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <ol>
          {replanEvents.map((event) => {
            const payload = replanPayload(event);
            const count = eventCount(payload);
            return (
              <li key={event.id} data-event-id={event.id}>
                <time dateTime={eventTime(event)}>{eventTime(event)}</time>
                <span>{modeLabel(payload.mode, locale)}</span>
                <span title={event.jobId}>{shortJobId(event.jobId)}</span>
                {payload.parentJobId ? (
                  <span title={payload.parentJobId}>{shortJobId(payload.parentJobId)}</span>
                ) : null}
                {payload.fromStage ? (
                  <span>{stageLabel(payload.fromStage, locale)}</span>
                ) : null}
                {count === null ? null : <span>{count}</span>}
                <span>{event.message}</span>
                {payload.reason ? <p>{truncateReason(payload.reason)}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
