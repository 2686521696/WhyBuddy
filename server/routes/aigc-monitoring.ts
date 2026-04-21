import { Router } from "express";

import type {
  AigcMonitoringApiEnvelope,
  AigcMonitoringInstanceListQuery,
} from "../../shared/aigc-monitoring.js";
import db from "../db/index.js";
import {
  buildMonitoringInstanceDetail,
  buildMonitoringInstanceListResponse,
  buildMonitoringSessionDetail,
  buildMonitoringTerminateResult,
  toMonitoringExecutionStatus,
} from "../core/aigc-monitoring-projection.js";
import { buildWorkflowGraphInstanceSnapshot } from "../core/workflow-graph-projection.js";
import { resolveWorkflowMission } from "../core/mission-enrichment-bridge.js";
import { createMissionOperatorService } from "../tasks/mission-operator-service.js";
import { missionRuntime } from "../tasks/mission-runtime.js";

const router = Router({ mergeParams: true });
const operatorService = createMissionOperatorService(missionRuntime);

function ok<T>(data: T, message?: string): AigcMonitoringApiEnvelope<T> {
  return {
    success: true,
    data,
    ...(message ? { message } : {}),
  };
}

function parseWorkflowById(rawId: string) {
  const workflow = db.getWorkflow(rawId);
  return workflow;
}

router.get("/instances", (req, res) => {
  const query: AigcMonitoringInstanceListQuery = {
    name: typeof req.query.name === "string" ? req.query.name : undefined,
    code: typeof req.query.code === "string" ? req.query.code : undefined,
    version:
      req.query.version !== undefined ? Number(req.query.version) : undefined,
    executor:
      typeof req.query.executor === "string" ? req.query.executor : undefined,
    instanceUuid:
      typeof req.query.instanceUuid === "string"
        ? req.query.instanceUuid
        : undefined,
    category:
      typeof req.query.category === "string" ? req.query.category : undefined,
    status:
      typeof req.query.status === "string"
        ? toMonitoringExecutionStatus(req.query.status)
        : undefined,
    startTimeFrom:
      typeof req.query.startTimeFrom === "string"
        ? req.query.startTimeFrom
        : undefined,
    startTimeTo:
      typeof req.query.startTimeTo === "string" ? req.query.startTimeTo : undefined,
    endTimeFrom:
      typeof req.query.endTimeFrom === "string" ? req.query.endTimeFrom : undefined,
    endTimeTo:
      typeof req.query.endTimeTo === "string" ? req.query.endTimeTo : undefined,
    page: req.query.page !== undefined ? Number(req.query.page) : undefined,
    size: req.query.size !== undefined ? Number(req.query.size) : undefined,
  };

  const items = db.getWorkflows().map(workflow => {
    const missionId = resolveWorkflowMission(workflow.id);
    const mission = missionId ? missionRuntime.getTask(missionId) : undefined;
    const tasks = db.getTasksByWorkflow(workflow.id);
    const messages = db.getMessagesByWorkflow(workflow.id);
    const instance = buildWorkflowGraphInstanceSnapshot({
      workflow,
      tasks,
      messages,
      mission,
    });

    return {
      workflow,
      mission,
      instance,
    };
  });

  const data = buildMonitoringInstanceListResponse({ items, query });
  res.json(ok(data));
});

router.get("/instances/:instanceId", (req, res) => {
  const workflow = parseWorkflowById(req.params.instanceId);
  if (!workflow) {
    return res.status(404).json({ success: false, message: "Instance not found" });
  }

  const tasks = db.getTasksByWorkflow(workflow.id);
  const messages = db.getMessagesByWorkflow(workflow.id);
  const missionId = resolveWorkflowMission(workflow.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;
  const instance = buildWorkflowGraphInstanceSnapshot({
    workflow,
    tasks,
    messages,
    mission,
  });

  res.json(
    ok(
      buildMonitoringInstanceDetail({
        workflow,
        mission,
        instance,
      })
    )
  );
});

router.get("/instances/:instanceId/session", (req, res) => {
  const workflow = parseWorkflowById(req.params.instanceId);
  if (!workflow) {
    return res.status(404).json({ success: false, message: "Instance not found" });
  }

  const missionId = resolveWorkflowMission(workflow.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;
  const messages = db.getMessagesByWorkflow(workflow.id);

  res.json(
    ok(
      buildMonitoringSessionDetail({
        workflow,
        mission,
        messages,
      })
    )
  );
});

router.post("/instances/:instanceId/terminate", async (req, res) => {
  const workflow = parseWorkflowById(req.params.instanceId);
  if (!workflow) {
    return res.status(404).json({ success: false, message: "Instance not found" });
  }

  const missionId = resolveWorkflowMission(workflow.id);
  if (!missionId) {
    return res
      .status(409)
      .json({ success: false, message: "Instance is not linked to a mission" });
  }

  const mission = missionRuntime.getTask(missionId);
  if (!mission) {
    return res
      .status(404)
      .json({ success: false, message: "Linked mission not found" });
  }

  await operatorService.submit(missionId, {
    action: "terminate",
    requestedBy: "aigc-monitoring",
    reason:
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "Terminated from web-aigc monitoring compatibility API.",
  });

  res.json(
    ok(
      buildMonitoringTerminateResult({
        workflow,
        terminatedAt: new Date().toISOString(),
      })
    )
  );
});

export default router;
