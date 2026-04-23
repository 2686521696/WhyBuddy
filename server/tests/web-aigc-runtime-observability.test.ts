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
      metadata: {
        traceId: "trace-runtime-obs-1",
        requestId: "request-runtime-obs-1",
      },
    };

    expect(toReplayExecutionEvent(event)).toMatchObject({
      missionId: "wf-runtime-obs",
      eventType: "AGENT_STOPPED",
      sourceAgent: "end-approved",
      eventData: expect.objectContaining({
        eventKey: "node.completed",
        nodeId: "end-approved",
        metadata: expect.objectContaining({
          traceId: "trace-runtime-obs-1",
          requestId: "request-runtime-obs-1",
          links: expect.objectContaining({
            workflowId: "wf-runtime-obs",
            instanceId: "wf-runtime-obs",
            replayId: "wf-runtime-obs",
            traceId: "trace-runtime-obs-1",
            requestId: "request-runtime-obs-1",
            nodeId: "end-approved",
          }),
        }),
      }),
      metadata: {
        phase: "web_aigc_runtime",
        stageKey: "node.completed",
      },
    });
  });

  it("maps loop iteration events to replay milestones with loop metadata", () => {
    const event: Extract<AgentEvent, { type: "web_aigc_runtime_event" }> = {
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-loop",
      instanceId: "wf-runtime-loop",
      eventKey: "edge.loop_iterated",
      timestamp: "2026-04-22T00:00:00.000Z",
      replayId: "wf-runtime-loop",
      nodeId: "loop-node",
      edgeId: "loop-node->loop-node",
      fromNodeId: "loop-node",
      toNodeId: "loop-node",
      status: "EXECUTING",
      metadata: {
        kind: "loop",
        loopKey: "loop-node->loop-node",
        iterationIndex: 1,
      },
    };

    expect(toReplayExecutionEvent(event)).toMatchObject({
      missionId: "wf-runtime-loop",
      eventType: "MILESTONE_REACHED",
      sourceAgent: "loop-node",
      targetAgent: "loop-node",
      eventData: expect.objectContaining({
        eventKey: "edge.loop_iterated",
        edgeId: "loop-node->loop-node",
        metadata: expect.objectContaining({
          loopKey: "loop-node->loop-node",
          iterationIndex: 1,
        }),
      }),
    });
  });

  it("mirrors variable assignment runtime events into replay milestones and audit records", () => {
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
      workflowId: "wf-runtime-variable",
      instanceId: "wf-runtime-variable",
      eventKey: "variable.assigned",
      timestamp: "2026-04-23T00:00:00.000Z",
      replayId: "wf-runtime-variable",
      missionId: "mission-runtime-variable",
      nodeId: "assign-node",
      status: "EXECUTED",
      metadata: {
        scope: "local",
        target: "scorePassed",
        previousValue: false,
        nextValue: true,
      },
    });

    expect(replayEmit).toHaveBeenCalledTimes(1);
    expect(replayEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "wf-runtime-variable",
        eventType: "MILESTONE_REACHED",
        sourceAgent: "assign-node",
        eventData: expect.objectContaining({
          eventKey: "variable.assigned",
          nodeId: "assign-node",
          metadata: expect.objectContaining({
            scope: "local",
            target: "scorePassed",
            previousValue: false,
            nextValue: true,
            actionId: "variable.assign",
            resourceType: "workflow-variable",
            resourceId: "scorePassed",
            assignmentTarget: "scorePassed",
            assignmentScope: "local",
            assignmentChanged: true,
          }),
        }),
      }),
    );

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AuditEventType.DECISION_MADE,
        action: "Runtime variable assigned: scorePassed",
        resource: {
          type: "workflow-variable",
          id: "scorePassed",
          name: "variable.assigned",
        },
        metadata: expect.objectContaining({
          eventKey: "variable.assigned",
          workflowId: "wf-runtime-variable",
          missionId: "mission-runtime-variable",
          nodeId: "assign-node",
          scope: "local",
          target: "scorePassed",
          previousValue: false,
          nextValue: true,
          actionId: "variable.assign",
          resourceType: "workflow-variable",
          resourceId: "scorePassed",
          assignmentTarget: "scorePassed",
          assignmentScope: "local",
          assignmentChanged: true,
        }),
      }),
    );

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });

  it("keeps variable assignment mirror metadata aligned between replay and audit sinks", () => {
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
      workflowId: "wf-runtime-variable-same",
      instanceId: "wf-runtime-variable-same",
      eventKey: "variable.assigned",
      timestamp: "2026-04-23T00:05:00.000Z",
      replayId: "wf-runtime-variable-same",
      missionId: "mission-runtime-variable-same",
      nodeId: "assign-node",
      checkpointId: "assign-node:checkpoint-1",
      status: "EXECUTED",
      metadata: {
        scope: "temp",
        target: "draftScore",
        previousValue: 80,
        nextValue: 80,
      },
    });

    const replayMetadata = replayEmit.mock.calls[0]?.[0]?.eventData?.metadata;
    const auditMetadata = auditRecord.mock.calls[0]?.[0]?.metadata;

    expect(replayMetadata).toMatchObject({
      scope: "temp",
      target: "draftScore",
      actionId: "variable.assign",
      resourceType: "workflow-variable",
      resourceId: "draftScore",
      assignmentTarget: "draftScore",
      assignmentScope: "temp",
      assignmentChanged: false,
    });
    expect(auditMetadata).toMatchObject({
      scope: "temp",
      target: "draftScore",
      actionId: "variable.assign",
      resourceType: "workflow-variable",
      resourceId: "draftScore",
      assignmentTarget: "draftScore",
      assignmentScope: "temp",
      assignmentChanged: false,
      links: expect.objectContaining({
        workflowId: "wf-runtime-variable-same",
        missionId: "mission-runtime-variable-same",
        instanceId: "wf-runtime-variable-same",
        replayId: "wf-runtime-variable-same",
        nodeId: "assign-node",
      }),
    });

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
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

  it("mirrors completed runtime node events into replay stop and audit success records", () => {
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
      workflowId: "wf-runtime-success",
      instanceId: "wf-runtime-success",
      eventKey: "node.completed",
      timestamp: "2026-04-23T00:00:01.000Z",
      replayId: "wf-runtime-success",
      missionId: "mission-runtime-success",
      nodeId: "slice-node",
      status: "EXECUTED",
      startedAt: "2026-04-23T00:00:00.000Z",
      completedAt: "2026-04-23T00:00:01.000Z",
      durationMs: 1000,
      metadata: {
        observability: {
          eventKey: "content.file_slicing",
          nodeType: "file_slicing",
          chunkCount: 3,
        },
      },
    });

    expect(replayEmit).toHaveBeenCalledTimes(1);
    expect(replayEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "wf-runtime-success",
        eventType: "AGENT_STOPPED",
        eventData: expect.objectContaining({
          eventKey: "node.completed",
          nodeId: "slice-node",
        }),
      }),
    );

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AuditEventType.AGENT_EXECUTED,
        action: "Runtime node completed: slice-node",
        metadata: expect.objectContaining({
          eventKey: "node.completed",
          workflowId: "wf-runtime-success",
          missionId: "mission-runtime-success",
          nodeId: "slice-node",
          durationMs: 1000,
          observability: expect.objectContaining({
            eventKey: "content.file_slicing",
            nodeType: "file_slicing",
            chunkCount: 3,
          }),
        }),
      }),
    );

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });

  it("mirrors jump edge transitions into audit decisions", () => {
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
      workflowId: "wf-runtime-jump",
      instanceId: "wf-runtime-jump",
      eventKey: "edge.transitioned",
      timestamp: "2026-04-23T00:00:00.000Z",
      replayId: "wf-runtime-jump",
      nodeId: "jump-node",
      edgeId: "jump-node->branch-b-entry",
      fromNodeId: "jump-node",
      toNodeId: "branch-b-entry",
      status: "EXECUTING",
      metadata: {
        kind: "jump",
        jumpReason: "route_to_branch_b",
      },
    });

    expect(replayEmit).toHaveBeenCalledTimes(1);
    expect(replayEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "wf-runtime-jump",
        eventType: "MILESTONE_REACHED",
      }),
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AuditEventType.DECISION_MADE,
        action: "Runtime flow jump executed: jump-node -> branch-b-entry",
        metadata: expect.objectContaining({
          eventKey: "edge.transitioned",
          edgeId: "jump-node->branch-b-entry",
          fromNodeId: "jump-node",
          toNodeId: "branch-b-entry",
          kind: "jump",
          jumpReason: "route_to_branch_b",
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

  it("keeps runtime governance metadata when mirroring retry and escalate control events", () => {
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
      workflowId: "wf-runtime-governance",
      instanceId: "wf-runtime-governance",
      eventKey: "instance.retry_requested",
      timestamp: "2026-04-23T00:00:03.000Z",
      replayId: "wf-runtime-governance",
      nodeId: "retry-node",
      status: "EXECUTING",
      metadata: {
        retryMode: "automatic",
        governance: {
          policy: {
            maxAutomaticRetries: 1,
            maxTotalRetries: 1,
          },
          state: {
            automaticRetryCount: 1,
            totalRetryCount: 1,
          },
          remaining: {
            automaticRetries: 0,
            totalRetries: 0,
          },
        },
      },
    });

    mirrorWebAigcRuntimeEvent({
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-governance",
      instanceId: "wf-runtime-governance",
      eventKey: "instance.escalated",
      timestamp: "2026-04-23T00:00:04.000Z",
      replayId: "wf-runtime-governance",
      nodeId: "review-node",
      waitingFor: "human escalation review",
      status: "WAITING_INPUT",
      metadata: {
        requestedBy: "runtime.auto_escalate",
        governance: {
          policy: {
            maxAutomaticRetries: 1,
            maxTotalRetries: 1,
            escalateOnRetryBlocked: true,
          },
          state: {
            automaticRetryCount: 1,
            totalRetryCount: 1,
            lastBlockedReason: "automatic_retry_budget_exhausted",
          },
          remaining: {
            automaticRetries: 0,
            totalRetries: 0,
          },
        },
      },
    });

    expect(replayEmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventData: expect.objectContaining({
          metadata: expect.objectContaining({
            governance: expect.objectContaining({
              remaining: expect.objectContaining({
                automaticRetries: 0,
                totalRetries: 0,
              }),
            }),
          }),
        }),
      }),
    );
    expect(auditRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          governance: expect.objectContaining({
            policy: expect.objectContaining({
              maxAutomaticRetries: 1,
            }),
          }),
        }),
      }),
    );
    expect(auditRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          governance: expect.objectContaining({
            state: expect.objectContaining({
              lastBlockedReason: "automatic_retry_budget_exhausted",
            }),
          }),
        }),
      }),
    );

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });

  it("keeps relation links aligned between replay and audit metadata", () => {
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
      workflowId: "wf-runtime-links",
      instanceId: "wf-runtime-links-instance",
      eventKey: "node.completed",
      timestamp: "2026-04-23T09:00:00.000Z",
      missionId: "mission-runtime-links",
      sessionId: "session-runtime-links",
      replayId: "replay-runtime-links",
      nodeId: "notification-node",
      status: "EXECUTED",
      completedAt: "2026-04-23T09:00:01.000Z",
      metadata: {
        traceId: "trace-runtime-links-1",
        requestId: "request-runtime-links-1",
        lineageId: "lineage-runtime-links-1",
        decisionId: "decision-runtime-links-1",
        artifactId: "artifact-runtime-links-1",
      },
    });

    const replayLinks =
      replayEmit.mock.calls[0]?.[0]?.eventData?.metadata?.links;
    const auditLinks = auditRecord.mock.calls[0]?.[0]?.metadata?.links;

    expect(replayLinks).toMatchObject({
      workflowId: "wf-runtime-links",
      missionId: "mission-runtime-links",
      instanceId: "wf-runtime-links-instance",
      sessionId: "session-runtime-links",
      replayId: "replay-runtime-links",
      nodeId: "notification-node",
      traceId: "trace-runtime-links-1",
      requestId: "request-runtime-links-1",
      lineageId: "lineage-runtime-links-1",
      decisionId: "decision-runtime-links-1",
      artifactId: "artifact-runtime-links-1",
    });
    expect(auditLinks).toMatchObject({
      workflowId: "wf-runtime-links",
      missionId: "mission-runtime-links",
      instanceId: "wf-runtime-links-instance",
      sessionId: "session-runtime-links",
      replayId: "replay-runtime-links",
      nodeId: "notification-node",
      traceId: "trace-runtime-links-1",
      requestId: "request-runtime-links-1",
      lineageId: "lineage-runtime-links-1",
      decisionId: "decision-runtime-links-1",
      artifactId: "artifact-runtime-links-1",
    });

    setWebAigcRuntimeObservabilityDeps({
      replayCollector: null,
      auditCollector: null,
    });
  });

  it("keeps loop termination metadata when mirroring runtime terminate events", () => {
    const event: Extract<AgentEvent, { type: "web_aigc_runtime_event" }> = {
      type: "web_aigc_runtime_event",
      workflowId: "wf-runtime-loop-terminate",
      instanceId: "wf-runtime-loop-terminate",
      eventKey: "instance.terminated",
      timestamp: "2026-04-23T00:00:25.000Z",
      replayId: "wf-runtime-loop-terminate",
      nodeId: "loop-node",
      status: "FORCE_TERMINATED",
      error: "Loop edge loop-node->loop-node exceeded maxDurationMs (10ms).",
      metadata: {
        requestedBy: "runtime.loop_guard",
        trigger: "loop_guard.max_duration",
        loopKey: "loop-node->loop-node",
        iterationIndex: 2,
        maxDurationMs: 10,
        elapsedMs: 25,
        loop: {
          loopKey: "loop-node->loop-node",
          iterationIndex: 1,
          startedAt: "2026-04-23T00:00:00.000Z",
          lastIteratedAt: "2026-04-23T00:00:00.000Z",
        },
      },
    };

    expect(toReplayExecutionEvent(event)).toMatchObject({
      missionId: "wf-runtime-loop-terminate",
      eventType: "ERROR_OCCURRED",
      eventData: expect.objectContaining({
        eventKey: "instance.terminated",
        error: "Loop edge loop-node->loop-node exceeded maxDurationMs (10ms).",
        metadata: expect.objectContaining({
          requestedBy: "runtime.loop_guard",
          trigger: "loop_guard.max_duration",
          loopKey: "loop-node->loop-node",
          iterationIndex: 2,
          loop: expect.objectContaining({
            loopKey: "loop-node->loop-node",
            iterationIndex: 1,
          }),
        }),
      }),
    });
  });
});
