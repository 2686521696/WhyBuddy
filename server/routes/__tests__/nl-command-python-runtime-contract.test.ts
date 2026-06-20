import { describe, expect, it } from "vitest";

import {
  NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION,
  isNLCommandPythonRuntimeResult,
} from "../../../shared/nl-command/contracts.js";

function baseResult(operation: string, payload: Record<string, unknown>) {
  return {
    contractVersion: NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION,
    runtime: "python-contract",
    operation,
    ok: true,
    status: "completed",
    commandId: "cmd-contract-1",
    planId: "plan-contract-1",
    permission: {
      allowed: true,
      reason: "contract test grant",
      auditId: "audit-permission-1",
    },
    audit: {
      eventId: "audit-event-1",
      operationType: `nl_command_${operation}`,
      actorId: "user-contract",
      entityId: "cmd-contract-1",
      entityType: "command",
      timestamp: 1710000000000,
      result: "success",
      metadata: { source: "contract-test" },
    },
    ...payload,
  };
}

describe("NL command Python runtime contract", () => {
  it("accepts analyze, clarify, plan, approval, and report result shapes", () => {
    const analyze = baseResult("analyze", {
      analysis: {
        intent: "Migrate NL command contract",
        entities: [],
        constraints: [],
        objectives: ["Lock the Python runtime shape"],
        risks: [],
        assumptions: ["Contract only"],
        confidence: 0.74,
        needsClarification: false,
      },
    });
    const clarify = baseResult("clarify", {
      clarification: {
        dialogId: "dialog-contract-1",
        commandId: "cmd-contract-1",
        questions: [
          {
            questionId: "q-1",
            text: "Which runtime boundary should be locked?",
            type: "single_choice",
            options: ["contract only", "full execution"],
          },
        ],
        answers: [],
        clarificationRounds: 0,
        status: "active",
      },
    });
    const plan = baseResult("plan", {
      plan: {
        planId: "plan-contract-1",
        commandId: "cmd-contract-1",
        status: "pending_approval",
        summary: "Contract-only NL command plan.",
        steps: [
          {
            stepId: "step-1",
            title: "Define contract",
            kind: "contract",
          },
        ],
      },
    });
    const approval = baseResult("approval", {
      approval: {
        requestId: "approval-contract-1",
        planId: "plan-contract-1",
        status: "pending",
        requiredApprovers: ["manager"],
        approvals: [],
      },
    });
    const report = baseResult("report", {
      report: {
        reportId: "report-contract-1",
        planId: "plan-contract-1",
        summary: "Python runtime contract was projected.",
        sections: {
          summary: "Contract only.",
          progress: "No command execution.",
          risk: "Execution remains Node-owned.",
        },
      },
    });

    for (const result of [analyze, clarify, plan, approval, report]) {
      expect(isNLCommandPythonRuntimeResult(result)).toBe(true);
      expect(result.permission.auditId).toBe("audit-permission-1");
      expect(result.audit.metadata).toEqual({ source: "contract-test" });
    }
  });

  it("does not let denied permission masquerade as allowed completion", () => {
    const denied = {
      contractVersion: NL_COMMAND_PYTHON_RUNTIME_CONTRACT_VERSION,
      runtime: "python-contract",
      operation: "plan",
      ok: false,
      status: "permission_denied",
      commandId: "cmd-contract-1",
      planId: "plan-contract-1",
      permission: {
        allowed: false,
        reason: "viewer cannot plan",
        auditId: "audit-denied-1",
      },
      audit: {
        eventId: "audit-event-1",
        operationType: "nl_command_plan",
        actorId: "user-contract",
        entityId: "cmd-contract-1",
        entityType: "command",
        timestamp: 1710000000000,
        result: "failure",
      },
      error: {
        code: "permission_denied",
        message: "NL command runtime denied by permission guard.",
      },
    };
    const mutatedAllowed = {
      ...denied,
      ok: true,
      status: "completed",
      plan: {
        planId: "plan-contract-1",
        commandId: "cmd-contract-1",
        status: "pending_approval",
        summary: "This must not validate.",
        steps: [],
      },
    };

    expect(isNLCommandPythonRuntimeResult(denied)).toBe(true);
    expect(isNLCommandPythonRuntimeResult(mutatedAllowed)).toBe(false);
  });

  it("rejects mismatched operation payloads instead of flattening them", () => {
    expect(
      isNLCommandPythonRuntimeResult(
        baseResult("report", {
          plan: {
            planId: "plan-contract-1",
            commandId: "cmd-contract-1",
            status: "pending_approval",
            summary: "Wrong payload field.",
            steps: [],
          },
        }),
      ),
    ).toBe(false);
  });
});
