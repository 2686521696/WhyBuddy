import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveSliderulePageIdentity,
  evaluateSlideruleCommandSmokeEvidence,
  evaluateSliderulePageSmokeEvidence,
  evaluateSlideruleRuntimeSurfaceSmokeEvidence,
} from "./sliderulePageSmoke.js";

const completeEvidence = {
  hasSlideruleRoot: true,
  hasSlideRuleText: true,
  hasPythonProvenance: true,
  hasPythonBackend: true,
  hasCommandInput: true,
  hasCommandSubmit: true,
  hasCommandInputMutation: true,
  hasCommandSubmitEnabled: true,
  hasResetControl: true,
  hasResetClickAcknowledged: true,
  hasReloadRecoveryMarker: true,
  hasReloadAfterReset: true,
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

test("evaluateSliderulePageSmokeEvidence fails closed when controls are present but not actionable", () => {
  const evidence = { ...completeEvidence, hasCommandSubmitEnabled: false };
  const result = evaluateSliderulePageSmokeEvidence(evidence);

  assert.equal(result.ok, false);
  assert.equal(result.status, "incomplete-action");
  assert.match(result.reason, /not actionable/);
  assert.equal(result.evidence.hasCommandSubmitEnabled, false);
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

const completeCommandEvidence = {
  ...completeEvidence,
  hasDriveFullPost: true,
  hasPythonDriveFullResponse: true,
  hasCommandSettled: true,
  hasPageUsableAfterCommand: true,
  hasNoFatalConsoleErrors: true,
};

const completeRuntimeSurfaceEvidence = {
  ...completeCommandEvidence,
  hasPublishClosureSurface: true,
  hasCrossRuntimeGraphSurface: true,
};

test("evaluateSlideruleCommandSmokeEvidence closes when a real command reaches python /drive-full", () => {
  assert.deepEqual(evaluateSlideruleCommandSmokeEvidence(completeCommandEvidence), {
    ok: true,
    status: "command-ready",
    reason: "sliderule page submitted a real command through python /drive-full and stayed usable",
    evidence: completeCommandEvidence,
  });
});

test("evaluateSlideruleCommandSmokeEvidence fails closed when command submit does not reach python /drive-full", () => {
  const evidence = { ...completeCommandEvidence, hasPythonDriveFullResponse: false };
  const result = evaluateSlideruleCommandSmokeEvidence(evidence);

  assert.equal(result.ok, false);
  assert.equal(result.status, "incomplete-command");
  assert.match(result.reason, /python \/drive-full/);
  assert.equal(result.evidence.hasPythonDriveFullResponse, false);
});

test("evaluateSlideruleRuntimeSurfaceSmokeEvidence closes when command evidence renders AppBundle surfaces", () => {
  assert.deepEqual(evaluateSlideruleRuntimeSurfaceSmokeEvidence(completeRuntimeSurfaceEvidence), {
    ok: true,
    status: "runtime-surface-ready",
    reason: "sliderule page rendered AppBundle publish closure and cross-runtime graph after python /drive-full",
    evidence: completeRuntimeSurfaceEvidence,
  });
});

test("evaluateSlideruleRuntimeSurfaceSmokeEvidence fails closed when AppBundle runtime surface is missing", () => {
  const evidence = { ...completeRuntimeSurfaceEvidence, hasPublishClosureSurface: false };
  const result = evaluateSlideruleRuntimeSurfaceSmokeEvidence(evidence);

  assert.equal(result.ok, false);
  assert.equal(result.status, "incomplete-runtime-surface");
  assert.match(result.reason, /AppBundle/);
  assert.equal(result.evidence.hasPublishClosureSurface, false);
});
