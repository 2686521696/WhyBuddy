const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const SENSITIVE_NAME_RE = /\b(api[_-]?key|secret|password|token|BEGIN PRIVATE KEY|QDRANT_API_KEY|DB_PASSWORD)\b/i;
const SECRET_SCAN_NAME_RE = /\bsecret-scan(?:\.mjs)?\b/i;

export function scanTextForSecrets({ path = '<text>', text = '' } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    let hasExplicitKey = false;
    for (const match of line.matchAll(OPENAI_KEY_RE)) {
      hasExplicitKey = true;
      const value = match[0];
      const isTest = value.startsWith('sk-test-') || /test|fake|dummy/i.test(path);
      findings.push({
        path,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        kind: isTest ? 'test_api_key' : 'openai_api_key',
        severity: isTest ? 'warning' : 'blocker',
        match: value,
      });
    }

    if (
      !hasExplicitKey
      && SENSITIVE_NAME_RE.test(line)
      && !SECRET_SCAN_NAME_RE.test(line)
      && /\b[A-Za-z0-9_./+=-]{20,}\b/.test(line)
    ) {
      findings.push({
        path,
        line: index + 1,
        column: 1,
        kind: 'sensitive_assignment',
        severity: /test|fake|dummy/i.test(line) ? 'warning' : 'blocker',
        match: line.trim().slice(0, 160),
      });
    }
  }

  return findings;
}

export function summarizeSecretFindings(findings = []) {
  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  return {
    total: findings.length,
    blockers,
    warnings,
    ok: blockers === 0,
  };
}

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
  for (const path of paths) {
    for (const { re, kind } of RUNTIME_ARTIFACT_PATTERNS) {
      if (re.test(path)) {
        findings.push({ path, kind, severity: 'blocker' });
        break;
      }
    }
  }
  return findings;
}

export function scanClosureLandingDiff(diffText = '') {
  const added = extractAddedFromDiff(diffText);
  const changedPaths = added.map((file) => file.path);
  const artifactFindings = scanForRuntimeArtifacts(changedPaths);
  const secretFindings = [];
  for (const file of added) {
    if (file.added && file.added.length > 0) {
      secretFindings.push(...scanTextForSecrets({ path: file.path, text: file.added }));
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

export function summarizeClosureScan(result) {
  return {
    ok: result.ok,
    blockers: (result.secretSummary?.blockers || 0) + result.artifactFindings.length,
    secrets: result.secretFindings.length,
    runtimeArtifacts: result.artifactFindings.length,
    changedFiles: result.changedPaths.length,
  };
}
