import test from "node:test";
import assert from "node:assert/strict";

import {
  scanClosureLandingDiff,
  summarizeClosureScan,
} from "./secretScan.js";

test("scanClosureLandingDiff allows clean changed lines", () => {
  const result = scanClosureLandingDiff(`diff --git a/client/src/foo.ts b/client/src/foo.ts
index 000..111 100644
--- a/client/src/foo.ts
+++ b/client/src/foo.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`);

  assert.equal(result.ok, true);
  assert.deepEqual(summarizeClosureScan(result), {
    ok: true,
    blockers: 0,
    secrets: 0,
    runtimeArtifacts: 0,
    changedFiles: 1,
  });
});

test("scanClosureLandingDiff blocks added credentials and runtime artifacts", () => {
  const blockedKey = `s${"k"}-live-${"1234567890abcdef1234567890"}`;
  const keyName = `api${"Key"}`;
  const credentialResult = scanClosureLandingDiff(`diff --git a/config.ts b/config.ts
+++ b/config.ts
+const ${keyName} = "${blockedKey}";
`);
  const artifact = scanClosureLandingDiff(`diff --git a/.agent-loop/runs/xx/state.json b/.agent-loop/runs/xx/state.json
new file mode 100644
+++ b/.agent-loop/runs/xx/state.json
+{"ok":true}
`);

  assert.equal(credentialResult.ok, false);
  assert.equal(credentialResult.secretFindings.some((finding) => finding.severity === "blocker"), true);
  assert.equal(artifact.ok, false);
  assert.equal(artifact.artifactFindings[0]?.kind, "agent_loop_artifact");
});
