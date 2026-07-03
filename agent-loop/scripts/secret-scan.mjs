import fs from 'node:fs/promises';
import {
  scanClosureLandingDiff,
  scanTextForSecrets,
  summarizeClosureScan,
  summarizeSecretFindings,
} from '../src/secretScan.js';

export { scanClosureLandingDiff, summarizeClosureScan };

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    // deterministic positive + fail-closed negative evidence for closure precheck
    const cleanDiff = `diff --git a/client/src/foo.ts b/client/src/foo.ts
index 000..111 100644
--- a/client/src/foo.ts
+++ b/client/src/foo.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`;
    const secretKey = 'sk-' + 'live-1234567890abcdef1234567890';
    const secretDiff = `diff --git a/config.ts b/config.ts
+++ b/config.ts
+const apiKey = "${secretKey}";
`;
    const artifactDiff = `diff --git a/.agent-loop/runs/xx/state.json b/.agent-loop/runs/xx/state.json
new file mode 100644
+++ b/.agent-loop/runs/xx/state.json
+{"ok":true}
`;

    const cleanRes = scanClosureLandingDiff(cleanDiff);
    const secretRes = scanClosureLandingDiff(secretDiff);
    const artifactRes = scanClosureLandingDiff(artifactDiff);

    const evidence = {
      positiveClean: {
        input: 'clean diff (no secret, no artifact)',
        result: summarizeClosureScan(cleanRes),
        ok: cleanRes.ok,
      },
      negativeSecret: {
        input: 'diff containing openai sk- key in addition',
        result: summarizeClosureScan(secretRes),
        ok: secretRes.ok,
        blockers: secretRes.secretFindings.map((f) => ({ kind: f.kind, severity: f.severity })),
      },
      negativeArtifact: {
        input: 'diff adding .agent-loop runtime artifact',
        result: summarizeClosureScan(artifactRes),
        ok: artifactRes.ok,
        artifacts: artifactRes.artifactFindings,
      },
    };
    process.stdout.write(`${JSON.stringify({ mode: 'self-test', evidence }, null, 2)}\n`);
    const allGood = evidence.positiveClean.ok === true
      && evidence.negativeSecret.ok === false
      && evidence.negativeArtifact.ok === false;
    if (!allGood) process.exitCode = 1;
    return;
  }

  if (argv.some((a) => a === '--diff' || a === '--diff-file' || a.endsWith('.patch') || a.includes('diff'))) {
    // support closure landing diff scan: node secret-scan.mjs --diff-file <path> or <patchfile>
    // fail-closed: explicit read failure or missing scannable diff => nonzero exit + error (no silent empty ok)
    let diffPath = null;
    for (let i = 0; i < argv.length; i++) {
      if ((argv[i] === '--diff' || argv[i] === '--diff-file') && argv[i + 1]) {
        diffPath = argv[i + 1];
        break;
      }
      if (argv[i].endsWith('.patch') || argv[i].includes('.diff')) {
        diffPath = argv[i];
        break;
      }
    }
    if (!diffPath) {
      // fallback: first non-flag candidate (for bare <patchfile> arg)
      diffPath = argv.find((a) => !a.startsWith('-'));
    }
    if (!diffPath) {
      console.error('secret-scan --diff/--diff-file requires a diff file path (e.g. --diff-file <path> or <file>.patch)');
      process.exitCode = 1;
      return;
    }
    let diffText = '';
    try {
      diffText = await fs.readFile(diffPath, 'utf8');
    } catch (err) {
      console.error(`Failed to read diff file for closure scan: ${diffPath}: ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
      return;
    }
    if (!diffText || diffText.trim().length === 0) {
      console.error(`Diff file is empty (no scannable content): ${diffPath}`);
      process.exitCode = 1;
      return;
    }
    const result = scanClosureLandingDiff(diffText);
    const summary = summarizeClosureScan(result);
    process.stdout.write(`${JSON.stringify({ summary, result }, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  // original path mode (unchanged behavior)
  const paths = argv.filter((a) => !a.startsWith('-'));
  if (!paths.length) throw new Error('secret-scan requires at least one file path or --self-test / --diff-file');

  const findings = [];
  for (const filePath of paths) {
    const text = await fs.readFile(filePath, 'utf8');
    findings.push(...scanTextForSecrets({ path: filePath, text }));
  }

  const summary = summarizeSecretFindings(findings);
  process.stdout.write(`${JSON.stringify({ summary, findings }, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
