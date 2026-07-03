export async function probeSlideruleBrowserRoute(options = {}) {
  const baseUrl = String(options.baseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const route = `${baseUrl}/agent-loop/sliderule`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    return {
      ok: true,
      status: "degraded-skip",
      route,
      reason: "fetch is unavailable",
      evidence: { httpStatus: null, hasSlideruleRoot: false, hasSlideRuleText: false },
    };
  }

  try {
    const response = await fetchImpl(route, { method: "GET" });
    const httpStatus = Number(response?.status ?? 0);
    const text = typeof response?.text === "function" ? await response.text().catch(() => "") : "";
    const hasSlideruleRoot = /data-testid=["']sliderule-root["']/.test(text);
    const hasSlideRuleText = /SlideRule|sliderule/i.test(text);
    const evidence = { httpStatus, hasSlideruleRoot, hasSlideRuleText };

    if (httpStatus >= 500 || httpStatus <= 0) {
      return { ok: false, status: "failed", route, evidence };
    }

    return { ok: true, status: "reachable", route, evidence };
  } catch (error) {
    return {
      ok: true,
      status: "degraded-skip",
      route,
      reason: String(error?.message || error || "route unreachable"),
      evidence: { httpStatus: null, hasSlideruleRoot: false, hasSlideRuleText: false },
    };
  }
}
