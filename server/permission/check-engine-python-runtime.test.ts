import { describe, expect, it } from "vitest";

import {
  PERMISSION_CHECK_CONTRACT_VERSION,
  normalizePermissionCheckContractResponse,
} from "../../shared/permission/contracts.js";
import { toPermissionCheckResultFromContractResponse } from "./check-engine.js";

describe("permission check Python runtime boundary", () => {
  it("normalizes Python runtime allow responses without changing the source", () => {
    const response = normalizePermissionCheckContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_runtime",
      allowed: true,
      decision: "allow",
      reason: "Allowed by explicit allow rule for filesystem:read",
      matchedRule: {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
    });

    expect(response).toMatchObject({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_runtime",
      allowed: true,
      decision: "allow",
      reason: "Allowed by explicit allow rule for filesystem:read",
    });
  });

  it("maps Python runtime allow responses into PermissionCheckResult", () => {
    const result = toPermissionCheckResultFromContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_runtime",
      allowed: true,
      decision: "allow",
      reason: "Allowed by explicit allow rule for filesystem:read",
      matchedRule: {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
    });

    expect(result).toEqual({
      allowed: true,
      reason: "Allowed by explicit allow rule for filesystem:read",
      matchedRule: {
        resourceType: "filesystem",
        action: "read",
        constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
        effect: "allow",
      },
    });
  });

  it("maps Python runtime deny responses without falling back to allow", () => {
    const result = toPermissionCheckResultFromContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_runtime",
      allowed: false,
      decision: "deny",
      reason: "Denied by explicit deny rule for filesystem:write",
      error: {
        code: "explicit_deny",
        message: "Denied by explicit deny rule for filesystem:write",
      },
      matchedRule: {
        resourceType: "filesystem",
        action: "write",
        constraints: {},
        effect: "deny",
      },
    });

    expect(result).toEqual({
      allowed: false,
      reason: "Denied by explicit deny rule for filesystem:write",
      matchedRule: {
        resourceType: "filesystem",
        action: "write",
        constraints: {},
        effect: "deny",
      },
    });
  });

  it("keeps malformed Python runtime responses denied", () => {
    const result = toPermissionCheckResultFromContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_runtime",
      allowed: true,
      reason: "missing decision",
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Invalid permission check contract response");
  });
});
