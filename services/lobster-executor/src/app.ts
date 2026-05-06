import express from "express";
import type { Request, Response } from "express";
import Dockerode from "dockerode";
import { ZodError } from "zod";
import { EXECUTOR_CONTRACT_VERSION } from "../../../shared/executor/contracts.js";
import {
  EXECUTOR_API_ROUTES,
  type CancelExecutorJobResponse,
  type ExecutorCapabilitiesResponse,
  type PauseExecutorJobResponse,
  type ResumeExecutorJobResponse,
  type ExecutorApiErrorResponse,
} from "../../../shared/executor/api.js";
import { parseDockerHost, readLobsterExecutorConfig } from "./config.js";
import { ExecutorCapabilityError, LobsterExecutorError, NotFoundError } from "./errors.js";
import {
  createLobsterExecutorService,
  type LobsterExecutorService,
} from "./service.js";
import type {
  LobsterExecutorHealthResponse,
  LobsterExecutorJobDetailResponse,
  LobsterExecutorJobsResponse,
  LobsterExecutorSandboxSkillSummary,
  LobsterExecutorSandboxSkillsResponse,
} from "./types.js";
import { SecurityAuditLogger } from "./security-audit.js";
import type { SecurityAuditEntry } from "../../../shared/executor/contracts.js";
import { createExecutorCapabilities } from "./capabilities.js";
import {
  SandboxSkillRegistry,
  type SandboxSkillRecord,
} from "./skill-registry.js";

function sendError(
  res: Response<ExecutorApiErrorResponse>,
  error: unknown
): Response<ExecutorApiErrorResponse> {
  if (error instanceof LobsterExecutorError) {
    if (error instanceof ExecutorCapabilityError) {
      return res.status(error.statusCode).json({
        ok: false,
        error: error.message,
        code: error.code,
        unsupportedCapabilities: error.unsupportedCapabilities,
        supportedCapabilities: error.supportedCapabilities,
        hint: error.hint,
      });
    }

    return res.status(error.statusCode).json({ ok: false, error: error.message });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: error.issues.map(issue => issue.message).join("; "),
    });
  }

  const message =
    error instanceof Error
      ? error.message
      : "Unexpected lobster executor error";
  return res.status(500).json({ ok: false, error: message });
}

function summarizeSandboxSkill(
  record: SandboxSkillRecord,
): LobsterExecutorSandboxSkillSummary {
  return {
    name: record.manifest.name,
    version: record.manifest.version,
    description: record.manifest.description,
    enabled: record.manifest.enabled,
    compatible: record.compatible,
    capabilities: record.manifest.capabilities,
    runtime: record.manifest.runtime,
    entrypoint: record.manifest.entrypoint,
    security: record.manifest.security,
    errors: record.errors,
  };
}

export function createLobsterExecutorApp(
  service: LobsterExecutorService = createLobsterExecutorService({
    dataRoot: readLobsterExecutorConfig().dataRoot,
  })
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  async function resolveDockerStatus(
    config = service.getConfig(),
    effectiveMode = service.getExecutionMode(),
  ): Promise<"connected" | "disconnected"> {
    if (effectiveMode !== "real") return "disconnected";
    try {
      const docker = new Dockerode(parseDockerHost(config.dockerHost));
      await docker.ping();
      return "connected";
    } catch {
      return "disconnected";
    }
  }

  app.get("/health", async (_req, res: Response<LobsterExecutorHealthResponse>) => {
    const config = service.getConfig();
    const effectiveMode = service.getExecutionMode();
    const dockerStatus = await resolveDockerStatus(config, effectiveMode);
    const capabilities = createExecutorCapabilities(
      { ...config, executionMode: effectiveMode },
      { dockerStatus },
    );

    res.json({
      ok: true,
      status: "ok",
      service: config.serviceName,
      version: EXECUTOR_CONTRACT_VERSION,
      timestamp: new Date().toISOString(),
      dataRoot: service.getDataRoot(),
      queue: service.getQueueStats(),
      docker: {
        status: dockerStatus,
        host: config.dockerHost,
      },
      features: {
        health: true,
        createJob: true,
        jobQuery: true,
        cancelJob: true,
        dockerLifecycle: effectiveMode === "real" && dockerStatus === "connected",
        callbackSigning: config.callbackSecret !== "",
      },
      capabilitiesSummary: {
        total: capabilities.capabilities.length,
        capabilities: capabilities.capabilities.slice(0, 12),
        warnings: capabilities.warnings,
      },
      aiCapability: {
        enabled: !!process.env.LLM_API_KEY,
        image: config.aiImage,
        llmProvider: process.env.LLM_BASE_URL || "openai",
      },
    });
  });

  app.get(
    EXECUTOR_API_ROUTES.capabilities,
    async (_req, res: Response<ExecutorCapabilitiesResponse>) => {
      const config = service.getConfig();
      const effectiveMode = service.getExecutionMode();
      const dockerStatus = await resolveDockerStatus(config, effectiveMode);
      const skillRegistry = new SandboxSkillRegistry(config.skillRoot);
      const skillSnapshot = skillRegistry.snapshot();
      const capabilities = createExecutorCapabilities(
        { ...config, executionMode: effectiveMode },
        { dockerStatus },
      );
      res.json({
        ok: true,
        capabilities: {
          ...capabilities,
          skills: {
            root: skillSnapshot.root,
            count: skillSnapshot.skills.filter(
              skill => skill.compatible && !skill.disabled,
            ).length,
            capabilityIndex: skillSnapshot.capabilityIndex,
          },
        },
      });
    },
  );

  app.get(
    "/api/executor/skills",
    (_req, res: Response<LobsterExecutorSandboxSkillsResponse>) => {
      const registry = new SandboxSkillRegistry(service.getConfig().skillRoot);
      const snapshot = registry.snapshot();
      res.json({
        ok: true,
        root: snapshot.root,
        skills: snapshot.skills.map(summarizeSandboxSkill),
        capabilityIndex: snapshot.capabilityIndex,
      });
    },
  );

  app.get(
    EXECUTOR_API_ROUTES.createJob,
    (_req, res: Response<LobsterExecutorJobsResponse>) => {
      res.json({
        ok: true,
        jobs: service.listJobs(),
      });
    }
  );

  app.get(
    `${EXECUTOR_API_ROUTES.createJob}/:id`,
    (
      req: Request<{ id: string }>,
      res: Response<LobsterExecutorJobDetailResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        res.json({
          ok: true,
          job: service.getJob(req.params.id),
        });
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(EXECUTOR_API_ROUTES.createJob, (req, res: Response) => {
    try {
      const response = service.submit(req.body);
      res.status(202).json(response);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post(
    EXECUTOR_API_ROUTES.cancelJob,
    async (
      req: Request<{ id: string }>,
      res: Response<CancelExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.cancel(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    EXECUTOR_API_ROUTES.pauseJob,
    async (
      req: Request<{ id: string }>,
      res: Response<PauseExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.pause(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  app.post(
    EXECUTOR_API_ROUTES.resumeJob,
    async (
      req: Request<{ id: string }>,
      res: Response<ResumeExecutorJobResponse | ExecutorApiErrorResponse>
    ) => {
      try {
        const response = await service.resume(req.params.id, req.body);
        res.json(response);
      } catch (error) {
        sendError(res, error);
      }
    }
  );

  // ── Security audit route (Task 4.3) ──
  app.get(
    "/api/executor/security-audit",
    (
      req: Request<unknown, unknown, unknown, { jobId?: string }>,
      res: Response<{ ok: true; entries: SecurityAuditEntry[] } | ExecutorApiErrorResponse>,
    ) => {
      try {
        const config = readLobsterExecutorConfig();
        const auditLogger = new SecurityAuditLogger(config.dataRoot);
        const { jobId } = req.query;
        const entries = jobId
          ? auditLogger.getByJobId(jobId)
          : auditLogger.getAll();
        res.json({ ok: true, entries });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  app.use((_req, res: Response<ExecutorApiErrorResponse>) =>
    res.status(404).json({
      ok: false,
      error: new NotFoundError("Executor route not found").message,
    })
  );

  return app;
}
