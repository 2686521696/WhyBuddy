import test from "node:test";
import assert from "node:assert/strict";

import { buildCompactClosureSummary } from "./closureFinalSummary.js";

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
