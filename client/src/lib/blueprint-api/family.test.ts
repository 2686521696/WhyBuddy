import { afterEach, describe, expect, it, vi } from "vitest";

import { getBlueprintFamily } from "./family";

describe("getBlueprintFamily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the encoded family endpoint and returns the response data", async () => {
    const family = {
      rootJobId: "job-root",
      jobs: [],
      replanEvents: [],
    };
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(family), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getBlueprintFamily("job root/branch");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%20root%2Fbranch/family",
      undefined,
    );
    expect(result).toEqual({ ok: true, data: family });
  });

  it("returns a structured error without throwing for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: "job_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await getBlueprintFamily("missing-job");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected family fetch to fail");
    expect(result.error).toMatchObject({
      endpoint: "/api/blueprint/jobs/missing-job/family",
      source: "http",
      status: 404,
      message: "job_not_found",
    });
  });
});
