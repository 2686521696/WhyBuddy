/**
 * Workflow Routes — REST API for workflow management
 */
import { Router } from "express";
import path from "path";
import db from "../db/index.js";
import { getAIConfig } from "../core/ai-config.js";
import { generateWorkflowOrganization } from "../core/dynamic-organization.js";
import { workflowEngine } from "../core/workflow-engine.js";
import { buildWorkflowGraphInstanceSnapshot } from "../core/workflow-graph-projection.js";
import {
  buildWorkflowGraphDefinition,
  buildWorkflowGraphInstance,
  webAigcRuntimeEngine,
} from "../core/workflow-runtime-engine.js";
import { reportStore } from "../memory/report-store.js";
import { serverRuntime } from "../runtime/server-runtime.js";
import { missionRuntime } from "../tasks/mission-runtime.js";
import {
  linkWorkflowToMission,
  resolveWorkflowMission,
} from "../core/mission-enrichment-bridge.js";
import {
  buildWorkflowDirectiveContext,
  buildWorkflowInputSignature,
  normalizeWorkflowAttachments,
  normalizeWorkflowInputProjection,
} from "../../shared/workflow-input.js";

const router = Router();
const ACTIVE_WORKFLOW_STATUSES = ["pending", "running"] as const;
const RECENT_DUPLICATE_WINDOW_MS = 15_000;

function normalizeDirective(directive: string): string {
  return directive.trim().replace(/\s+/g, " ");
}

function getWorkflowInputSignature(workflow: ReturnType<typeof db.getWorkflows>[number]) {
  const signature = workflow.results?.input?.signature;
  return typeof signature === "string" && signature
    ? signature
    : buildWorkflowInputSignature(
        workflow.directive,
        normalizeWorkflowAttachments(workflow.results?.input?.attachments)
      );
}

function withMissionLink<T extends { id: string }>(workflow: T): T & {
  missionId: string | null;
} {
  return {
    ...workflow,
    missionId: resolveWorkflowMission(workflow.id) ?? null,
  };
}

// POST /api/workflows — Start a new workflow
router.post("/organization/preview", async (req, res) => {
  const { directive } = req.body;
  const attachments = normalizeWorkflowAttachments(req.body?.attachments);
  if (!directive || typeof directive !== "string") {
    return res.status(400).json({ error: "directive is required" });
  }

  const normalizedDirective = normalizeDirective(directive);
  if (!normalizedDirective) {
    return res.status(400).json({ error: "directive is required" });
  }

  try {
    const { organization, debug } = await generateWorkflowOrganization({
      workflowId: `preview_${Date.now()}`,
      directive: buildWorkflowDirectiveContext(normalizedDirective, attachments),
      llmProvider: serverRuntime.llmProvider,
      model: getAIConfig().model,
    });
    res.json({ organization, debug });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { directive } = req.body;
  const attachments = normalizeWorkflowAttachments(req.body?.attachments);
  const projection = normalizeWorkflowInputProjection({
    ...(typeof req.body?.projection === "object" && req.body?.projection !== null
      ? req.body.projection
      : {}),
    sessionId:
      typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined,
    sourceApp:
      typeof req.body?.sourceApp === "string" ? req.body.sourceApp : undefined,
  });
  if (!directive || typeof directive !== "string") {
    return res.status(400).json({ error: "directive is required" });
  }

  const normalizedDirective = normalizeDirective(directive);
  const inputSignature = buildWorkflowInputSignature(
    normalizedDirective,
    attachments
  );
  const directiveContext = buildWorkflowDirectiveContext(
    normalizedDirective,
    attachments
  );
  if (!normalizedDirective) {
    return res.status(400).json({ error: "directive is required" });
  }

  try {
    const activeWorkflow = db
      .getWorkflows()
      .find(
        workflow =>
          ACTIVE_WORKFLOW_STATUSES.includes(workflow.status as (typeof ACTIVE_WORKFLOW_STATUSES)[number]) &&
          getWorkflowInputSignature(workflow) === inputSignature
      );
    if (activeWorkflow) {
      return res.json({
        workflowId: activeWorkflow.id,
        missionId: resolveWorkflowMission(activeWorkflow.id) ?? null,
        status: activeWorkflow.status,
        deduped: true,
      });
    }

    const recentWorkflow = db.getWorkflows().find(workflow => {
      const createdAtMs = Date.parse(workflow.created_at);
      if (!Number.isFinite(createdAtMs)) return false;
      return (
        Date.now() - createdAtMs <= RECENT_DUPLICATE_WINDOW_MS &&
        getWorkflowInputSignature(workflow) === inputSignature
      );
    });
    if (recentWorkflow) {
      return res.json({
        workflowId: recentWorkflow.id,
        missionId: resolveWorkflowMission(recentWorkflow.id) ?? null,
        status: recentWorkflow.status,
        deduped: true,
      });
    }

    const workflowId = await workflowEngine.startWorkflow(normalizedDirective, {
      attachments,
      directiveContext,
      inputSignature,
    });
    const workflow = db.getWorkflow(workflowId);
    if (workflow) {
      db.updateWorkflow(workflowId, {
        results: {
          ...(workflow.results || {}),
          input: {
            ...(workflow.results?.input || {}),
            ...(projection?.sessionId ? { sessionId: projection.sessionId } : {}),
            ...(projection?.sourceApp ? { sourceApp: projection.sourceApp } : {}),
            ...(projection ? { projection } : {}),
          },
        },
      });
    }

    // Create a Mission and link it to the workflow so ExecutionBridge can dispatch to Docker
    const mission = missionRuntime.createChatTask(
      normalizedDirective.slice(0, 120),
      normalizedDirective,
      projection?.sessionId,
      {
        workflowId,
        instanceId: workflowId,
        replayId: workflowId,
        sessionId: projection?.sessionId,
        sourceApp: projection?.sourceApp,
      },
    );
    linkWorkflowToMission(workflowId, mission.id);
    missionRuntime.markMissionRunning(mission.id, "execute", `Workflow ${workflowId} started`);

    res.json({ workflowId, missionId: mission.id, status: "running", deduped: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workflows — List all workflows
router.get("/", (_req, res) => {
  const workflows = db.getWorkflows();
  res.json({ workflows: workflows.map(withMissionLink) });
});

// GET /api/workflows/:id — Get workflow details
router.get("/:id", (req, res) => {
  const wf = db.getWorkflow(req.params.id);
  if (!wf) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const messages = db.getMessagesByWorkflow(req.params.id);
  const report = reportStore.readFinalWorkflowReport(req.params.id);

  // Autonomy data — defaults to empty arrays when not available
  const autonomy = (wf.results as any)?.autonomy ?? {
    assessments: [],
    competitions: [],
    taskforces: [],
  };

  res.json({
    workflow: withMissionLink(wf),
    tasks,
    messages,
    report,
    results: { autonomy },
  });
});

// GET /api/workflows/:id/report — Get final workflow report
router.get("/:id/report", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const report = reportStore.readFinalWorkflowReport(req.params.id);
  if (!report) {
    return res.status(404).json({ error: "Final report not found" });
  }

  res.json({ report });
});

// GET /api/workflows/:id/report/download?format=json|md — Download final workflow report
router.get("/:id/report/download", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const format = req.query.format === "json" ? "json" : "md";
  const filePath = reportStore.getFinalWorkflowReportFilePath(
    req.params.id,
    format
  );
  if (!filePath) {
    return res.status(404).json({ error: "Final report file not found" });
  }

  res.download(filePath, path.basename(filePath));
});

// GET /api/workflows/:id/report/department/:managerId/download?format=json|md
router.get("/:id/report/department/:managerId/download", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const manager = db.getAgent(req.params.managerId);
  if (!manager) {
    return res.status(404).json({ error: "Manager not found" });
  }

  const format = req.query.format === "json" ? "json" : "md";
  const filePath = reportStore.getDepartmentReportFilePath(
    req.params.managerId,
    req.params.id,
    format
  );
  if (!filePath) {
    return res.status(404).json({ error: "Department report file not found" });
  }

  res.download(filePath, path.basename(filePath));
});

// GET /api/workflows/:id/tasks — Get tasks for a workflow
router.get("/:id/tasks", (req, res) => {
  const tasks = db.getTasksByWorkflow(req.params.id);
  res.json({ tasks });
});

// GET /api/workflows/:id/messages — Get messages for a workflow
router.get("/:id/messages", (req, res) => {
  const messages = db.getMessagesByWorkflow(req.params.id);
  res.json({ messages });
});

// GET /api/workflows/:id/graph-instance — Get graph instance snapshot
router.get("/:id/graph-instance", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const messages = db.getMessagesByWorkflow(req.params.id);
  const missionId = resolveWorkflowMission(req.params.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;

  const instance = buildWorkflowGraphInstanceSnapshot({
    workflow,
    tasks,
    messages,
    mission,
  });

  res.json({ instance });
});

router.get("/:id/runtime-definition", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const missionId = resolveWorkflowMission(req.params.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;
  const definition = buildWorkflowGraphDefinition({
    workflow,
    tasks,
    mission,
  });

  res.json({ definition });
});

router.get("/:id/runtime-state", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const missionId = resolveWorkflowMission(req.params.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;
  const persisted = webAigcRuntimeEngine.getState(req.params.id, mission);
  if (persisted) {
    return res.json({ state: persisted });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const definition = buildWorkflowGraphDefinition({
    workflow,
    tasks,
    mission,
  });
  const instance = buildWorkflowGraphInstance({
    workflow,
    tasks,
    mission,
    definition,
  });

  res.json({
    state: {
      domainModelVersion: 1,
      definition,
      instance,
      updatedAt: new Date().toISOString(),
    },
  });
});

router.post("/:id/runtime/run", async (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const tasks = db.getTasksByWorkflow(req.params.id);
  const missionId = resolveWorkflowMission(req.params.id);
  const mission = missionId ? missionRuntime.getTask(missionId) : undefined;

  try {
    const definition = buildWorkflowGraphDefinition({
      workflow,
      tasks,
      mission,
    });
    const variables =
      req.body && typeof req.body.variables === "object" && req.body.variables !== null
        ? req.body.variables
        : undefined;
    const maxSteps =
      typeof req.body?.maxSteps === "number" && Number.isFinite(req.body.maxSteps)
        ? req.body.maxSteps
        : undefined;

    const state = await webAigcRuntimeEngine.runToCheckpoint({
      workflowId: req.params.id,
      definition,
      variables,
      maxSteps,
    });

    res.json({ state });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/runtime/resume", async (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  try {
    const payload =
      req.body && typeof req.body.payload === "object" && req.body.payload !== null
        ? req.body.payload
        : {};
    const state = await webAigcRuntimeEngine.resume(req.params.id, payload);
    res.json({ state });
  } catch (err: any) {
    if (typeof err.message === "string" && err.message.includes("not waiting for input")) {
      return res.status(409).json({ error: err.message });
    }
    if (typeof err.message === "string" && err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/runtime/terminate", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  try {
    const state = webAigcRuntimeEngine.terminate(req.params.id, {
      requestedBy:
        typeof req.body?.requestedBy === "string" ? req.body.requestedBy : undefined,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
    });
    res.json({ state });
  } catch (err: any) {
    if (typeof err.message === "string" && err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(409).json({ error: err.message });
  }
});

router.post("/:id/runtime/retry", async (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  try {
    const state = await webAigcRuntimeEngine.retry(req.params.id, {
      requestedBy:
        typeof req.body?.requestedBy === "string" ? req.body.requestedBy : undefined,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      maxSteps:
        typeof req.body?.maxSteps === "number" && Number.isFinite(req.body.maxSteps)
          ? req.body.maxSteps
          : undefined,
    });
    res.json({ state });
  } catch (err: any) {
    if (typeof err.message === "string" && err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(409).json({ error: err.message });
  }
});

router.post("/:id/runtime/escalate", (req, res) => {
  const workflow = db.getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  try {
    const state = webAigcRuntimeEngine.escalate(req.params.id, {
      requestedBy:
        typeof req.body?.requestedBy === "string" ? req.body.requestedBy : undefined,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
    });
    res.json({ state });
  } catch (err: any) {
    if (typeof err.message === "string" && err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(409).json({ error: err.message });
  }
});

// GET /api/workflows/:id/nodes/:nodeId/skills — 查询节点的 Skill 列表
router.get("/:id/nodes/:nodeId/skills", (req, res) => {
  const wf = db.getWorkflow(req.params.id);
  if (!wf) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const organization = wf.results?.organization as
    | { nodes?: Array<{ id: string; skills?: Array<{ id: string; name: string; summary: string; prompt: string }> }> }
    | undefined;

  const node = organization?.nodes?.find(n => n.id === req.params.nodeId);
  if (!node) {
    return res.status(404).json({ error: "Node not found" });
  }

  res.json({ skills: node.skills || [] });
});

export default router;
