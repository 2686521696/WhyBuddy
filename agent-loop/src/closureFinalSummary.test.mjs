import test from "node:test";
import assert from "node:assert/strict";

import { buildCompactClosureSummary, buildMarkdownClosureSummary } from "./closureFinalSummary.js";

test("buildCompactClosureSummary emits compact closed and fail-closed summaries", () => {
  const closed = buildCompactClosureSummary({
    ok: true,
    matrices: ["frontend", "python", "vitest"],
    results: [
      { matrix: "frontend", ok: true, output: "large log omitted" },
      { matrix: "python", ok: true },
      { matrix: "vitest", ok: true },
    ],
    summary: { passed: 3, failed: 0, total: 3 },
    meta: { simulate: true, forTask: "closure-gate-120" },
  });

  assert.deepEqual(closed, {
    ok: true,
    passed: 3,
    failed: 0,
    total: 3,
    matrices: ["frontend", "python", "vitest"],
    failedMatrices: [],
    meta: { forTask: "closure-gate-120", compact: true, simulate: true },
  });

  const blocked = buildCompactClosureSummary({
    ok: false,
    results: [
      { matrix: "frontend", ok: true },
      { matrix: "python", ok: false, output: "failure details stay out" },
      { matrix: "python", ok: false },
    ],
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.passed, 1);
  assert.equal(blocked.failed, 2);
  assert.equal(blocked.total, 3);
  assert.deepEqual(blocked.failedMatrices, ["python"]);
  assert.equal(blocked.meta.compact, true);
});

test("buildMarkdownClosureSummary emits commands, pass counts, and residual risks", () => {
  const markdown = buildMarkdownClosureSummary({
    ok: false,
    matrices: ["frontend", "python", "diff-check"],
    results: [
      { matrix: "frontend", command: "node --run check", exitCode: 0, ok: true, output: "ok" },
      { matrix: "python", command: "python -m pytest tests/test_v5_smoke.py", exitCode: 1, ok: false, output: "drive_full failed" },
      { matrix: "diff-check", command: "git diff --check", exitCode: 0, ok: true, output: "" },
    ],
    summary: { passed: 2, failed: 1, total: 3 },
    meta: { simulate: true, forTask: "closure-gate-120" },
  });

  assert.match(markdown, /Runtime Closure Gate Summary/);
  assert.match(markdown, /pass counts\*\*: 2\/3 \(failed: 1\)/);
  assert.match(markdown, /failedMatrices\*\*: python/);
  assert.match(markdown, /node --run check/);
  assert.match(markdown, /python -m pytest/);
  assert.match(markdown, /Residual risks/);
  assert.match(markdown, /focused gate/i);
});
