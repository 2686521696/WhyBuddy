import { describe, expect, it } from "vitest";

import { mapAdminPythonRouteContract } from "../routes/admin.js";

describe("admin Node -> Python contract mapper", () => {
  it("maps success contracts without changing the safe response body", () => {
    const body = {
      success: true,
      summary: {
        users: 2,
        projects: 1,
        runs: 0,
        failures: 0,
        audit: 0,
      },
    };

    expect(
      mapAdminPythonRouteContract({
        outcome: "success",
        statusCode: 200,
        body,
      }),
    ).toEqual({
      statusCode: 200,
      body,
    });
  });

  it("maps forbidden contracts to 403 and ignores any success fallback body", () => {
    const mapped = mapAdminPythonRouteContract({
      outcome: "forbidden",
      body: {
        success: true,
        items: [{ id: "admin-data" }],
      },
    } as never);

    expect(mapped).toEqual({
      statusCode: 403,
      body: {
        success: false,
        error: "Admin privileges required",
      },
    });
  });

  it("maps error contracts to sanitized failure responses instead of success", () => {
    const mapped = mapAdminPythonRouteContract({
      outcome: "error",
      statusCode: 200,
      error: "database password hash query failed",
    } as never);

    expect(mapped).toEqual({
      statusCode: 500,
      body: {
        success: false,
        error: "Admin route failed",
      },
    });
  });
});
