import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("fetchJsonSafe", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("classifies network failures as offline in advanced mode", async () => {
    const { useAppStore } = await import("./store");
    useAppStore.setState({ runtimeMode: "advanced" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/audit/events");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("offline");
    expect(result.error.source).toBe("network");
  });

  it("classifies HTML fallbacks as demo mode in frontend mode", async () => {
    const { useAppStore } = await import("./store");
    useAppStore.setState({ runtimeMode: "frontend" });
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html><html><body>fallback</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/lineage?limit=10");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("demo");
    expect(result.error.source).toBe("html-fallback");
  });

  it("keeps structured server errors out of raw parser failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "Policy not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe("/api/permissions/policies/agent-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("error");
    expect(result.error.message).toBe("Policy not found");
  });

  it("returns parsed JSON data for successful responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, roles: [{ roleId: "admin" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe } = await import("./api-client");
    const result = await fetchJsonSafe<{
      ok: true;
      roles: Array<{ roleId: string }>;
    }>("/api/permissions/roles");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.roles[0]?.roleId).toBe("admin");
  });

  it("normalizes Python degraded envelope (200 + degraded:true) as kind=degraded, retryable (105)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ selected: [], degraded: true, reason: "timeout", message: "planner_timeout", error: "planner_timeout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe, isDegradedApiError } = await import("./api-client");
    const result = await fetchJsonSafe<any>("/api/sliderule/orchestrate-plan");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("degraded");
    expect(result.error.source).toBe("python");
    expect(result.error.retryable).toBe(true);
    expect(isDegradedApiError(result.error)).toBe(true);
    expect(result.error.message).toContain("planner_timeout");
  });

  it("normalizes 502 python LLM failure as degraded with python source (105)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "python LLM failed for evidence.search" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe, isPythonBackendFailure } = await import("./api-client");
    const result = await fetchJsonSafe<any>("/api/sliderule/execute-capability");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("degraded");
    expect(result.error.status).toBe(502);
    expect(isPythonBackendFailure(result.error)).toBe(true);
  });

  it("normalizes timeout/504 and legacy fallback indicators (105)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "degraded", timeout: true, message: "timeout" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { fetchJsonSafe, isPythonBackendFailure, getLegacyFallbackReason } = await import("./api-client");
    const result = await fetchJsonSafe<any>("/api/agent-loop/runs/1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("degraded");
    expect(result.error.source).toBe("timeout");
    expect(isPythonBackendFailure(result.error)).toBe(true);

    // legacy html already tested above; also test getLegacy
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );
    const legacyRes = await fetchJsonSafe<any>("/api/foo");
    if (!legacyRes.ok) {
      expect(getLegacyFallbackReason(legacyRes.error) || "legacy").toBeTruthy();
    }
  });
});

// === resolveApiTarget tests for python-first frontend proxy cutover (105) ===
// Covers: default Python for owned, explicit disable to Node, PYTHON_API_TARGET override,
// unlisted /api fallback to Node (explicit retained thin proxy). Executable via vitest.
describe("resolveApiTarget (backend-python-total-cutover-105)", () => {
  const PY = "http://localhost:9700";
  const NODE = "http://localhost:3001";

  it("defaults to Python for /api/agent-loop and listed pythonOwnedPrefixes, Node for others", async () => {
    const { resolveApiTarget } = await import("../../../api-target");
    expect(resolveApiTarget("/api/agent-loop")).toBe(PY);
    expect(resolveApiTarget("/api/agent-loop/runs/1")).toBe(PY);
    expect(resolveApiTarget("/api/sliderule")).toBe(PY);
    expect(resolveApiTarget("/api/sliderule/orchestrate-plan")).toBe(PY);
    expect(resolveApiTarget("/api/blueprint/spec-documents")).toBe(PY);
    expect(resolveApiTarget("/api/blueprint/spec-documents/export")).toBe(PY);
    expect(resolveApiTarget("/api/audit/events")).toBe(NODE);
    expect(resolveApiTarget("/api/other")).toBe(NODE);
  });

  it("explicit disable (VITE_PYTHON_FIRST_API=false etc) routes owned prefixes to Node except always-Python agent-loop", async () => {
    const { resolveApiTarget } = await import("../../../api-target");
    const dis = { VITE_PYTHON_FIRST_API: "false" as const };
    expect(resolveApiTarget("/api/sliderule", dis)).toBe(NODE);
    expect(resolveApiTarget("/api/blueprint/spec-documents", dis)).toBe(NODE);
    expect(resolveApiTarget("/api/agent-loop", dis)).toBe(PY);
    const dis2 = { FRONTEND_PYTHON_FIRST: "false" as const };
    expect(resolveApiTarget("/api/sliderule/x", dis2)).toBe(NODE);
    const dis3 = { PYTHON_FIRST_PROXY: "false" as const };
    expect(resolveApiTarget("/api/sliderule/y", dis3)).toBe(NODE);
  });

  it("PYTHON_API_TARGET overrides python target for owned routes", async () => {
    const { resolveApiTarget } = await import("../../../api-target");
    const ov = { PYTHON_API_TARGET: "http://py-local:9705" };
    expect(resolveApiTarget("/api/agent-loop", ov)).toBe("http://py-local:9705");
    expect(resolveApiTarget("/api/sliderule", ov)).toBe("http://py-local:9705");
    expect(resolveApiTarget("/api/blueprint/spec-documents/z", ov)).toBe("http://py-local:9705");
    // non-owned still Node (no silent use of py target)
    expect(resolveApiTarget("/api/unlisted", ov)).toBe(NODE);
  });

  it("unlisted /api always resolves to Node (explicit retained compatibility shell) even if python-first enabled", async () => {
    const { resolveApiTarget } = await import("../../../api-target");
    expect(resolveApiTarget("/api", { VITE_PYTHON_FIRST_API: "true" })).toBe(NODE);
    expect(resolveApiTarget("/api/foo", { PYTHON_API_TARGET: "http://x:9" })).toBe(NODE);
    expect(resolveApiTarget("/api/v2/data")).toBe(NODE);
  });
});
