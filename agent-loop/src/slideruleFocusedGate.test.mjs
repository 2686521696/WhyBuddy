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
