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

test("probeSlideruleBrowserRoute fails closed when the route is reachable but core controls are missing", async () => {
  const incomplete = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    fetchImpl: async () => ({
      status: 200,
      text: async () => `
        <main>
          <h1>SlideRule shell</h1>
          <p>Route mounted, but no real command surface.</p>
        </main>
      `,
    }),
  });

  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.status, "incomplete");
  assert.equal(incomplete.evidence.httpStatus, 200);
  assert.equal(incomplete.evidence.hasCommandInput, false);
  assert.equal(incomplete.evidence.hasCommandSubmit, false);
  assert.equal(incomplete.evidence.hasResetControl, false);
});

test("probeSlideruleBrowserRoute strict python evidence mode requires python provenance and backend markers", async () => {
  const missingPythonEvidence = await probeSlideruleBrowserRoute({
    baseUrl: "http://localhost:3000",
    requirePythonEvidence: true,
    fetchImpl: async () => ({
      status: 200,
      text: async () => `
        <div data-testid="sliderule-root">
          <textarea placeholder="Engineering path IM..."></textarea>
          <button type="submit">Run</button>
          <button data-testid="sliderule-reset-session">Reset</button>
          <div data-testid="sliderule-goal-display">Persisted goal</div>
          SlideRule
        </div>
      `,
    }),
  });

  assert.equal(missingPythonEvidence.ok, false);
  assert.equal(missingPythonEvidence.status, "incomplete-python");
  assert.equal(missingPythonEvidence.evidence.hasCommandInput, true);
  assert.equal(missingPythonEvidence.evidence.hasPythonProvenance, false);
  assert.equal(missingPythonEvidence.evidence.hasPythonBackend, false);
});
