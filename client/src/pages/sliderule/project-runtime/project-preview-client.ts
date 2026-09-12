import type { PreviewDescriptor } from "@shared/project-runtime.generated";

export interface ProjectPreviewReference {
  projectId?: string | null;
  projectRevision?: string | null;
  /** Current sessions follow server authority; history remains explicitly pinned. */
  revisionMode?: "current" | "pinned";
}

export interface ProjectPreviewSnapshot {
  operationId: string | null;
  descriptor: PreviewDescriptor | null;
  available: boolean;
  reason: string | null;
}

export interface ProjectPreviewTicket {
  projectId: string;
  operationId: string;
  runtimeId: string;
  revision: string;
  entryUrl: string;
  ticketExpiresAt: string;
  accessExpiresAt: string;
}

const BASE = "/api/sliderule";

export class ProjectPreviewError extends Error {}

async function request(path: string, signal: AbortSignal, method = "GET") {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    // The provider's response body is not a user-facing error or a safe log.
    const message =
      response.status === 401
        ? "请登录后查看工程预览。"
        : response.status === 403 || response.status === 404
          ? "工程不存在或当前账号无权预览。"
          : response.status === 409 || response.status === 410
            ? "运行或预览授权已变化，请重新查看状态。"
            : response.status === 503
              ? "工程预览服务尚未启用或暂时不可用。"
              : "暂时无法读取工程预览，请稍后重试。";
    throw new ProjectPreviewError(message);
  }
  return response.json();
}

const statuses = new Set([
  "provisioning",
  "syncing",
  "installing",
  "executing",
  "starting",
  "ready",
  "stopping",
  "stopped",
  "expired",
  "failed",
  "reconciling",
]);

export async function getProjectPreview(
  projectId: string,
  signal: AbortSignal
): Promise<ProjectPreviewSnapshot> {
  const body = await request(
    `/projects/${encodeURIComponent(projectId)}/preview`,
    signal
  );
  const descriptor = body?.descriptor;
  if (
    typeof body?.available !== "boolean" ||
    !(body.operationId === null || typeof body.operationId === "string") ||
    !(
      descriptor === null ||
      (descriptor?.kind === "project" &&
        descriptor.projectId === projectId &&
        typeof descriptor.runtimeId === "string" &&
        typeof descriptor.revision === "string" &&
        statuses.has(descriptor.status))
    )
  ) {
    throw new ProjectPreviewError("工程预览状态不完整，请重新查看状态。");
  }
  return {
    operationId: body.operationId,
    descriptor,
    available: body.available,
    reason: typeof body.reason === "string" ? body.reason : null,
  };
}

export async function requestProjectPreviewTicket(
  operationId: string,
  signal: AbortSignal
): Promise<ProjectPreviewTicket> {
  const body = await request(
    `/project-operations/${encodeURIComponent(operationId)}/preview-ticket`,
    signal,
    "POST"
  );
  if (
    body?.operationId !== operationId ||
    ![body?.projectId, body?.runtimeId, body?.revision].every(
      value => typeof value === "string" && value.length > 0
    )
  ) {
    throw new ProjectPreviewError(
      "预览授权与当前工程版本不一致，请更新状态后重试。"
    );
  }
  if (
    typeof body?.entryUrl !== "string" ||
    typeof body.ticketExpiresAt !== "string" ||
    typeof body.accessExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.ticketExpiresAt)) ||
    !Number.isFinite(Date.parse(body.accessExpiresAt)) ||
    Date.parse(body.ticketExpiresAt) <= Date.now() ||
    Date.parse(body.accessExpiresAt) < Date.parse(body.ticketExpiresAt)
  ) {
    throw new ProjectPreviewError("预览授权已过期，请重新打开预览。");
  }
  return {
    projectId: body.projectId,
    operationId: body.operationId,
    runtimeId: body.runtimeId,
    revision: body.revision,
    entryUrl: body.entryUrl,
    ticketExpiresAt: body.ticketExpiresAt,
    accessExpiresAt: body.accessExpiresAt,
  };
}

/** Generated code must never share the workbench's cookies or origin. */
export function isolatedPreviewUrl(
  value: string,
  workbenchUrl: string
): string {
  try {
    const url = new URL(value);
    const workbench = new URL(workbenchUrl);
    const loopback = (host: string) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
      host.endsWith(".localhost");
    const localPair = loopback(url.hostname) && loopback(workbench.hostname);
    const localHttp = url.protocol === "http:" && localPair;
    if (
      url.origin === workbench.origin ||
      (url.hostname === workbench.hostname && !localPair) ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !localHttp)
    )
      throw new Error();
    return url.href;
  } catch {
    throw new ProjectPreviewError("预览地址未满足独立来源要求，暂时无法打开。");
  }
}
