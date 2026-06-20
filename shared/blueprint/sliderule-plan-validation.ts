import type { V5CapabilityId } from "./contracts.js";
import { V5_CAPABILITY_POOL } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";
import { CAPABILITY_DEFAULT_ROLES } from "./sliderule-capability-catalog.js";
import { V5_ROLE_IDS } from "./sliderule-role-map.js";

export type DropReason =
  | "invalid_capability"
  | "duplicate_in_proposal"
  | "clamped_over_max"
  | "invalid_role_defaulted";

export type ProposedPlanItem = {
  capabilityId?: unknown;
  roleId?: unknown;
  why?: unknown;
};

export type ProposedPlanInput = {
  selected?: unknown;
  rationale?: unknown;
};

export type ValidatedPlanItem = {
  capabilityId: V5CapabilityId;
  roleId: string;
  why?: string;
};

export type ValidateProposedPlanResult = {
  valid: boolean;
  selected: ValidatedPlanItem[];
  dropped: Array<{ capabilityId: string; reason: DropReason }>;
};

export type PlanProjectionStatus = "partial" | "complete" | "error";
export type PlanProjectionPhaseStatus = "pending" | "active" | "complete" | "blocked";
export type PlanProjectionStepStatus = "pending" | "running" | "complete" | "blocked";
export type PlanProjectionRiskSeverity = "low" | "medium" | "high";

export type PlanStateProjectionPhase = {
  id: string;
  label: string;
  status: PlanProjectionPhaseStatus;
  stepIds: string[];
};

export type PlanStateProjectionStep = {
  id: string;
  capabilityId: V5CapabilityId;
  roleId: string;
  status: PlanProjectionStepStatus;
  phaseId: string;
  why?: string;
};

export type PlanStateProjectionRisk = {
  id: string;
  severity: PlanProjectionRiskSeverity;
  summary: string;
  mitigation: string;
};

export type PlanStateProjectionRecoveryPoint = {
  id: string;
  label: string;
  action: string;
  retryable: boolean;
};

export type PlanStateProjectionError = {
  code: string;
  reason: string;
  message: string;
};

export type PlanStateProjection = {
  kind: "orchestrate.plan.state_projection";
  schemaVersion: 1;
  stateAuthority: "node";
  stateMutation: "none";
  status: PlanProjectionStatus;
  phase: string;
  partial: boolean;
  phases: PlanStateProjectionPhase[];
  steps: PlanStateProjectionStep[];
  risks: PlanStateProjectionRisk[];
  recoveryPoints: PlanStateProjectionRecoveryPoint[];
  error: PlanStateProjectionError | null;
};

export type ValidatePlanStateProjectionResult = {
  valid: boolean;
  projection?: PlanStateProjection;
  errors: string[];
};

const MIN_ITEMS = 1;
const MAX_ITEMS = 4;

/** Legacy / doc aliases → canonical pool ids. */
const CAPABILITY_ALIASES: Record<string, V5CapabilityId> = {
  "scenario.preview": "scenario.simulate",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeItems(raw: unknown): ProposedPlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x != null && typeof x === "object") as ProposedPlanItem[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRecordItems(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item != null);
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Extract capability id from common LLM field aliases (`capability`, `cap`, `id`). */
function extractCapabilityRaw(item: ProposedPlanItem): string {
  const rec = item as Record<string, unknown>;
  return (
    asString(item.capabilityId) ||
    asString(rec.capability) ||
    asString(rec.cap) ||
    asString(rec.id)
  );
}

/** Extract role from common LLM field aliases (`role`, `agent`). */
function extractRoleRaw(item: ProposedPlanItem): string {
  const rec = item as Record<string, unknown>;
  return asString(item.roleId) || asString(rec.role) || asString(rec.agent);
}

/**
 * Resolve a raw capability token to a pool id (F0.1: tolerate `_` vs `.` and casing).
 * Returns null when no pool member matches.
 */
export function resolveCapabilityId(raw: string): V5CapabilityId | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const alias = CAPABILITY_ALIASES[trimmed] ?? CAPABILITY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (V5_CAPABILITY_POOL.has(trimmed as V5CapabilityId)) {
    return trimmed as V5CapabilityId;
  }
  const dotted = trimmed.replace(/_/g, ".").replace(/\s+/g, ".");
  const dottedAlias = CAPABILITY_ALIASES[dotted] ?? CAPABILITY_ALIASES[dotted.toLowerCase()];
  if (dottedAlias) return dottedAlias;
  if (V5_CAPABILITY_POOL.has(dotted as V5CapabilityId)) {
    return dotted as V5CapabilityId;
  }
  const lower = dotted.toLowerCase();
  for (const id of V5_CAPABILITY_POOL.keys()) {
    if (id.toLowerCase() === lower) return id;
  }
  return null;
}

/**
 * Mechanical validator for LLM orchestration proposals. Never throws.
 */
export function validateProposedPlan(
  proposal: ProposedPlanInput | null | undefined,
  _state?: V5SessionState
): ValidateProposedPlanResult {
  const dropped: Array<{ capabilityId: string; reason: DropReason }> = [];
  const items = normalizeItems(proposal?.selected);
  const accepted: ValidatedPlanItem[] = [];
  const seenCaps = new Set<string>();

  for (const item of items) {
    const capRaw = extractCapabilityRaw(item);
    const capId = capRaw ? resolveCapabilityId(capRaw) : null;

    if (!capId) {
      if (capRaw) dropped.push({ capabilityId: capRaw, reason: "invalid_capability" });
      continue;
    }

    if (seenCaps.has(capId)) {
      dropped.push({ capabilityId: capId, reason: "duplicate_in_proposal" });
      continue;
    }
    seenCaps.add(capId);

    let roleId = extractRoleRaw(item);
    if (!roleId || !(V5_ROLE_IDS as readonly string[]).includes(roleId)) {
      roleId = CAPABILITY_DEFAULT_ROLES[capId];
      dropped.push({ capabilityId: capId, reason: "invalid_role_defaulted" });
    }

    const why = asString(item.why) || undefined;
    accepted.push({ capabilityId: capId, roleId, ...(why ? { why } : {}) });
  }

  let selected = accepted;
  if (selected.length > MAX_ITEMS) {
    const overflow = selected.slice(MAX_ITEMS);
    for (const o of overflow) {
      dropped.push({ capabilityId: o.capabilityId, reason: "clamped_over_max" });
    }
    selected = selected.slice(0, MAX_ITEMS);
  }

  const valid = selected.length >= MIN_ITEMS;
  if (!valid) {
    return { valid: false, selected: [], dropped };
  }

  return { valid: true, selected, dropped };
}

export function validatePlanStateProjection(
  input: unknown
): ValidatePlanStateProjectionResult {
  const errors: string[] = [];
  const record = asRecord(input);
  if (!record) {
    return { valid: false, errors: ["projection must be an object"] };
  }

  if (record.kind !== "orchestrate.plan.state_projection") {
    errors.push("kind must be orchestrate.plan.state_projection");
  }
  if (record.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (record.stateAuthority !== "node") {
    errors.push("stateAuthority must be node");
  }
  if (record.stateMutation !== "none") {
    errors.push("stateMutation must be none");
  }
  if ("state" in record || "artifacts" in record || "capabilityRuns" in record || "coverageGate" in record) {
    errors.push("projection must not contain Node-owned state fields");
  }

  const statusRaw = asString(record.status);
  if (!isOneOf(statusRaw, ["partial", "complete", "error"] as const)) {
    errors.push("status must be partial, complete, or error");
  }
  const phase = asString(record.phase);
  if (!phase) {
    errors.push("phase is required");
  }
  if (typeof record.partial !== "boolean") {
    errors.push("partial must be boolean");
  }

  const phases = normalizeRecordItems(record.phases);
  const steps = normalizeRecordItems(record.steps);
  const risks = normalizeRecordItems(record.risks);
  const recoveryPoints = normalizeRecordItems(record.recoveryPoints);

  if (!Array.isArray(record.phases) || phases.length === 0) {
    errors.push("phases must be a non-empty array");
  }
  if (!Array.isArray(record.steps)) {
    errors.push("steps must be an array");
  }
  if (!Array.isArray(record.risks) || risks.length === 0) {
    errors.push("risks must be a non-empty array");
  }
  if (!Array.isArray(record.recoveryPoints) || recoveryPoints.length === 0) {
    errors.push("recoveryPoints must be a non-empty array");
  }

  const normalizedPhases: PlanStateProjectionPhase[] = [];
  const phaseIds = new Set<string>();
  for (const [index, item] of phases.entries()) {
    const id = asString(item.id);
    const label = asString(item.label);
    const status = asString(item.status);
    const stepIds = Array.isArray(item.stepIds)
      ? item.stepIds.map(asString).filter(Boolean)
      : [];
    if (!id) errors.push(`phases[${index}].id is required`);
    if (!label) errors.push(`phases[${index}].label is required`);
    if (!isOneOf(status, ["pending", "active", "complete", "blocked"] as const)) {
      errors.push(`phases[${index}].status is invalid`);
    }
    if (id) phaseIds.add(id);
    normalizedPhases.push({
      id,
      label,
      status: isOneOf(status, ["pending", "active", "complete", "blocked"] as const)
        ? status
        : "pending",
      stepIds,
    });
  }

  const normalizedSteps: PlanStateProjectionStep[] = [];
  for (const [index, item] of steps.entries()) {
    const id = asString(item.id);
    const capabilityRaw = asString(item.capabilityId);
    const capabilityId = resolveCapabilityId(capabilityRaw);
    const roleId = asString(item.roleId);
    const status = asString(item.status);
    const phaseId = asString(item.phaseId);
    const why = asString(item.why);

    if (!id) errors.push(`steps[${index}].id is required`);
    if (!capabilityId) errors.push(`steps[${index}].capabilityId is invalid`);
    if (!roleId) errors.push(`steps[${index}].roleId is required`);
    if (!isOneOf(status, ["pending", "running", "complete", "blocked"] as const)) {
      errors.push(`steps[${index}].status is invalid`);
    }
    if (!phaseId || !phaseIds.has(phaseId)) {
      errors.push(`steps[${index}].phaseId must reference a phase`);
    }

    normalizedSteps.push({
      id,
      capabilityId: capabilityId ?? "evidence.search",
      roleId,
      status: isOneOf(status, ["pending", "running", "complete", "blocked"] as const)
        ? status
        : "pending",
      phaseId,
      ...(why ? { why } : {}),
    });
  }

  const stepIds = new Set(normalizedSteps.map((step) => step.id).filter(Boolean));
  for (const [index, phaseItem] of normalizedPhases.entries()) {
    for (const stepId of phaseItem.stepIds) {
      if (!stepIds.has(stepId)) {
        errors.push(`phases[${index}].stepIds contains unknown step ${stepId}`);
      }
    }
  }

  const normalizedRisks: PlanStateProjectionRisk[] = [];
  for (const [index, item] of risks.entries()) {
    const id = asString(item.id);
    const severity = asString(item.severity);
    const summary = asString(item.summary);
    const mitigation = asString(item.mitigation);
    if (!id) errors.push(`risks[${index}].id is required`);
    if (!isOneOf(severity, ["low", "medium", "high"] as const)) {
      errors.push(`risks[${index}].severity is invalid`);
    }
    if (!summary) errors.push(`risks[${index}].summary is required`);
    if (!mitigation) errors.push(`risks[${index}].mitigation is required`);
    normalizedRisks.push({
      id,
      severity: isOneOf(severity, ["low", "medium", "high"] as const) ? severity : "medium",
      summary,
      mitigation,
    });
  }

  const normalizedRecoveryPoints: PlanStateProjectionRecoveryPoint[] = [];
  for (const [index, item] of recoveryPoints.entries()) {
    const id = asString(item.id);
    const label = asString(item.label);
    const action = asString(item.action);
    if (!id) errors.push(`recoveryPoints[${index}].id is required`);
    if (!label) errors.push(`recoveryPoints[${index}].label is required`);
    if (!action) errors.push(`recoveryPoints[${index}].action is required`);
    if (typeof item.retryable !== "boolean") {
      errors.push(`recoveryPoints[${index}].retryable must be boolean`);
    }
    normalizedRecoveryPoints.push({
      id,
      label,
      action,
      retryable: item.retryable === true,
    });
  }

  const errorRecord = record.error === null || record.error === undefined
    ? null
    : asRecord(record.error);
  let normalizedError: PlanStateProjectionError | null = null;
  if (statusRaw === "error") {
    if (!errorRecord) {
      errors.push("error projection must include error details");
    } else {
      const code = asString(errorRecord.code);
      const reason = asString(errorRecord.reason);
      const message = asString(errorRecord.message);
      if (!code) errors.push("error.code is required");
      if (!reason) errors.push("error.reason is required");
      if (!message) errors.push("error.message is required");
      normalizedError = { code, reason, message };
    }
    if (record.partial !== false) {
      errors.push("error projection must not be partial");
    }
    if (steps.length > 0) {
      errors.push("error projection must not include executable steps");
    }
  } else {
    if (errorRecord) {
      errors.push("non-error projection must not include error details");
    }
    if (statusRaw === "complete" && record.partial !== false) {
      errors.push("complete projection must not be partial");
    }
    if (statusRaw === "partial" && record.partial !== true) {
      errors.push("partial projection must set partial true");
    }
  }
  if (statusRaw === "complete" && steps.length > 0) {
    errors.push("complete projection must not include pending steps");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    projection: {
      kind: "orchestrate.plan.state_projection",
      schemaVersion: 1,
      stateAuthority: "node",
      stateMutation: "none",
      status: statusRaw as PlanProjectionStatus,
      phase,
      partial: record.partial as boolean,
      phases: normalizedPhases,
      steps: normalizedSteps,
      risks: normalizedRisks,
      recoveryPoints: normalizedRecoveryPoints,
      error: normalizedError,
    },
  };
}
