import { describe, expect, it } from "vitest";

import {
  PERMISSION_MANAGEMENT_CONTRACT_VERSION,
  normalizePermissionManagementBoundaryResponse,
  type PermissionManagementBoundaryRequest,
} from "../../shared/permission/contracts.js";
import { toPermissionManagementRouteResult } from "./management-python-boundary.js";

describe("permission route management Python boundary", () => {
  it("defines explicit unsupported role management without mapping to success", () => {
    const request: PermissionManagementBoundaryRequest = {
      operation: "role.create",
      payload: {
        roleId: "auditor",
        roleName: "Auditor",
        permissions: [],
      },
    };
    const response = normalizePermissionManagementBoundaryResponse({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "role.create",
      domain: "role",
      ok: false,
      status: "unsupported",
      reason: "/api/permissions role management remains Node-owned",
      error: {
        code: "node_owned",
        message: "Permission route management is owned by Node",
      },
    });

    expect(request.operation).toBe("role.create");
    expect(response).toMatchObject({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "role.create",
      domain: "role",
      ok: false,
      status: "unsupported",
    });
    expect(response.error?.code).toBe("node_owned");
  });

  it("defines explicit unsupported policy management without dropping denied permissions", () => {
    const response = normalizePermissionManagementBoundaryResponse({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "policy.assign",
      domain: "policy",
      ok: false,
      status: "unsupported",
      reason: "/api/permissions policy management remains Node-owned",
      error: {
        code: "node_owned",
        message: "Permission route management is owned by Node",
      },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe("unsupported");
    expect(response.domain).toBe("policy");
  });

  it("defines explicit unsupported token management without verifying tokens", () => {
    const response = normalizePermissionManagementBoundaryResponse({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "token.verify",
      domain: "token",
      ok: false,
      status: "unsupported",
      reason: "/api/permissions token management remains Node-owned",
      error: {
        code: "node_owned",
        message: "Permission route management is owned by Node",
      },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe("unsupported");
    expect(response.domain).toBe("token");
  });

  it("normalizes malformed success-shaped responses to error", () => {
    const response = normalizePermissionManagementBoundaryResponse({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "role.create",
      domain: "role",
      ok: true,
      status: "unsupported",
      reason: "conflicting shape",
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("invalid_response");
  });

  it("keeps unsupported, conflict, and error responses as failing route results", () => {
    const unsupported = toPermissionManagementRouteResult({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "role.create",
      domain: "role",
      ok: false,
      status: "unsupported",
      reason: "Node-owned",
      error: { code: "node_owned", message: "Node-owned" },
    });
    const conflict = toPermissionManagementRouteResult({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "policy.assign",
      domain: "policy",
      ok: false,
      status: "conflict",
      reason: "Conflicting permission rules",
      error: { code: "conflict", message: "Conflicting permission rules" },
    });
    const malformed = toPermissionManagementRouteResult({
      contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
      source: "python_boundary",
      operation: "token.verify",
      domain: "token",
      ok: true,
      status: "error",
      reason: "bad shape",
    });

    expect(unsupported).toEqual({
      ok: false,
      status: 501,
      error: "Node-owned",
    });
    expect(conflict).toEqual({
      ok: false,
      status: 409,
      error: "Conflicting permission rules",
    });
    expect(malformed).toEqual({
      ok: false,
      status: 500,
      error: "Invalid permission management boundary response",
    });
  });
});
