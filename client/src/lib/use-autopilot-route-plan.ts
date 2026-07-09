import type {
  LaunchRouteCandidate,
  LaunchRouteCandidateId,
  LaunchRoutePlan,
  LaunchRuntimeMode,
  UnifiedLaunchInput,
} from "./launch-router";
import { buildLaunchRoutePlan } from "./launch-router";
import type { FrontendAutopilotViewModelInput } from "./autopilot-frontend-model";
import { normalizeFrontendAutopilotViewModel } from "./autopilot-frontend-model";
import type {
  MissionAutopilotCandidateRoute,
  MissionAutopilotRouteChangeActor,
  MissionAutopilotRouteEvidenceEvent,
  MissionAutopilotRouteEvidenceEventType,
  MissionAutopilotRouteStatus,
} from "@shared/mission/autopilot";

type RoutePlanAliasSource = Record<string, unknown>;

export interface FrontendAutopilotRoutePlanInput {
  text?: unknown;
  destinationText?: unknown;
  attachments?: UnifiedLaunchInput["attachments"];
  runtimeMode?: LaunchRuntimeMode;
  selectedRouteId?: unknown;
  selectedCandidateId?: unknown;
  routeId?: unknown;
  frontendState?: FrontendAutopilotViewModelInput | null;
}

export interface FrontendAutopilotRoutePlanModel {
  routePlan: LaunchRoutePlan;
  selectedRouteId: LaunchRouteCandidateId;
  selectedCandidate: LaunchRouteCandidate;
  recommendedCandidate: LaunchRouteCandidate;
  selectedFrom:
    | "explicit"
    | "legacy-alias"
    | "frontend-projection"
    | "frontend-planning"
    | "recommended";
  canStart: boolean;
  warnings: string[];
  candidateRoutes: MissionAutopilotCandidateRoute[];
  selectedCandidateRoute: MissionAutopilotCandidateRoute;
  routeSelectionEvidenceEvent: MissionAutopilotRouteEvidenceEvent;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCandidateId(value: unknown): LaunchRouteCandidateId | null {
  const text = readText(value);
  return text === "clarify-first" ||
    text === "fast-route" ||
    text === "standard-route" ||
    text === "deep-route" ||
    text === "upgrade-runtime"
    ? text
    : null;
}

function findAvailableCandidate(
  routePlan: LaunchRoutePlan,
  candidateId: LaunchRouteCandidateId | null
): LaunchRouteCandidate | null {
  if (!candidateId) return null;
  return (
    routePlan.candidates.find(
      candidate => candidate.id === candidateId && candidate.available
    ) ?? null
  );
}

function titleForCandidate(candidate: LaunchRouteCandidate): string {
  switch (candidate.id) {
    case "clarify-first":
      return "Clarify waypoints";
    case "fast-route":
      return "Fast route";
    case "standard-route":
      return "Standard route";
    case "deep-route":
      return "Deep route";
    case "upgrade-runtime":
      return "Upgrade runtime";
  }
}

function summaryForCandidate(candidate: LaunchRouteCandidate): string {
  switch (candidate.id) {
    case "clarify-first":
      return "Ask for missing destination details before planning execution.";
    case "fast-route":
      return "Favor shorter execution chains and a faster feedback loop.";
    case "standard-route":
      return "Balance execution depth, governance, and delivery confidence.";
    case "deep-route":
      return "Favor orchestration depth, verification, and recovery headroom.";
    case "upgrade-runtime":
      return "Switch to a runtime that can use browser, command, or sandbox capabilities.";
  }
}

function routeStatusForCandidate(
  candidate: LaunchRouteCandidate
): MissionAutopilotRouteStatus {
  return candidate.available ? "pending" : "failed";
}

function riskLevelForCandidate(
  candidate: LaunchRouteCandidate
): MissionAutopilotCandidateRoute["riskLevel"] {
  switch (candidate.id) {
    case "clarify-first":
    case "standard-route":
      return "low";
    case "fast-route":
      return "medium";
    case "deep-route":
    case "upgrade-runtime":
      return "high";
  }
}

function takeoverLoadForCandidate(
  candidate: LaunchRouteCandidate
): MissionAutopilotCandidateRoute["takeoverLoad"] {
  if (candidate.takeoverPoints.length >= 3) return "high";
  if (candidate.takeoverPoints.length >= 2) return "medium";
  return "low";
}

function estimatedCostForCandidate(candidate: LaunchRouteCandidate): string | null {
  switch (candidate.id) {
    case "clarify-first":
    case "fast-route":
      return "low";
    case "standard-route":
      return "medium";
    case "deep-route":
      return "high";
    case "upgrade-runtime":
      return "upgrade";
  }
}

function estimatedDurationForCandidate(
  candidate: LaunchRouteCandidate
): string | null {
  switch (candidate.id) {
    case "clarify-first":
      return "paused";
    case "fast-route":
      return "short";
    case "standard-route":
      return "medium";
    case "deep-route":
      return "long";
    case "upgrade-runtime":
      return "upgrade";
  }
}

export function toCandidateRoute(
  candidate: LaunchRouteCandidate,
  selectedRouteId: LaunchRouteCandidateId
): MissionAutopilotCandidateRoute {
  const title = titleForCandidate(candidate);
  const summary = summaryForCandidate(candidate);

  return {
    id: candidate.id,
    label: title,
    mode: candidate.mode === "clarify" || candidate.mode === "upgrade"
      ? "custom"
      : candidate.mode,
    status: routeStatusForCandidate(candidate),
    title,
    name: title,
    summary,
    recommended: candidate.recommended,
    selected: candidate.id === selectedRouteId,
    locked: !candidate.available,
    reason: candidate.reasons.length > 0 ? candidate.reasons.join(", ") : null,
    description: summary,
    estimatedCost: estimatedCostForCandidate(candidate),
    estimatedDuration: estimatedDurationForCandidate(candidate),
    takeoverLoad: takeoverLoadForCandidate(candidate),
    riskLevel: riskLevelForCandidate(candidate),
    stageKeys: candidate.stages,
  };
}

function actorForSelectionSource(
  selectedFrom: FrontendAutopilotRoutePlanModel["selectedFrom"]
): MissionAutopilotRouteChangeActor {
  return selectedFrom === "explicit" ||
    selectedFrom === "legacy-alias" ||
    selectedFrom === "frontend-projection" ||
    selectedFrom === "frontend-planning"
    ? "user"
    : "planner";
}

function eventTypeForSelection(
  selectedRouteId: LaunchRouteCandidateId,
  recommendedRouteId: LaunchRouteCandidateId,
  selectedFrom: FrontendAutopilotRoutePlanModel["selectedFrom"],
  warnings: string[]
): MissionAutopilotRouteEvidenceEventType {
  if (warnings.length > 0) return "route.replanned";
  if (selectedFrom === "recommended" || selectedRouteId === recommendedRouteId) {
    return "route.recommended";
  }
  return "route.selected";
}

export function buildRouteSelectionEvidenceEvent({
  selectedRouteId,
  recommendedRouteId,
  selectedFrom,
  warnings,
  occurredAt = new Date(0).toISOString(),
}: {
  selectedRouteId: LaunchRouteCandidateId;
  recommendedRouteId: LaunchRouteCandidateId;
  selectedFrom: FrontendAutopilotRoutePlanModel["selectedFrom"];
  warnings: string[];
  occurredAt?: string;
}): MissionAutopilotRouteEvidenceEvent {
  const eventType = eventTypeForSelection(
    selectedRouteId,
    recommendedRouteId,
    selectedFrom,
    warnings
  );

  return {
    eventType,
    at: occurredAt,
    actor: actorForSelectionSource(selectedFrom),
    reason:
      warnings[0] ??
      (selectedFrom === "recommended"
        ? "Planner recommendation was used for route selection."
        : `Route selected from ${selectedFrom}.`),
    ...(recommendedRouteId !== selectedRouteId
      ? { fromRouteId: recommendedRouteId }
      : {}),
    toRouteId: selectedRouteId,
  };
}

function readSelectedCandidate(
  input: FrontendAutopilotRoutePlanInput,
  routePlan: LaunchRoutePlan
): {
  candidate: LaunchRouteCandidate;
  selectedFrom: FrontendAutopilotRoutePlanModel["selectedFrom"];
  warnings: string[];
} {
  const warnings: string[] = [];
  const frontendState = input.frontendState
    ? normalizeFrontendAutopilotViewModel(input.frontendState)
    : null;
  const sources: Array<{
    id: LaunchRouteCandidateId | null;
    from: FrontendAutopilotRoutePlanModel["selectedFrom"];
  }> = [
    { id: readCandidateId(input.selectedRouteId), from: "explicit" },
    { id: readCandidateId(input.selectedCandidateId), from: "legacy-alias" },
    { id: readCandidateId(input.routeId), from: "legacy-alias" },
    {
      id:
        frontendState?.sourceLayer === "projection"
          ? readCandidateId(frontendState.projection.selectedRouteId)
          : null,
      from: "frontend-projection",
    },
    {
      id:
        frontendState?.sourceLayer === "planning" ||
        frontendState?.sourceLayer === "projection"
          ? readCandidateId(frontendState.planning.selectedRouteId)
          : null,
      from: "frontend-planning",
    },
  ];

  for (const source of sources) {
    if (!source.id) continue;
    const candidate = findAvailableCandidate(routePlan, source.id);
    if (candidate) {
      return { candidate, selectedFrom: source.from, warnings };
    }
    warnings.push(`Ignored unavailable route selection: ${source.id}`);
  }

  const recommended =
    routePlan.candidates.find(
      candidate =>
        candidate.id === routePlan.recommendedRouteId && candidate.available
    ) ??
    routePlan.candidates.find(candidate => candidate.available) ??
    routePlan.candidates[0];

  return {
    candidate: recommended,
    selectedFrom: "recommended",
    warnings,
  };
}

export function buildFrontendAutopilotRoutePlan(
  input: FrontendAutopilotRoutePlanInput
): FrontendAutopilotRoutePlanModel {
  const launchInput: UnifiedLaunchInput = {
    text: readText(input.text) ?? readText(input.destinationText) ?? "",
    attachments: input.attachments ?? [],
    runtimeMode: input.runtimeMode ?? "advanced",
  };
  const routePlan = buildLaunchRoutePlan(launchInput);
  const recommendedCandidate =
    routePlan.candidates.find(
      candidate => candidate.id === routePlan.recommendedRouteId
    ) ?? routePlan.candidates[0];
  const selected = readSelectedCandidate(input, routePlan);
  const candidateRoutes = routePlan.candidates.map(candidate =>
    toCandidateRoute(candidate, selected.candidate.id)
  );
  const selectedCandidateRoute =
    candidateRoutes.find(candidate => candidate.id === selected.candidate.id) ??
    candidateRoutes[0];
  const routeSelectionEvidenceEvent = buildRouteSelectionEvidenceEvent({
    selectedRouteId: selected.candidate.id,
    recommendedRouteId: recommendedCandidate.id,
    selectedFrom: selected.selectedFrom,
    warnings: selected.warnings,
  });

  return {
    routePlan,
    selectedRouteId: selected.candidate.id,
    selectedCandidate: selected.candidate,
    recommendedCandidate,
    selectedFrom: selected.selectedFrom,
    canStart:
      selected.candidate.available &&
      selected.candidate.launchKind !== "clarify" &&
      selected.candidate.launchKind !== "upgrade-required",
    warnings: selected.warnings,
    candidateRoutes,
    selectedCandidateRoute,
    routeSelectionEvidenceEvent,
  };
}

export function useAutopilotRoutePlan(
  input: FrontendAutopilotRoutePlanInput
): FrontendAutopilotRoutePlanModel {
  return buildFrontendAutopilotRoutePlan(input);
}

export function readRouteSelectionAliases(
  source: RoutePlanAliasSource
): Array<string> {
  return [
    readText(source.selectedRouteId),
    readText(source.selectedCandidateId),
    readText(source.routeId),
  ].filter((value): value is string => value !== null);
}
