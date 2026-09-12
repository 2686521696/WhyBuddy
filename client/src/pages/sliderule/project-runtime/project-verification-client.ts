import type {
  ProjectOperationView,
  VerificationRecord,
  VerificationSnapshot,
} from "@shared/project-runtime.generated";

export interface ProjectVerificationView {
  operationId: string | null;
  operationStatus: string | null;
  snapshot: VerificationSnapshot | null;
}

export class ProjectVerificationError extends Error {}

const BASE = "/api/sliderule";
const recordStatuses = new Set([
  "running",
  "passed",
  "failed",
  "blocked",
  "cancelled",
]);
const effectiveStatuses = new Set([...recordStatuses, "stale"]);
const operationStatuses = new Set([
  "queued",
  "running",
  "waiting_user",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
]);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

async function request(
  path: string,
  signal: AbortSignal,
  method = "GET",
  body?: object
): Promise<any> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    // A provider response can contain URLs, headers or generated page text.
    // HTTP status is sufficient to explain recovery without exposing that body.
    const message =
      response.status === 401
        ? "请登录后查看工程检查。"
        : response.status === 403 || response.status === 404
          ? "工程不存在或当前账号无权检查。"
          : response.status === 409 || response.status === 410
            ? "工程版本、计划或运行状态已变化，请更新状态后重试。"
            : response.status === 503
              ? "浏览器检查服务尚未启用或暂时不可用。"
              : "暂时无法连接工程检查服务，请稍后重试。";
    throw new ProjectVerificationError(message);
  }
  return response.json();
}

function validRecord(
  record: any,
  projectId: string
): record is VerificationRecord {
  return (
    record?.projectId === projectId &&
    [
      record.verificationId,
      record.operationId,
      record.runtimeOperationId,
      record.runtimeId,
      record.revision,
      record.treeHash,
      record.planRef,
      record.suiteVersion,
      record.createdAt,
      record.startedAt,
    ].every(nonempty) &&
    (record.specRevision === null || nonempty(record.specRevision)) &&
    (record.completedAt === null || nonempty(record.completedAt)) &&
    (record.errorCode === null || nonempty(record.errorCode)) &&
    recordStatuses.has(record.status) &&
    Array.isArray(record.assertions) &&
    record.assertions.every(
      (item: any) =>
        nonempty(item?.id) && ["passed", "failed"].includes(item.status)
    ) &&
    Array.isArray(record.artifactRefs)
  );
}

export async function getProjectVerification(
  projectId: string,
  signal: AbortSignal
): Promise<ProjectVerificationView> {
  const body = await request(
    `/projects/${encodeURIComponent(projectId)}/verification`,
    signal
  );
  const snapshot = body?.snapshot;
  const valid =
    (body?.operationId === null || nonempty(body?.operationId)) &&
    (body?.operationStatus === null ||
      operationStatuses.has(body?.operationStatus)) &&
    (snapshot === null ||
      (snapshot?.deliveryEligible === false &&
        effectiveStatuses.has(snapshot.effectiveStatus) &&
        validRecord(snapshot.verification, projectId) &&
        snapshot.verification.operationId === body.operationId &&
        (snapshot.effectiveStatus !== "passed" ||
          (snapshot.verification.status === "passed" &&
            (snapshot.verification.assertions?.length ?? 0) > 0 &&
            snapshot.verification.assertions?.every(
              (item: any) => item.status === "passed"
            )))));
  if (!valid)
    throw new ProjectVerificationError(
      "工程检查状态不完整，请更新状态后重试。"
    );
  return {
    operationId: body.operationId,
    operationStatus: body.operationStatus,
    snapshot,
  };
}

export async function requestProjectVerification(
  runtimeOperationId: string,
  expectedRevision: string,
  idempotencyKey: string,
  signal: AbortSignal
): Promise<{ operationId: string; status: ProjectOperationView["status"] }> {
  const body = await request(
    `/project-operations/${encodeURIComponent(runtimeOperationId)}/verify`,
    signal,
    "POST",
    { expectedRevision, idempotencyKey }
  );
  if (!nonempty(body?.operationId) || !operationStatuses.has(body?.status))
    throw new ProjectVerificationError(
      "检查请求状态不完整，请更新状态后重试。"
    );
  return { operationId: body.operationId, status: "queued" };
}

export async function cancelProjectVerification(
  operationId: string,
  signal: AbortSignal
): Promise<void> {
  await request(
    `/project-operations/${encodeURIComponent(operationId)}/cancel`,
    signal,
    "POST"
  );
}
