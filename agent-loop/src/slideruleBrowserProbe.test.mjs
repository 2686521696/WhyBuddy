import test from "node:test";
import assert from "node:assert/strict";

import { probeSlideruleBrowserRoute } from "./slideruleBrowserProbe.js";

test("probeSlideruleBrowserRoute reports reachable, degraded skip, and fail-closed states", async () => {
  const reachable = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    fetchImpl: async (url) => ({
      status: url.endsWith("/agent-loop/sliderule") ? 200 : 404,
      text: async () => `
        <div data-testid="sliderule-root" data-python-provenance="via-delegation" data-backend="python-fullpath-e2e">
          <textarea placeholder="Engineering path IM..."></textarea>
          <button type="submit">Run</button>
          <button data-testid="sliderule-reset-session">Reset</button>
          <div data-testid="sliderule-goal-display">Persisted goal</div>
          SlideRule
        </div>
      `,
    }),
  });

  assert.deepEqual(reachable, {
    ok: true,
    status: "reachable",
    route: "http://localhost:3000/agent-loop/sliderule",
    evidence: {
      httpStatus: 200,
      hasSlideruleRoot: true,
      hasSlideRuleText: true,
      hasPythonProvenance: true,
      hasPythonBackend: true,
      hasCommandInput: true,
      hasCommandSubmit: true,
      hasResetControl: true,
      hasReloadRecoveryMarker: true,
    },
  });

  const skipped = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.status, "degraded-skip");
  assert.match(skipped.reason, /connection refused/);

  const failed = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    fetchImpl: async () => ({
      status: 503,
      text: async () => "Service unavailable",
    }),
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.evidence.httpStatus, 503);
});
