import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { buildPythonUvicornArgs } from "./dev-all.mjs";

test("buildPythonUvicornArgs enables uvicorn reload for the Python backend by default", () => {
  const pythonDir = resolve("slide-rule-python");

  const args = buildPythonUvicornArgs(pythonDir, "9700", {});

  assert.deepEqual(args, [
    "-m",
    "uvicorn",
    "app:app",
    "--host",
    "127.0.0.1",
    "--port",
    "9700",
    "--reload",
    "--reload-dir",
    pythonDir,
  ]);
});

test("buildPythonUvicornArgs can disable Python backend reload with env", () => {
  const pythonDir = resolve("slide-rule-python");

  const args = buildPythonUvicornArgs(pythonDir, "9700", {
    SLIDE_RULE_PYTHON_RELOAD: "0",
  });

  assert.deepEqual(args, [
    "-m",
    "uvicorn",
    "app:app",
    "--host",
    "127.0.0.1",
    "--port",
    "9700",
  ]);
});
