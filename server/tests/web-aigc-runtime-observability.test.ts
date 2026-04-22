import { describe, expect, it, vi } from "vitest";

import { AuditEventType } from "../../shared/audit/contracts.js";
import type { AgentEvent } from "../../shared/workflow-runtime.js";
import {
  mirrorWebAigcRuntimeEvent,
  setWebAigcRuntimeObservabilityDeps,
  toReplayExecutionEvent,
} from "../core/web-aigc-runtime-observability.js";

describe("web-aigc runtime observability bridge", () => {
  it("maps runtime node events to replay execution events", () => {
    const event: Extract<AgentEvent, { type: "web_aigc_runtime_event" }> = {
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-obs",
      instanceId: "wf-runtime-obs",
      eventKey: "node.completed",
      timestamp: "2026-04-22T00:00:00.000Z",
      replayId: "wf-runtime-obs",
      nodeId: "end-approved",
      status: "EXECUTED",
      completedAt: "2026-04-22T00:00:01.000Z",
    };

    expect(toReplayExecutionEvent(event)).toMatchObject({
      missionId: "wf-runtime-obs",
      eventType: "AGENT_STOPPED",
      sourceAgent: "end-approved",
      eventData: expect.objectContaining({
        eventKey: "node.completed",
        nodeId: "end-approved",
      }),
      metadata: {
        phase: "web_aigc_runtime",
        stageKey: "node.completed",
      },
    });
  });

  it("mirrors waiting and failure runtime events into replay and audit collectors", () => {
    const replayEmit = vi.fn();
    const auditRecord = vi.fn();
    setWebAigcRuntimeObservabilityDeps({
      replayCollector: {
        emit: replayEmit,
      },
      auditCollector: {
        record: auditRecord,
      },
    });

    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-obs",
      instanceId: "wf-runtime-obs",
      eventKey: "node.waiting_input",
      timestamp: "2026-04-22T00:00:00.000Z",
      replayId: "wf-runtime-obs",
      nodeId: "selection-node",
      waitingFor: "choose branch",
      checkpointId: "selection-node:2026-04-22T00:00:00.000Z",
      status: "WAITING_INPUT",
    });

    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-obs",
      instanceId: "wf-runtime-obs",
      eventKey: "node.failed",
      timestamp: "2026-04-22T00:00:02.000Z",
      replayId: "wf-runtime-obs",
      nodeId: "llm-node",
      error: "LLM provider unavailable",
      status: "EXCEPTION",
    });

    expect(replayEmit).toHaveBeenCalledTimes(2);
    expect(replayEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        missionId: "wf-runtime-obs",
        eventType: "MILESTONE_REACHED",
      }),
    );
    expect(replayEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        missionId: "wf-runtime-obs",
        eventType: "ERROR_OCCURRED",
      }),
    );

    expect(auditRecord).toHaveBeenCalledTimes(2);
    expect(auditRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: AuditEventType.DECISION_MADE,
        metadata: expect.objectContaining({
          eventKey: "node.waiting_input",
          nodeId: "selection-node",
        }),
      }),
    );
    expect(auditRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: AuditEventType.AGENT_FAILED,
        metadata: expect.objectContaining({
          eventKey: "node.failed",
          nodeId: "llm-node",
          error: "LLM provider unavailable",
        }),
      }),
    );

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });

  it("mirrors terminate, retry, and escalate runtime control events", () => {
    const replayEmit = vi.fn();
    const auditRecord = vi.fn();
    setWebAigcRuntimeObservabilityDeps({
      replayCollector: {
        emit: replayEmit,
      },
      auditCollector: {
        record: auditRecord,
      },
    });

    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-control",
      instanceId: "wf-runtime-control",
      eventKey: "instance.retry_requested",
      timestamp: "2026-04-22T00:00:03.000Z",
      replayId: "wf-runtime-control",
      nodeId: "llm-node",
      status: "EXECUTING",
      metadata: {
        requestedBy: "operator-2",
      },
    });
    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-control",
      instanceId: "wf-runtime-control",
      eventKey: "instance.escalated",
      timestamp: "2026-04-22T00:00:04.000Z",
      replayId: "wf-runtime-control",
      nodeId: "review-node",
      waitingFor: "human escalation review",
      status: "WAITING_INPUT",
      metadata: {
        requestedBy: "operator-3",
      },
    });
    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-control",
      instanceId: "wf-runtime-control",
      eventKey: "instance.terminated",
      timestamp: "2026-04-22T00:00:05.000Z",
      replayId: "wf-runtime-control",
      nodeId: "broken-node",
      error: "Operator terminated broken runtime",
      status: "FORCE_TERMINATED",
      metadata: {
        requestedBy: "operator-1",
      },
    });

    expect(replayEmit).toHaveBeenCalledTimes(3);
    expect(replayEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        missionId: "wf-runtime-control",
        eventType: "MILESTONE_REACHED",
      }),
    );
    expect(replayEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        missionId: "wf-runtime-control",
        eventType: "MILESTONE_REACHED",
      }),
    );
    expect(replayEmit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        missionId: "wf-runtime-control",
        eventType: "ERROR_OCCURRED",
      }),
    );

    expect(auditRecord).toHaveBeenCalledTimes(3);
    expect(auditRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: AuditEventType.DECISION_MADE,
        metadata: expect.objectContaining({
          eventKey: "instance.retry_requested",
        }),
      }),
    );
    expect(auditRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: AuditEventType.DECISION_MADE,
        metadata: expect.objectContaining({
          eventKey: "instance.escalated",
        }),
      }),
    );
    expect(auditRecord).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        eventType: AuditEventType.AGENT_FAILED,
        metadata: expect.objectContaining({
          eventKey: "instance.terminated",
        }),
      }),
    );

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });
});
