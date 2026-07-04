export function resolveSlideruleBrowserProbeOptions(env = process.env) {
  return {
    baseUrl: env.SLIDERULE_BROWSER_PROBE_BASE_URL || "http://localhost:3000",
    requirePythonEvidence: env.SLIDERULE_BROWSER_PROBE_REQUIRE_PYTHON === "1",
  };
}
