import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchChecksLedger } from "./checks-ledger";

const SAMPLE_LEDGER = {
  jobId: "job-1",
  entries: [
    {
      id: "chk-job1-1",
      jobId: "job-1",
      stage: "spec_tree",
      checkType: "invariant",
      checkName: "business_requirement_coverage",
      status: "warn",
      validator: "server/routes/blueprint/checks-ledger/service.ts",
      triggeredAt: "2026-05-24T10:00:00.000Z",
    },
  ],
  summary: { total: 1, pass: 0, fail: 0, warn: 1, skip: 0 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchChecksLedger", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the encoded checks-ledger endpoint and returns the parsed response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE_LEDGER));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchChecksLedger("job one/branch");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job%20one%2Fbranch/checks-ledger",
      undefined,
    );
    expect(result).toEqual({ ok: true, data: SAMPLE_LEDGER });
  });

  it("appends provided filters as encoded query parameters", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE_LEDGER));
    vi.stubGlobal("fetch", fetchMock);

    await fetchChecksLedger("job-1", {
      status: "warn",
      checkType: "preview_audit",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "/api/blueprint/jobs/job-1/checks-ledger?status=warn&checkType=preview_audit",
    );
    expect(calledUrl).toContain("checkType=preview_audit");
    expect(calledUrl).toContain("status=warn");
  });

  it("does not append a query string when no filters are provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE_LEDGER));
    vi.stubGlobal("fetch", fetchMock);

    await fetchChecksLedger("job-1", {});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/blueprint/jobs/job-1/checks-ledger",
      undefined,
    );
  });

  it("returns a structured error without throwing for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "job_not_found" }, 404)),
    );

    const result = await fetchChecksLedger("missing-job");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected checks-ledger fetch to fail");
    expect(result.error).toMatchObject({
      endpoint: "/api/blueprint/jobs/missing-job/checks-ledger",
      source: "http",
      status: 404,
      message: "job_not_found",
    });
  });

  it("returns a structured error for transport failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    const result = await fetchChecksLedger("job-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected transport failure");
    expect(result.error.source).toBe("network");
  });
});
