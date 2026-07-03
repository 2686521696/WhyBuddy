import test from "node:test";
import assert from "node:assert/strict";

import { probeSlideruleBrowserRoute } from "./slideruleBrowserProbe.js";

test("probeSlideruleBrowserRoute reports reachable, degraded skip, and fail-closed states", async () => {
  const reachable = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    fetchImpl: async (url) => ({
      status: url.endsWith("/agent-loop/sliderule") ? 200 : 404,
      text: async () => "<div data-testid=\"sliderule-root\">SlideRule</div>",
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
