import type { PermissionCheckResult } from "../../../shared/permission/contracts.js";

export type OpenReportNodeType = "open_report";
export type OpenReportTargetType =
  | "final_report"
  | "department_report"
  | "replay";
export type OpenReportFormat = "json" | "md";
export type OpenReportMode = "view" | "download";

export interface OpenReportNodeInput {
  reportType?: OpenReportTargetType;
  workflowId?: string;
  replayId?: string;
  managerId?: string;
  format?: OpenReportFormat;
  openMode?: OpenReportMode;
  agentId?: string;
  token?: string;
}

export interface OpenReportNodeExecutionRequest {
  nodeType: OpenReportNodeType;
  input?: OpenReportNodeInput;
}

export interface OpenReportPermissionEngine {
  checkPermission(
    agentId: string,
    resourceType: "api",
    action: "call",
    resource: string,
    token: string,
  ): PermissionCheckResult;
}

export interface OpenReportNodeAdapterDeps {
  getWorkflow?: (workflowId: string) => { id: string } | undefined;
  readFinalWorkflowReport?: (workflowId: string) => unknown | null;
  getFinalWorkflowReportFilePath?: (
    workflowId: string,
    format: OpenReportFormat,
  ) => string | null;
  getDepartmentReportFilePath?: (
    managerId: string,
    workflowId: string,
    format: OpenReportFormat,
  ) => string | null;
  getReplayTimeline?: (
    replayId: string,
  ) => Promise<{ missionId: string; eventCount: number } | null>;
  permissionEngine?: OpenReportPermissionEngine;
  // 105 cutover: python open runtime owner; Node thin proxy when executePythonRuntime present
  executePythonRuntime?: (input: OpenReportNodeInput) => Promise<any>;
}

export interface OpenReportNodeExecutionResult {
  ok: boolean;
  nodeType: OpenReportNodeType;
  output: {
    status: "completed" | "denied" | "not_found";
    reportType: OpenReportTargetType;
    title: string;
    mode: OpenReportMode;
    resource: string;
    target?: {
      kind: "report" | "replay";
      href: string;
      apiHref: string;
      uiHref?: string;
      downloadHref?: string;
    };
    context: {
      workflowId?: string;
      replayId?: string;
      managerId?: string;
      format?: OpenReportFormat;
    };
    error?: string;
    governance: {
      permission?: {
        allowed: boolean;
        reason?: string;
        suggestion?: string;
      };
    };
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function ensureString(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`Open report node input requires ${field}.`);
  }

  return normalized;
}

function normalizeFormat(value: unknown): OpenReportFormat {
  return value === "json" ? "json" : "md";
}

function normalizeMode(
  reportType: OpenReportTargetType,
  value: unknown,
): OpenReportMode {
  if (reportType === "department_report") {
    return "download";
  }

  return value === "download" ? "download" : "view";
}

function buildWorkflowReportViewPath(workflowId: string): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/report`;
}

function buildWorkflowReportDownloadPath(
  workflowId: string,
  format: OpenReportFormat,
): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/report/download?format=${format}`;
}

function buildDepartmentReportDownloadPath(
  workflowId: string,
  managerId: string,
  format: OpenReportFormat,
): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/report/department/${encodeURIComponent(
    managerId,
  )}/download?format=${format}`;
}

function buildReplayApiPath(replayId: string): string {
  return `/api/replay/${encodeURIComponent(replayId)}`;
}

function buildReplayUiPath(replayId: string): string {
  return `/replay/${encodeURIComponent(replayId)}`;
}

function buildPermissionSummary(
  permission: PermissionCheckResult | undefined,
): OpenReportNodeExecutionResult["output"]["governance"]["permission"] | undefined {
  if (!permission) {
    return undefined;
  }

  return {
    allowed: permission.allowed,
    reason: permission.reason,
    suggestion: permission.suggestion,
  };
}

function buildTitle(reportType: OpenReportTargetType): string {
  switch (reportType) {
    case "final_report":
      return "Workflow final report";
    case "department_report":
      return "Department report";
    case "replay":
      return "Workflow replay";
  }
}

function isWorkflowAvailable(
  workflowId: string,
  deps: OpenReportNodeAdapterDeps,
): boolean {
  if (!deps.getWorkflow) {
    throw new Error("Open report node requires workflow lookup wiring.");
  }

  return Boolean(deps.getWorkflow(workflowId));
}

function buildDeniedResult(
  reportType: OpenReportTargetType,
  mode: OpenReportMode,
  resource: string,
  context: OpenReportNodeExecutionResult["output"]["context"],
  permission: PermissionCheckResult,
): OpenReportNodeExecutionResult {
  return {
    ok: false,
    nodeType: "open_report",
    output: {
      status: "denied",
      reportType,
      title: buildTitle(reportType),
      mode,
      resource,
      context,
      error: permission.reason ?? "Permission denied",
      governance: {
        permission: buildPermissionSummary(permission),
      },
    },
  };
}

function buildNotFoundResult(
  reportType: OpenReportTargetType,
  mode: OpenReportMode,
  resource: string,
  context: OpenReportNodeExecutionResult["output"]["context"],
  error: string,
  permission?: PermissionCheckResult,
): OpenReportNodeExecutionResult {
  return {
    ok: false,
    nodeType: "open_report",
    output: {
      status: "not_found",
      reportType,
      title: buildTitle(reportType),
      mode,
      resource,
      context,
      error,
      governance: {
        permission: buildPermissionSummary(permission),
      },
    },
  };
}

function buildCompletedResult(input: {
  reportType: OpenReportTargetType;
  mode: OpenReportMode;
  resource: string;
  target: NonNullable<OpenReportNodeExecutionResult["output"]["target"]>;
  context: OpenReportNodeExecutionResult["output"]["context"];
  permission?: PermissionCheckResult;
}): OpenReportNodeExecutionResult {
  return {
    ok: true,
    nodeType: "open_report",
    output: {
      status: "completed",
      reportType: input.reportType,
      title: buildTitle(input.reportType),
      mode: input.mode,
      resource: input.resource,
      target: input.target,
      context: input.context,
      governance: {
        permission: buildPermissionSummary(input.permission),
      },
    },
  };
}

function checkApiPermission(
  input: OpenReportNodeInput,
  resource: string,
  deps: OpenReportNodeAdapterDeps,
): PermissionCheckResult | undefined {
  if (!deps.permissionEngine) {
    return undefined;
  }

  const agentId = ensureString(input.agentId, "agentId");
  const token = ensureString(input.token, "token");
  return deps.permissionEngine.checkPermission(
    agentId,
    "api",
    "call",
    resource,
    token,
  );
}

export function isOpenReportNodeType(value: unknown): value is OpenReportNodeType {
  return value === "open_report";
}

export async function executeOpenReportNode(
  request: OpenReportNodeExecutionRequest,
  deps: OpenReportNodeAdapterDeps = {},
): Promise<OpenReportNodeExecutionResult> {
  if (!isOpenReportNodeType(request.nodeType)) {
    throw new Error("Unsupported open_report node type.");
  }

  const input = request.input ?? {};
  // prefer python owned open (page/report) per 105 longtail
  if (deps.executePythonRuntime) {
    try {
      const py = await deps.executePythonRuntime(input);
      return {
        ok: py?.ok !== false,
        nodeType: "open_report",
        output: {
          status: py?.status || "completed",
          reportType: py?.kind || input.reportType || "final_report",
          title: py?.title || "python-report",
          mode: py?.mode || "view",
          resource: py?.resource || "py-report",
          target: py?.target,
          context: py?.context || {},
          governance: py?.governance || {},
        },
      } as any;
    } catch (error: any) {
      return {
        ok: true,
        nodeType: "open_report",
        output: {
          status: "degraded",
          reportType: input.reportType || "final_report",
          title: "py-failed",
          mode: "view",
          resource: "",
          context: {},
          governance: {},
          error: `python open-report visible failure: ${error?.message || error}`,
        },
      } as any;
    }
  }

  const reportType = input.reportType;
  if (
    reportType !== "final_report" &&
    reportType !== "department_report" &&
    reportType !== "replay"
  ) {
    throw new Error(
      "Open report node input requires reportType to be final_report, department_report, or replay.",
    );
  }

  const format = normalizeFormat(input.format);
  const mode = normalizeMode(reportType, input.openMode);
  const workflowId = normalizeString(input.workflowId);
  const managerId = normalizeString(input.managerId);
  const replayId = normalizeString(input.replayId) ?? workflowId;

  if (reportType === "final_report") {
    const normalizedWorkflowId = ensureString(workflowId, "workflowId");
    if (!isWorkflowAvailable(normalizedWorkflowId, deps)) {
      return buildNotFoundResult(
        reportType,
        mode,
        buildWorkflowReportViewPath(normalizedWorkflowId),
        { workflowId: normalizedWorkflowId, format },
        "Workflow not found.",
      );
    }
    if (!deps.readFinalWorkflowReport) {
      throw new Error("Open report node requires final workflow report wiring.");
    }

    const resource =
      mode === "download"
        ? buildWorkflowReportDownloadPath(normalizedWorkflowId, format)
        : buildWorkflowReportViewPath(normalizedWorkflowId);
    const permission = checkApiPermission(input, `GET ${resource}`, deps);
    if (permission && !permission.allowed) {
      return buildDeniedResult(
        reportType,
        mode,
        `GET ${resource}`,
        { workflowId: normalizedWorkflowId, format },
        permission,
      );
    }

    if (mode === "download") {
      if (!deps.getFinalWorkflowReportFilePath) {
        throw new Error("Open report node requires final report download wiring.");
      }
      if (!deps.getFinalWorkflowReportFilePath(normalizedWorkflowId, format)) {
        return buildNotFoundResult(
          reportType,
          mode,
          `GET ${resource}`,
          { workflowId: normalizedWorkflowId, format },
          "Final report file not found.",
          permission,
        );
      }
    } else if (!deps.readFinalWorkflowReport(normalizedWorkflowId)) {
      return buildNotFoundResult(
        reportType,
        mode,
        `GET ${resource}`,
        { workflowId: normalizedWorkflowId, format },
        "Final report not found.",
        permission,
      );
    }

    const viewHref = buildWorkflowReportViewPath(normalizedWorkflowId);
    const downloadHref = buildWorkflowReportDownloadPath(normalizedWorkflowId, format);
    return buildCompletedResult({
      reportType,
      mode,
      resource: `GET ${resource}`,
      target: {
        kind: "report",
        href: mode === "download" ? downloadHref : viewHref,
        apiHref: viewHref,
        downloadHref,
      },
      context: {
        workflowId: normalizedWorkflowId,
        format,
      },
      permission,
    });
  }

  if (reportType === "department_report") {
    const normalizedWorkflowId = ensureString(workflowId, "workflowId");
    const normalizedManagerId = ensureString(managerId, "managerId");
    if (!isWorkflowAvailable(normalizedWorkflowId, deps)) {
      return buildNotFoundResult(
        reportType,
        "download",
        buildDepartmentReportDownloadPath(
          normalizedWorkflowId,
          normalizedManagerId,
          format,
        ),
        {
          workflowId: normalizedWorkflowId,
          managerId: normalizedManagerId,
          format,
        },
        "Workflow not found.",
      );
    }
    if (!deps.getDepartmentReportFilePath) {
      throw new Error("Open report node requires department report wiring.");
    }

    const downloadHref = buildDepartmentReportDownloadPath(
      normalizedWorkflowId,
      normalizedManagerId,
      format,
    );
    const permission = checkApiPermission(input, `GET ${downloadHref}`, deps);
    if (permission && !permission.allowed) {
      return buildDeniedResult(
        reportType,
        "download",
        `GET ${downloadHref}`,
        {
          workflowId: normalizedWorkflowId,
          managerId: normalizedManagerId,
          format,
        },
        permission,
      );
    }

    if (
      !deps.getDepartmentReportFilePath(
        normalizedManagerId,
        normalizedWorkflowId,
        format,
      )
    ) {
      return buildNotFoundResult(
        reportType,
        "download",
        `GET ${downloadHref}`,
        {
          workflowId: normalizedWorkflowId,
          managerId: normalizedManagerId,
          format,
        },
        "Department report file not found.",
        permission,
      );
    }

    return buildCompletedResult({
      reportType,
      mode: "download",
      resource: `GET ${downloadHref}`,
      target: {
        kind: "report",
        href: downloadHref,
        apiHref: downloadHref,
        downloadHref,
      },
      context: {
        workflowId: normalizedWorkflowId,
        managerId: normalizedManagerId,
        format,
      },
      permission,
    });
  }

  const normalizedReplayId = ensureString(replayId, "replayId");
  if (workflowId && !isWorkflowAvailable(workflowId, deps)) {
    return buildNotFoundResult(
      reportType,
      mode,
      `GET ${buildReplayApiPath(normalizedReplayId)}`,
      {
        workflowId,
        replayId: normalizedReplayId,
      },
      "Workflow not found.",
    );
  }
  if (!deps.getReplayTimeline) {
    throw new Error("Open report node requires replay lookup wiring.");
  }

  const apiHref = buildReplayApiPath(normalizedReplayId);
  const uiHref = buildReplayUiPath(normalizedReplayId);
  const permission = checkApiPermission(input, `GET ${apiHref}`, deps);
  if (permission && !permission.allowed) {
    return buildDeniedResult(
      reportType,
      mode,
      `GET ${apiHref}`,
      {
        ...(workflowId ? { workflowId } : {}),
        replayId: normalizedReplayId,
      },
      permission,
    );
  }

  const timeline = await deps.getReplayTimeline(normalizedReplayId);
  if (!timeline || timeline.eventCount <= 0) {
    return buildNotFoundResult(
      reportType,
      mode,
      `GET ${apiHref}`,
      {
        ...(workflowId ? { workflowId } : {}),
        replayId: normalizedReplayId,
      },
      "Replay timeline not found.",
      permission,
    );
  }

  return buildCompletedResult({
    reportType,
    mode,
    resource: `GET ${apiHref}`,
    target: {
      kind: "replay",
      href: uiHref,
      uiHref,
      apiHref,
    },
    context: {
      ...(workflowId ? { workflowId } : {}),
      replayId: normalizedReplayId,
    },
    permission,
  });
}
