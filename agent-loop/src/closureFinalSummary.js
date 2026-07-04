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
      ...(typeof result.meta?.requireLiveBrowser === "boolean"
        ? { requireLiveBrowser: result.meta.requireLiveBrowser }
        : {}),
      ...(typeof result.meta?.requireCommandSubmit === "boolean"
        ? { requireCommandSubmit: result.meta.requireCommandSubmit }
        : {}),
      ...(typeof result.meta?.requireRuntimeSurface === "boolean"
        ? { requireRuntimeSurface: result.meta.requireRuntimeSurface }
        : {}),
      ...(typeof result.meta?.requirePersistenceReplay === "boolean"
        ? { requirePersistenceReplay: result.meta.requirePersistenceReplay }
        : {}),
    },
  };
}

export function buildMarkdownClosureSummary(result = {}) {
  const compact = buildCompactClosureSummary(result);
  const rawResults = Array.isArray(result.results) ? result.results : [];
  const lines = [
    "# SlideRule Runtime Closure Gate Summary",
    "",
    `**ok**: ${compact.ok}`,
    `**pass counts**: ${compact.passed}/${compact.total} (failed: ${compact.failed})`,
    `**failedMatrices**: ${compact.failedMatrices.length ? compact.failedMatrices.join(", ") : "none"}`,
    "",
    "## Commands",
  ];

  if (rawResults.length === 0) {
    lines.push("- (no command details in compact input)");
  } else {
    for (const entry of rawResults) {
      const matrix = String(entry?.matrix || "unknown");
      const id = entry?.id ? `${String(entry.id)} ` : "";
      const command = String(entry?.command || "(command unavailable)").slice(0, 140);
      const exitCode = entry?.exitCode ?? "?";
      const ok = entry?.ok === true;
      const output = String(entry?.output || "").replace(/\s+/g, " ").trim().slice(0, 90);
      lines.push(`- ${matrix}: ${id}\`${command}\` (exit=${exitCode}, ok=${ok})${output ? ` - ${output}` : ""}`);
    }
  }

  lines.push(
    "",
    "## Matrices",
    ...(compact.matrices.length ? compact.matrices.map((matrix) => `- ${matrix}`) : ["- (not provided)"]),
    "",
    "## Residual risks",
    "- Browser smoke can degrade-skip when the local dev server is unavailable.",
    "- Secret and dirty-main checks only prove the current working diff at gate time.",
    "- This is a focused gate; broader CI remains the final backstop.",
    "",
  );

  return lines.join("\n");
}
