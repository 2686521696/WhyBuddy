import test from "node:test";
import assert from "node:assert/strict";

import { buildFocusedGateCommands } from "../scripts/sliderule-runtime-closure-focused-gate.mjs";

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
