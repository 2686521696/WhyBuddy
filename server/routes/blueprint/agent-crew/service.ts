/**
 * 子域 4：Agent Crew & Runtime Capability 的服务层壳（方案 B）。
 *
 * 提供 `AgentCrewService` 接口，当前只把 artifact 投影里的 agent-crew、role timelines、
 * capability 列表以只读方式暴露出来。真正的 `buildAgentCrew` / `invokeCapability` /
 * `createSandboxDerivationJob` 实现仍在 `server/routes/blueprint.ts`。
 *
 * 对应需求 2.1 子域 4、3.2、5.1、5.2、7.3。
 */

import type {
  BlueprintAgentCrew,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationJob,
  BlueprintRolePresenceState,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";
import type {
  BlueprintAgentCrewProxyEvent,
  BlueprintAgentCrewProxyEventKind,
  BlueprintAgentCrewProxyTimeline,
  BlueprintAgentCrewProxyTimelineEntry,
  BlueprintAgentCrewProxyTimelineEntryType,
} from "../../../../shared/blueprint/agent-crew/types.js";

import type { BlueprintServiceContext } from "../context.js";

const PYTHON_AGENT_CREW_PROXY_CONTRACT_VERSION =
  "blueprint.agent-crew.proxy.v1";

export interface AgentCrewService {
  getCrew(jobId: string): BlueprintAgentCrew | null;
  listRoleTimelines(jobId: string): BlueprintAgentCrewProxyTimeline[];
  listCapabilities(jobId: string): BlueprintRuntimeCapability[];
  listInvocations(jobId: string): BlueprintCapabilityInvocation[];
  listEvidence(jobId: string): BlueprintCapabilityEvidence[];
}

function readLatestArtifactPayload<T>(
  job: BlueprintGenerationJob | null,
  type: string
): T | null {
  if (!job) return null;
  const matches = job.artifacts.filter(artifact => artifact.type === type);
  if (matches.length === 0) return null;
  return (matches[matches.length - 1]?.payload ?? null) as T | null;
}

function readAllArtifactPayloads<T>(
  job: BlueprintGenerationJob | null,
  type: string
): T[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === type)
    .map(artifact => artifact.payload as T)
    .filter((payload): payload is T => payload !== undefined && payload !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readProxyPayload(
  value: unknown
): BlueprintAgentCrewProxyEvent["payload"] {
  return isRecord(value) ? value : undefined;
}

function isPythonAgentCrewProxyEventKind(
  value: unknown
): value is BlueprintAgentCrewProxyEventKind {
  return (
    value === "plan" ||
    value === "assign" ||
    value === "result" ||
    value === "error"
  );
}

function isPythonAgentCrewProxyEvent(
  value: unknown
): value is BlueprintAgentCrewProxyEvent {
  if (!isRecord(value)) return false;
  return (
    value.contractVersion === PYTHON_AGENT_CREW_PROXY_CONTRACT_VERSION &&
    isPythonAgentCrewProxyEventKind(value.kind) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.roleId === "string" &&
    typeof value.stage === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.summary === "string"
  );
}

function collectPythonAgentCrewProxyEvents(
  job: BlueprintGenerationJob | null
): BlueprintAgentCrewProxyEvent[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === "role_timeline")
    .flatMap(artifact => {
      const payload = artifact.payload;
      if (!isRecord(payload)) return [];
      const events = Array.isArray(payload.events)
        ? payload.events
        : Array.isArray(payload.proxyEvents)
          ? payload.proxyEvents
          : [];
      return events.filter(isPythonAgentCrewProxyEvent);
    })
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.id.localeCompare(right.id)
    );
}

function mapProxyKindToEntryType(
  kind: BlueprintAgentCrewProxyEventKind
): BlueprintAgentCrewProxyTimelineEntryType {
  switch (kind) {
    case "plan":
      return "role.agent.plan";
    case "assign":
      return "role.agent.assign";
    case "result":
      return "role.agent.result";
    case "error":
      return "role.agent.error";
  }
}

function mapProxyKindToPresenceState(
  kind: BlueprintAgentCrewProxyEventKind
): BlueprintRolePresenceState {
  if (kind === "result") return "reviewing";
  if (kind === "error") return "sleeping";
  return "active";
}

function mapProxyKindToStatus(
  kind: BlueprintAgentCrewProxyEventKind
): BlueprintAgentCrewProxyTimelineEntry["status"] {
  if (kind === "error") return "failed";
  if (kind === "result") return "completed";
  return "running";
}

function firstString(value: unknown): string | undefined {
  return readStringArray(value)[0];
}

export function mapPythonAgentCrewProxyEvent(
  event: BlueprintAgentCrewProxyEvent,
  projectId?: string
): BlueprintAgentCrewProxyTimelineEntry {
  const payload = readProxyPayload(event.payload);
  const error = isRecord(payload?.error) ? payload.error : undefined;
  const errorMessage = readString(error?.message);
  return {
    id: `python-agent-crew-proxy:${event.id}`,
    eventId: event.id,
    jobId: event.jobId,
    projectId,
    crewId: event.crewId,
    stage: event.stage,
    roleId: event.roleId,
    presenceState: mapProxyKindToPresenceState(event.kind),
    type: mapProxyKindToEntryType(event.kind),
    status: mapProxyKindToStatus(event.kind),
    occurredAt: event.occurredAt,
    summary: event.summary,
    currentAction: readString(payload?.outputSummary) ?? event.summary,
    capabilityId: readString(payload?.capabilityId),
    artifactId: firstString(payload?.artifactIds),
    evidenceId: firstString(payload?.evidenceIds),
    routeId: readString(payload?.routeId),
    nodeId: readString(payload?.nodeId),
    error: errorMessage,
    payload: {
      proxy: {
        contractVersion: PYTHON_AGENT_CREW_PROXY_CONTRACT_VERSION,
        kind: event.kind,
      },
      budget: event.budget,
      error: error
        ? {
            code: readString(error.code),
            message: errorMessage ?? "Unknown Python agent crew proxy error.",
            retryable:
              typeof error.retryable === "boolean" ? error.retryable : undefined,
          }
        : undefined,
      sourcePayload: payload,
    },
  };
}

function buildPythonAgentCrewProxyTimelines(
  job: BlueprintGenerationJob | null
): BlueprintAgentCrewProxyTimeline[] {
  const entries = collectPythonAgentCrewProxyEvents(job).map(event =>
    mapPythonAgentCrewProxyEvent(event, job?.projectId)
  );
  const byRole = new Map<string, BlueprintAgentCrewProxyTimelineEntry[]>();
  for (const entry of entries) {
    const roleEntries = byRole.get(entry.roleId) ?? [];
    roleEntries.push(entry);
    byRole.set(entry.roleId, roleEntries);
  }
  return Array.from(byRole.entries()).map(([roleId, roleEntries]) => {
    const sortedEntries = roleEntries.sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.id.localeCompare(right.id)
    );
    const first = sortedEntries[0];
    const latest = sortedEntries[sortedEntries.length - 1];
    return {
      id: `python-agent-crew-proxy:${job?.id ?? "missing"}:${roleId}`,
      jobId: job?.id ?? "",
      projectId: job?.projectId,
      crewId: latest?.crewId,
      roleId,
      latestStage: latest?.stage ?? "runtime_capability",
      latestPresenceState: latest?.presenceState ?? "sleeping",
      latestAction: latest?.currentAction,
      latestCapabilityId: latest?.capabilityId,
      latestArtifactId: latest?.artifactId,
      latestEvidenceId: latest?.evidenceId,
      startedAt: first?.occurredAt ?? job?.createdAt ?? "",
      updatedAt: latest?.occurredAt ?? job?.updatedAt ?? "",
      entryCount: sortedEntries.length,
      entries: sortedEntries,
    };
  });
}

export function createAgentCrewService(
  ctx: BlueprintServiceContext
): AgentCrewService {
  return {
    getCrew(jobId) {
      const job = ctx.jobStore.get(jobId);
      const crew = readLatestArtifactPayload<BlueprintAgentCrew>(job, "agent_crew");
      return crew ?? null;
    },
    listRoleTimelines(jobId) {
      const job = ctx.jobStore.get(jobId);
      return buildPythonAgentCrewProxyTimelines(job);
    },
    listCapabilities(jobId) {
      const job = ctx.jobStore.get(jobId);
      const registry = readLatestArtifactPayload<{
        capabilities: BlueprintRuntimeCapability[];
      }>(job, "capability_registry");
      return registry?.capabilities ?? [];
    },
    listInvocations(jobId) {
      const job = ctx.jobStore.get(jobId);
      return readAllArtifactPayloads<BlueprintCapabilityInvocation>(
        job,
        "capability_invocation"
      );
    },
    listEvidence(jobId) {
      const job = ctx.jobStore.get(jobId);
      return readAllArtifactPayloads<BlueprintCapabilityEvidence>(
        job,
        "capability_evidence"
      );
    },
  };
}
