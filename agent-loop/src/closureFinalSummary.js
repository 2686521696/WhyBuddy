export const CLOSURE_FINAL_JSON_SCHEMA = {
  ok: "boolean",
  passed: "number",
  failed: "number",
  total: "number",
  matrices: "string[]",
  failedMatrices: "string[]",
  meta: "{forTask:string, compact:true, simulate?:boolean}",
};

export function buildCompactClosureSummary(result = {}) {
  const rawResults = Array.isArray(result.results) ? result.results : [];
  const summary = result.summary && typeof result.summary === "object" ? result.summary : {};
  const passed = Number(summary.passed ?? rawResults.filter((entry) => entry?.ok === true).length);
  const failed = Number(summary.failed ?? rawResults.filter((entry) => entry?.ok === false).length);
  const total = Number(summary.total ?? (rawResults.length || passed + failed));
  const failedMatrices = rawResults
    .filter((entry) => entry?.ok === false)
    .map((entry) => String(entry.matrix || "unknown"))
    .filter((matrix, index, all) => all.indexOf(matrix) === index);

  return {
    ok: typeof result.ok === "boolean" ? result.ok : failed === 0,
    passed,
    failed,
    total,
    matrices: Array.isArray(result.matrices) ? result.matrices.slice() : [],
    failedMatrices,
    meta: {
      forTask: result.meta?.forTask || "sliderule-runtime-closure-focused-gate",
      compact: true,
      simulate: result.meta?.simulate === true,
    },
  };
}
