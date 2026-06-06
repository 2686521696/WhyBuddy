import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTraceabilityMatrix } from "./traceability-matrix";

const SAMPLE_MATRIX = {
  jobId: "job-1",
  generatedAt: "2026-05-24T10:00:00.000Z",
  entries: [
    {
      requirementId: "1.1",
      requirementTitle: "API wrappers",
      designSections: ["§Components 1"],
      taskIds: ["4"],
      evidenceSources: [],
      testCases: ["7.1"],
    },
  ],
  coverage: {
    totalRequirements: 1,
    coveredByDesign: 1,
    coveredByTasks: 1,
    coveredByEvidence: 0,
    coveredByTests: 1,
    coveragePercent: 75,
    gaps: [],
  },
  stale: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchTraceabilityMatrix", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed matrix on the JSON branch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE_MATRIX));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTraceabilityMatrix("job one/branch");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%20one%2Fbranch/traceability-matrix",
      undefined,
    );
    expect(result).toEqual({ ok: true, kind: "json", data: SAMPLE_MATRIX });
  });

  it("requests the markdown export via ?format=markdown and returns the text body", async () => {
    const markdown = "# Traceability Matrix\n\n| Req | ... |\n";
    const fetchMock = vi.fn(
      async () =>
        new Response(markdown, {
          status: 200,
          headers: { "content-type": "text/markdown" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTraceabilityMatrix("job-1", "markdown");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "/api/blueprint/jobs/job-1/traceability-matrix?format=markdown",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected markdown fetch to succeed");
    expect(result.kind).toBe("markdown");
    expect(result.data).toBe(markdown);
  });

  it("flags notGenerated when the endpoint returns 404 matrix_not_generated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "matrix_not_generated" }, 404)),
    );

    const result = await fetchTraceabilityMatrix("job-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-generated result");
    expect(result.notGenerated).toBe(true);
    expect(result.error).toMatchObject({
      endpoint: "/api/blueprint/jobs/job-1/traceability-matrix",
      status: 404,
      message: "matrix_not_generated",
    });
  });

  it("flags notGenerated for 404 job_not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "job_not_found" }, 404)),
    );

    const result = await fetchTraceabilityMatrix("missing-job");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-generated result");
    expect(result.notGenerated).toBe(true);
  });

  it("returns notGenerated:false for non-404 transport errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    const result = await fetchTraceabilityMatrix("job-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected transport failure");
    expect(result.notGenerated).toBe(false);
    expect(result.error.source).toBe("network");
  });

  it("returns notGenerated:false for a markdown transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    const result = await fetchTraceabilityMatrix("job-1", "markdown");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected markdown transport failure");
    expect(result.notGenerated).toBe(false);
  });
});
