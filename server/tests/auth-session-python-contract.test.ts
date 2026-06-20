import { describe, expect, it } from "vitest";

import {
  toPythonAuthSessionContract,
  validatePythonAuthSessionContract,
  type PythonAuthSessionContract,
} from "../auth/session-service.js";

const validUser = {
  id: "user-1",
  email: "user@example.com",
  role: "user" as const,
  status: "active" as const,
  emailVerified: true,
  createdAt: "2026-04-30T00:00:00.000Z",
};

describe("auth session Python contract", () => {
  it("maps an active Node session lookup to the Python valid contract shape without secrets", () => {
    const contract = toPythonAuthSessionContract({
      sessionId: "session-1",
      user: validUser,
    });

    expect(validatePythonAuthSessionContract(contract)).toEqual({
      valid: true,
      sessionId: "session-1",
      user: validUser,
    });
    expect(JSON.stringify(contract)).not.toContain("token");
    expect(JSON.stringify(contract)).not.toContain("cookie");
  });

  it("maps a missing Node session to the stable Python missing contract shape", () => {
    expect(toPythonAuthSessionContract(null)).toEqual({
      valid: false,
      error: "missing",
      status: 401,
      message: "Authentication required",
    });
  });

  it("accepts the stable Python expired error shape", () => {
    const contract: PythonAuthSessionContract = {
      valid: false,
      error: "expired",
      status: 401,
      message: "Session expired",
    };

    expect(validatePythonAuthSessionContract(contract)).toEqual(contract);
  });

  it("accepts the stable Python invalid error shape and rejects secret-bearing payloads", () => {
    const invalidContract: PythonAuthSessionContract = {
      valid: false,
      error: "invalid",
      status: 401,
      message: "Invalid session",
    };
    const secretBearingPayload = {
      valid: true,
      sessionId: "session-1",
      token: "test-token",
      cookie: "cube_test_session=test-token",
      user: {
        ...validUser,
        tokenHash: "hash",
      },
    };

    expect(validatePythonAuthSessionContract(invalidContract)).toEqual(invalidContract);
    expect(validatePythonAuthSessionContract(secretBearingPayload)).toEqual(invalidContract);
    expect(JSON.stringify(validatePythonAuthSessionContract(secretBearingPayload))).not.toContain("test-token");
    expect(JSON.stringify(validatePythonAuthSessionContract(secretBearingPayload))).not.toContain("tokenHash");
  });
});
