import { describe, expect, it } from "vitest";

import {
  PERMISSION_CHECK_CONTRACT_VERSION,
  normalizePermissionCheckContractResponse,
  type PermissionCheckContractRequest,
  type PermissionCheckContractResponse,
} from "../../shared/permission/contracts.js";

describe("permission check Python contract", () => {
  it("defines the shared request and response shape", () => {
    const request: PermissionCheckContractRequest = {
      agentId: "agent-contract",
      resourceType: "filesystem",
      action: "read",
      resource: "/sandbox/agent_contract/workspace/file.txt",
      context: { agentId: "agent-contract" },
      policy: {
        permissionMatrix: [
          {
            resourceType: "filesystem",
            actions: ["read"],
            constraints: { pathPatterns: ["/sandbox/agent_*/workspace/**"] },
            effect: "allow",
          },
        ],
      },
    };
    const response: PermissionCheckContractResponse = normalizePermissionCheckContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_contract",
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

    expect(request.policy.permissionMatrix[0].effect).toBe("allow");
    expect(response).toMatchObject({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_contract",
      allowed: true,
      decision: "allow",
      reason: "Allowed by explicit allow rule for filesystem:read",
    });
  });

  it("preserves Python deny and reason fields", () => {
    const response = normalizePermissionCheckContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_contract",
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

    expect(response.allowed).toBe(false);
    expect(response.decision).toBe("deny");
    expect(response.reason).toBe("Denied by explicit deny rule for filesystem:write");
    expect(response.error?.code).toBe("explicit_deny");
    expect(response.matchedRule?.effect).toBe("deny");
  });

  it("does not fallback a deny decision into allow when fields disagree", () => {
    const response = normalizePermissionCheckContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_contract",
      allowed: true,
      decision: "deny",
      reason: "Denied by explicit deny rule for filesystem:write",
      error: {
        code: "explicit_deny",
        message: "Denied by explicit deny rule for filesystem:write",
      },
    });

    expect(response.allowed).toBe(false);
    expect(response.decision).toBe("deny");
    expect(response.reason).toBe("Denied by explicit deny rule for filesystem:write");
  });

  it("normalizes malformed Python responses to deny", () => {
    const response = normalizePermissionCheckContractResponse({
      contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
      source: "python_contract",
      allowed: true,
      reason: "missing decision",
    });

    expect(response.allowed).toBe(false);
    expect(response.decision).toBe("deny");
    expect(response.error?.code).toBe("invalid_response");
  });
});
