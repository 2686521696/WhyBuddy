import fs from 'node:fs/promises';
import { scanTextForSecrets, summarizeSecretFindings } from '../src/secretScan.js';

// --- closure landing diff scan additions (for precheck-04 objective) ---
const RUNTIME_ARTIFACT_PATTERNS = [
  { re: /(^|\/)\.agent-loop(\/|$)/, kind: 'agent_loop_artifact' },
  { re: /(^|\/)\.worktrees(\/|$)/, kind: 'worktree_artifact' },
  { re: /(^|\/)\.env(\.|\/|$)/, kind: 'env_file' },
  { re: /__pycache__/, kind: 'pycache' },
  { re: /\.pyc$/, kind: 'pyc_file' },
  { re: /\.(stdout|stderr)\.log$/, kind: 'log_artifact' },
  { re: /node_modules\//, kind: 'node_modules' },
];

function extractAddedFromDiff(diffText = '') {
  const files = [];
  let currentPath = null;
  let addedLines = [];
  for (const line of String(diffText).split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/.* b\/(.+)$/);
    if (header) {
      if (currentPath !== null) {
        files.push({ path: currentPath, added: addedLines.join('\n') });
      }
      currentPath = header[1];
      addedLines = [];
      continue;
    }
    if (currentPath !== null && line.startsWith('+') && !line.startsWith('+++ ')) {
      addedLines.push(line.slice(1));
    }
  }
  if (currentPath !== null) {
    files.push({ path: currentPath, added: addedLines.join('\n') });
  }
  return files;
}

function scanForRuntimeArtifacts(paths = []) {
  const findings = [];
  for (const p of paths) {
    for (const { re, kind } of RUNTIME_ARTIFACT_PATTERNS) {
      if (re.test(p)) {
        findings.push({ path: p, kind, severity: 'blocker' });
        break;
      }
    }
  }
  return findings;
}

export function scanClosureLandingDiff(diffText = '') {
  const added = extractAddedFromDiff(diffText);
  const changedPaths = added.map((f) => f.path);
  const artifactFindings = scanForRuntimeArtifacts(changedPaths);
  const secretFindings = [];
  for (const f of added) {
    if (f.added && f.added.length > 0) {
      secretFindings.push(...scanTextForSecrets({ path: f.path, text: f.added }));
    }
  }
  const secretSummary = summarizeSecretFindings(secretFindings);
  const hasBlockingArtifacts = artifactFindings.length > 0;
  return {
    ok: secretSummary.ok && !hasBlockingArtifacts,
    secretSummary,
    secretFindings,
    artifactFindings,
    changedPaths,
  };
}

function summarizeClosureScan(result) {
  return {
    ok: result.ok,
    blockers: (result.secretSummary?.blockers || 0) + result.artifactFindings.length,
    secrets: result.secretFindings.length,
    runtimeArtifacts: result.artifactFindings.length,
    changedFiles: result.changedPaths.length,
  };
}
// --- end closure additions ---

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
