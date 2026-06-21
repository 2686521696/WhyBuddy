import {
  normalizePermissionManagementBoundaryResponse,
  type PermissionManagementBoundaryResponse,
} from "../../shared/permission/contracts.js";

export interface PermissionManagementRouteResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function toPermissionManagementRouteResult(
  value: unknown,
): PermissionManagementRouteResult {
  const response = normalizePermissionManagementBoundaryResponse(value, "python_boundary");
  if (response.ok) {
    return { ok: true, status: 200 };
  }

  return {
    ok: false,
    status: statusCodeForBoundaryResponse(response),
    error: response.error?.message ?? response.reason,
  };
}

function statusCodeForBoundaryResponse(response: PermissionManagementBoundaryResponse): number {
  switch (response.status) {
    case "unsupported":
      return 501;
    case "conflict":
      return 409;
    case "error":
      return response.error?.code === "invalid_request" || response.error?.code === "invalid_operation"
        ? 400
        : 500;
    case "supported":
      return response.ok ? 200 : 500;
    default:
      return 500;
  }
}
