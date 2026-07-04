import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFocusedGateCommands,
  formatFocusedGateOutput,
  runFocusedGate,
} from "../scripts/sliderule-runtime-closure-focused-gate.mjs";

test("buildFocusedGateCommands can require live browser page smoke", () => {
  const commands = buildFocusedGateCommands({ requireLiveBrowser: true });
  const pageSmoke = commands.find((entry) => entry.id === "browser-page-controls-smoke");

  assert.ok(pageSmoke);
  assert.equal(
    pageSmoke.command,
    "node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live",
  );
});

test("buildFocusedGateCommands can require a real command submit smoke", () => {
  const commands = buildFocusedGateCommands({ requireLiveBrowser: true, requireCommandSubmit: true });
  const pageSmoke = commands.find((entry) => entry.id === "browser-page-controls-smoke");

  assert.ok(pageSmoke);
  assert.equal(
    pageSmoke.command,
    "node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command",
  );
});

test("buildFocusedGateCommands can require AppBundle runtime surface smoke", () => {
  const commands = buildFocusedGateCommands({ requireRuntimeSurface: true });
  const pageSmoke = commands.find((entry) => entry.id === "browser-page-controls-smoke");

  assert.ok(pageSmoke);
  assert.equal(
    pageSmoke.command,
    "node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command --require-runtime-surface",
  );
});

test("buildFocusedGateCommands can require persistence replay smoke", () => {
  const commands = buildFocusedGateCommands({ requirePersistenceReplay: true });
  const pageSmoke = commands.find((entry) => entry.id === "browser-page-controls-smoke");

  assert.ok(pageSmoke);
  assert.equal(
    pageSmoke.command,
    "node agent-loop/scripts/sliderule-page-controls-smoke.mjs --require-live --submit-command --require-runtime-surface --require-persistence-replay",
  );
});

test("runFocusedGate labels matrices and emits compact final summary metadata", () => {
  const result = runFocusedGate({ simulate: true, requirePersistenceReplay: true });

  assert.equal(result.ok, true);
  assert.equal(result.meta.forTask, "sliderule-runtime-closure-focused-gate");
  assert.equal(result.meta.simulate, true);
  assert.equal(result.meta.requirePersistenceReplay, true);
  assert.ok(result.matrices.includes("appbundle"));
  assert.ok(result.matrices.includes("browser"));
  assert.ok(result.matrices.includes("python"));
  assert.ok(result.results.every((entry) => typeof entry.matrix === "string" && entry.matrix.length > 0));

  const compact = JSON.parse(formatFocusedGateOutput(result, { format: "compact-json" }));
  assert.deepEqual(compact.failedMatrices, []);
  assert.equal(compact.meta.compact, true);
  assert.equal(compact.meta.simulate, true);
});

test("formatFocusedGateOutput can emit markdown with commands and residual risks", () => {
  const result = runFocusedGate({ simulate: true, requireRuntimeSurface: true });
  const markdown = formatFocusedGateOutput(result, { format: "markdown" });

  assert.match(markdown, /Runtime Closure Gate Summary/);
  assert.match(markdown, /pass counts/);
  assert.match(markdown, /browser-page-controls-smoke/);
  assert.match(markdown, /Residual risks/);
});
