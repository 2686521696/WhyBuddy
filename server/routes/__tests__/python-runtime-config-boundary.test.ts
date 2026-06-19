import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callPythonSlideRule,
  checkPythonSlideRuleHealth,
  resolvePythonSlideRuleRuntimeConfig,
} from "../../sliderule/python-delegation.js";

describe("Python SlideRule runtime config boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves base URL, internal key, timeout, and proxy policy from env", () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", "http://127.0.0.1:9711///");
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", "internal-test");
    vi.stubEnv("PYTHON_SLIDE_RULE_TIMEOUT_MS", "3456");

    expect(resolvePythonSlideRuleRuntimeConfig()).toEqual({
      baseUrl: "http://127.0.0.1:9711",
      internalKey: "internal-test",
      timeoutMs: 3456,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
  });

  it("falls back to safe local defaults when env is absent or invalid", () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_TIMEOUT_MS", "not-a-number");

    expect(resolvePythonSlideRuleRuntimeConfig()).toEqual({
      baseUrl: "http://localhost:9700",
      internalKey: "dev-slide-rule-internal",
      timeoutMs: 120_000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });
  });

  it("sends internal key, normalized endpoint, and parsed JSON for delegation calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await callPythonSlideRule(
      "http://python.test/",
      "api/sliderule/execute-capability",
      { capabilityId: "report.write" },
      "internal-test",
      { timeoutMs: 5000 },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://python.test/api/sliderule/execute-capability");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": "internal-test",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      capabilityId: "report.write",
    });
  });

  it("classifies non-2xx delegation responses with endpoint and status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad key", { status: 403 }),
    );

    await expect(
      callPythonSlideRule(
        "http://python.test",
        "/api/sliderule/execute-capability",
        {},
        "wrong",
        { timeoutMs: 5000 },
      ),
    ).rejects.toThrow("python /api/sliderule/execute-capability failed: http 403 bad key");
  });

  it("classifies invalid JSON responses separately from service reachability", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200 }),
    );

    await expect(
      callPythonSlideRule(
        "http://python.test",
        "/api/sliderule/execute-capability",
        {},
        "internal-test",
        { timeoutMs: 5000 },
      ),
    ).rejects.toThrow("invalid json");
  });

  it("checks Python health without sending the internal key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", backend: "tws-ai-slide-rule-python" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await checkPythonSlideRuleHealth({
      baseUrl: "http://python.test",
      internalKey: "internal-test",
      timeoutMs: 5000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });

    expect(result).toEqual({
      ok: true,
      url: "http://python.test/health",
      status: 200,
      backend: "tws-ai-slide-rule-python",
      error: undefined,
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toBeUndefined();
  });

  it("turns unavailable health into a diagnostic result instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:9700"),
    );

    const result = await checkPythonSlideRuleHealth({
      baseUrl: "http://python.test",
      internalKey: "internal-test",
      timeoutMs: 5000,
      healthPath: "/health",
      proxyMode: "node-fetch-env",
    });

    expect(result.ok).toBe(false);
    expect(result.url).toBe("http://python.test/health");
    expect(result.error).toContain("ECONNREFUSED");
  });
});
