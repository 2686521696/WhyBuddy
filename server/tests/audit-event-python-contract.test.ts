import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  AuditEventType,
  validateAuditEvent,
  validateAuditEventDraft,
} from "../../shared/audit/contracts.js";

const nodeAuditEvent = {
  eventId: "ae_1710000000000_ab12cd34",
  eventType: AuditEventType.AGENT_EXECUTED,
  timestamp: 1710000000000,
  actor: { type: "agent", id: "agent-1", name: "Planner" },
  action: "execute_task",
  resource: { type: "mission", id: "mission-1", name: "Migration" },
  result: "success",
  context: { sessionId: "sess-1", requestId: "req-1" },
  metadata: { capabilityId: "audit.event" },
  lineageId: "lineage-1",
} as const;

describe("audit event Python contract parity", () => {
  it("exposes the same actor and result literal sets used by the Python contract", () => {
    expect(AUDIT_ACTOR_TYPES).toEqual(["user", "agent", "system"]);
    expect(AUDIT_RESULTS).toEqual(["success", "failure", "denied", "error"]);
  });

  it("validates the current Node audit event shape for Python mapping", () => {
    const result = validateAuditEvent(nodeAuditEvent);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(nodeAuditEvent.eventType).toBe(AuditEventType.AGENT_EXECUTED);
    expect(nodeAuditEvent.actor).toEqual({ type: "agent", id: "agent-1", name: "Planner" });
    expect(nodeAuditEvent.resource).toEqual({ type: "mission", id: "mission-1", name: "Migration" });
    expect(nodeAuditEvent.result).toBe("success");
  });

  it("validates the collector input shape before eventId and timestamp are added", () => {
    const result = validateAuditEventDraft({
      eventType: AuditEventType.PERMISSION_CHECKED,
      actor: { type: "system", id: "authz" },
      action: "check_permission",
      resource: { type: "permission", id: "policy-1" },
      result: "denied",
      context: { organizationId: "org-1" },
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects invalid successful events instead of treating them as valid audit writes", () => {
    const result = validateAuditEvent({
      ...nodeAuditEvent,
      actor: { type: "agent", id: "" },
      result: "success",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("actor.id must be a non-empty string");
  });

  it("rejects unknown context fields to keep the contract shape stable", () => {
    const result = validateAuditEvent({
      ...nodeAuditEvent,
      context: { sessionId: "sess-1", debugOnly: "not-contract" },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("context.debugOnly is not part of the audit event contract");
  });
});
