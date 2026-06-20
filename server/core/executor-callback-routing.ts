import type {
  EventMappingInput,
  ExecutorCallbackDelivery,
} from "./executor-event-mapper.js";

export interface ExecutorCallbackRoutingInput extends EventMappingInput {
  eventId: string;
  missionId: string;
  jobId: string;
  type: string;
  status?: string;
  delivery?: ExecutorCallbackDelivery;
}

export type ExecutorCallbackRoute = "blueprint" | "mission";

export interface ExecutorCallbackRoutingResult {
  route: ExecutorCallbackRoute;
  missionId: string;
  jobId: string;
  eventId: string;
  callbackSource: "node" | "python";
  terminal: boolean;
  ignoredTerminal: boolean;
}

export function isBlueprintExecutorMissionId(missionId: string): boolean {
  const normalized = missionId.trim();
  return normalized.startsWith("blueprint:") || normalized.startsWith("blueprint-job-");
}

export function resolveExecutorCallbackRouting(
  event: ExecutorCallbackRoutingInput,
): ExecutorCallbackRoutingResult {
  const terminal =
    event.type === "job.completed" ||
    event.type === "job.failed" ||
    event.type === "job.cancelled" ||
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled";
  const duplicateOrOutOfOrder =
    event.delivery?.duplicate === true || event.delivery?.outOfOrder === true;

  return {
    route: isBlueprintExecutorMissionId(event.missionId) ? "blueprint" : "mission",
    missionId: event.missionId.trim(),
    jobId: event.jobId.trim(),
    eventId: event.eventId.trim(),
    callbackSource: event.callbackSource === "python" ? "python" : "node",
    terminal,
    ignoredTerminal: terminal && duplicateOrOutOfOrder,
  };
}
