import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveSliderulePageIdentity,
  evaluateSliderulePageSmokeEvidence,
} from "./sliderulePageSmoke.js";

const completeEvidence = {
  hasSlideruleRoot: true,
  hasSlideRuleText: true,
  hasPythonProvenance: true,
  hasPythonBackend: true,
  hasCommandInput: true,
  hasCommandSubmit: true,
  hasResetControl: true,
  hasReloadRecoveryMarker: true,
};

test("evaluateSliderulePageSmokeEvidence closes when page controls and python markers are present", () => {
  assert.deepEqual(evaluateSliderulePageSmokeEvidence(completeEvidence), {
    ok: true,
    status: "ready",
    reason: "sliderule page rendered required command/reset/reload controls and python markers",
    evidence: completeEvidence,
  });
});

test("evaluateSliderulePageSmokeEvidence fails closed when required page controls are missing", () => {
  const evidence = { ...completeEvidence, hasResetControl: false };
  const result = evaluateSliderulePageSmokeEvidence(evidence);

  assert.equal(result.ok, false);
  assert.equal(result.status, "incomplete");
  assert.match(result.reason, /command\/reset\/reload controls/);
  assert.equal(result.evidence.hasResetControl, false);
});

test("evaluateSliderulePageSmokeEvidence fails closed when strict python markers are missing", () => {
  const evidence = { ...completeEvidence, hasPythonBackend: false };
  const result = evaluateSliderulePageSmokeEvidence(evidence);

  assert.equal(result.ok, false);
  assert.equal(result.status, "incomplete-python");
  assert.match(result.reason, /python provenance\/backend markers/);
  assert.equal(result.evidence.hasPythonBackend, false);
});

test("deriveSliderulePageIdentity accepts route/title identity when rendered text omits brand text", () => {
  assert.equal(
    deriveSliderulePageIdentity({
      rootText: "STATUS ready",
      title: "SlideRule",
      route: "http://localhost:3000/agent-loop/sliderule",
    }),
    true,
  );
});
