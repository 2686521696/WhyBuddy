import type { BlueprintGenerationEvent } from "@shared/blueprint";

interface ReplanTimelineViewProps {
  events: BlueprintGenerationEvent[];
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

function modeLabel(mode: ReplanTimelinePayload["mode"]): string {
  if (mode === "branch") return "创建分支";
  if (mode === "in_place") return "原地重规划";
  return "重规划";
}

export function ReplanTimelineView({ events }: ReplanTimelineViewProps) {
  const replanEvents = events
    .filter((event) => event.type === ("replan.triggered" as BlueprintGenerationEvent["type"]))
    .sort((a, b) => {
      const byTime = Date.parse(eventTime(b)) - Date.parse(eventTime(a));
      return byTime === 0 ? a.jobId.localeCompare(b.jobId) : byTime;
    });

  return (
    <section data-testid="replan-timeline-view" data-state={replanEvents.length ? "ready" : "empty"}>
      {replanEvents.length === 0 ? (
        <p>No replan events.</p>
      ) : (
        <ol>
          {replanEvents.map((event) => {
            const payload = replanPayload(event);
            const count = eventCount(payload);
            return (
              <li key={event.id} data-event-id={event.id}>
                <time dateTime={eventTime(event)}>{eventTime(event)}</time>
                <span>{modeLabel(payload.mode)}</span>
                <span title={event.jobId}>{shortJobId(event.jobId)}</span>
                {payload.parentJobId ? (
                  <span title={payload.parentJobId}>{shortJobId(payload.parentJobId)}</span>
                ) : null}
                {payload.fromStage ? <span>{payload.fromStage}</span> : null}
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
