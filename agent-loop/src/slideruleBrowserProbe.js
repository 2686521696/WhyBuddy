export async function probeSlideruleBrowserRoute(options = {}) {
  const baseUrl = String(options.baseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const route = `${baseUrl}/agent-loop/sliderule`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const emptyEvidence = () => ({
    httpStatus: null,
    hasSlideruleRoot: false,
    hasSlideRuleText: false,
    hasPythonProvenance: false,
    hasPythonBackend: false,
    hasCommandInput: false,
    hasCommandSubmit: false,
    hasResetControl: false,
    hasReloadRecoveryMarker: false,
  });

  if (typeof fetchImpl !== "function") {
    return {
      ok: true,
      status: "degraded-skip",
      route,
      reason: "fetch is unavailable",
      evidence: emptyEvidence(),
    };
  }

  try {
    const response = await fetchImpl(route, { method: "GET" });
    const httpStatus = Number(response?.status ?? 0);
    const text = typeof response?.text === "function" ? await response.text().catch(() => "") : "";
    const hasSlideruleRoot = /data-testid=["']sliderule-root["']/.test(text);
    const hasSlideRuleText = /SlideRule|sliderule/i.test(text);
    const hasPythonProvenance = /data-python-provenance=["'][^"']+["']/.test(text);
    const hasPythonBackend = /data-backend=["'][^"']*python[^"']*["']/i.test(text);
    const hasCommandInput = /<(textarea|input)\b[^>]*(placeholder=["'][^"']*(Engineering path IM|SlideRule|command|指令)[^"']*["'])?/i.test(text);
    const hasCommandSubmit = /<button\b[^>]*(type=["']submit["'][^>]*)?>[\s\S]*?(Run|Submit|发送|推演|开始)/i.test(text);
    const hasResetControl = /data-testid=["']sliderule-reset-session["']|>\s*(Reset|重置会话|重新开始)\s*</i.test(text);
    const hasReloadRecoveryMarker = /data-testid=["']sliderule-goal-display["']|publishClosure|skillRuntimeGraph|closureHash/i.test(text);
    const evidence = {
      httpStatus,
      hasSlideruleRoot,
      hasSlideRuleText,
      hasPythonProvenance,
      hasPythonBackend,
      hasCommandInput,
      hasCommandSubmit,
      hasResetControl,
      hasReloadRecoveryMarker,
    };

    if (httpStatus >= 500 || httpStatus <= 0) {
      return { ok: false, status: "failed", route, evidence };
    }

    const hasCoreInteractiveSurface =
      hasSlideruleRoot &&
      hasSlideRuleText &&
      hasCommandInput &&
      hasCommandSubmit &&
      hasResetControl &&
      hasReloadRecoveryMarker;
    if (!hasCoreInteractiveSurface) {
      return {
        ok: false,
        status: "incomplete",
        route,
        reason: "reachable route is missing required sliderule command/reset/reload controls",
        evidence,
      };
    }

    return { ok: true, status: "reachable", route, evidence };
  } catch (error) {
    return {
      ok: true,
      status: "degraded-skip",
      route,
      reason: String(error?.message || error || "route unreachable"),
      evidence: emptyEvidence(),
    };
  }
}
