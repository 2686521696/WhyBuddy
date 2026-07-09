/**
 * Blueprint trust-layer 子域：可追溯矩阵（EP_MATRIX）只读读取封装。
 *
 * `autopilot-v4-frontend-alignment` 需求 1：
 * - 1.3 GET `/api/blueprint/jobs/:jobId/traceability-matrix`；`format==="markdown"` 时
 *   请求并返回 markdown 文本，否则返回 JSON 矩阵。
 * - 1.4 404（`matrix_not_generated` / `job_not_found`）→ 结构化非抛出结果，区分
 *   "尚未生成" 与传输错误。
 * - 1.5 复用 `@shared/blueprint/traceability-matrix/types`，不重复定义。
 * - 1.6 只读：不发起写请求，不修改后端状态。
 *
 * 服务端路由 `server/routes/blueprint/traceability-matrix/route.ts` 的 JSON 分支返回
 * `{ ...matrix, stale }`（矩阵字段直接平铺，并非 `{ matrix }` 包裹），因此 JSON 分支
 * 直接把响应体作为 `TraceabilityMatrix`（仍做一层防御性解包，兼容潜在的 `{ matrix }`）。
 * Markdown 分支由 `?format=markdown` 查询参数驱动（与路由实现一致），以纯文本读取。
 */

import { fetchJsonSafe, type ApiRequestError } from "../api-client.js";
import type { TraceabilityMatrix } from "@shared/blueprint/traceability-matrix/types";

export type FetchTraceabilityMatrixResult =
  | { ok: true; kind: "json"; data: TraceabilityMatrix }
  | { ok: true; kind: "markdown"; data: string }
  | { ok: false; notGenerated: boolean; error: ApiRequestError };

const NOT_GENERATED_CODES: ReadonlySet<string> = new Set([
  "matrix_not_generated",
  "job_not_found",
]);

function isNotGenerated(
  status: number | undefined,
  message: string | undefined
): boolean {
  return status === 404 && !!message && NOT_GENERATED_CODES.has(message);
}

/** 防御性解包：服务端平铺返回矩阵，同时兼容潜在的 `{ matrix }` 包裹。 */
function unwrapMatrix(body: unknown): TraceabilityMatrix {
  if (body && typeof body === "object" && "matrix" in body) {
    const inner = (body as { matrix?: unknown }).matrix;
    if (inner && typeof inner === "object") {
      return inner as TraceabilityMatrix;
    }
  }
  return body as TraceabilityMatrix;
}

function extractErrorCode(rawText: string): string | undefined {
  if (!rawText.trim()) return undefined;
  try {
    const parsed = JSON.parse(rawText) as { error?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // not JSON, fall through
  }
  return undefined;
}

async function fetchTraceabilityMatrixMarkdown(
  jobId: string,
  options?: RequestInit
): Promise<FetchTraceabilityMatrixResult> {
  const endpoint = `/api/blueprint/jobs/${encodeURIComponent(jobId)}/traceability-matrix?format=markdown`;
  const headers = new Headers(options?.headers);
  headers.set("Accept", "text/markdown");

  let response: Response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch {
    return {
      ok: false,
      notGenerated: false,
      error: {
        kind: "error",
        source: "network",
        endpoint,
        message: "The traceability matrix export is unreachable.",
        detail:
          "Check whether the backend service is running, then retry the markdown export.",
        retryable: true,
      },
    };
  }

  const rawText = await response.text();

  if (!response.ok) {
    const code = extractErrorCode(rawText);
    return {
      ok: false,
      notGenerated: isNotGenerated(response.status, code),
      error: {
        kind: "error",
        source: "http",
        endpoint,
        status: response.status,
        message: code ?? `Request failed with status ${response.status}.`,
        detail:
          "The markdown export request completed, but the server reported an error.",
        retryable: response.status >= 500 || response.status === 429,
      },
    };
  }

  return { ok: true, kind: "markdown", data: rawText };
}

export async function fetchTraceabilityMatrix(
  jobId: string,
  format?: "json" | "markdown",
  options?: RequestInit
): Promise<FetchTraceabilityMatrixResult> {
  if (format === "markdown") {
    return fetchTraceabilityMatrixMarkdown(jobId, options);
  }

  const result = await fetchJsonSafe<unknown>(
    `/api/blueprint/jobs/${encodeURIComponent(jobId)}/traceability-matrix`,
    options
  );

  if (!result.ok) {
    return {
      ok: false,
      notGenerated: isNotGenerated(result.error.status, result.error.message),
      error: result.error,
    };
  }

  return { ok: true, kind: "json", data: unwrapMatrix(result.data) };
}
