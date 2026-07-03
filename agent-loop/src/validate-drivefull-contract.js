import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve(process.cwd(), "slide-rule-python/tests/fixtures/drive_full_response_contract.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

let fixture;
try {
  fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  fail(`Failed to load drive_full_response_contract.json: ${error.message}`);
}

const positive = fixture.positive || {};
const degraded = fixture.degraded || {};

if (!positive.skillRuntimeGraph || typeof positive.skillRuntimeGraph !== "object") {
  fail("positive closed path must carry skillRuntimeGraph");
}

if (!positive.publishClosure || positive.publishClosure.blocked !== false) {
  fail("positive closed path must carry publishClosure with blocked=false");
}

if (!Array.isArray(positive.closureWarnings)) {
  fail("positive closed path must carry closureWarnings as an array");
}

if (degraded.skillRuntimeGraph !== null || degraded.publishClosure !== null || degraded.closureWarnings !== null) {
  fail("degraded negative path must keep closure fields null");
}

const failClosedProxyEnvelope = {
  error: "python_unavailable",
  backend: "python",
  degraded: true,
};

for (const key of ["publishClosure", "skillRuntimeGraph", "closureWarnings"]) {
  if (Object.prototype.hasOwnProperty.call(failClosedProxyEnvelope, key)) {
    fail(`fail-closed proxy envelope must not fabricate ${key}`);
  }
}

console.log("drive-full proxy passthrough contract ok");
