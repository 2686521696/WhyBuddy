import { extractFirstJsonObject } from './json.js';

export function parseAgentReviewOutput(stdout) {
  const outer = extractFirstJsonObject(stdout);
  if (!outer) return null;

  const candidates = [];
  if (typeof outer.text === 'string') {
    candidates.push(outer.text);
  }
  candidates.push(stdout);

  for (const candidate of candidates) {
    const parsed = extractFirstJsonObject(candidate);
    if (parsed?.verdict) return parsed;
    if (outer.verdict) return outer;
  }

  return null;
}

// Map the many ways a review agent can phrase a verdict onto the three the loop
// reasons about. Unknown verdicts are returned as-is (lowercased) so the caller
// can fall back to exit-code semantics rather than guess.
export function normalizeReviewVerdict(verdict) {
  const value = String(verdict ?? '').toLowerCase().trim();
  if (!value) return null;
  if (['pass', 'ok', 'approve', 'approved', 'lgtm'].includes(value)) return 'pass';
  if (['needs_changes', 'needs-changes', 'request_changes', 'changes_requested', 'needs_change'].includes(value)) {
    return 'needs_changes';
  }
  if (['blocked', 'block', 'reject', 'rejected'].includes(value)) return 'blocked';
  return value;
}

export function reviewVerdictAllowsDone(parsed) {
  return normalizeReviewVerdict(parsed?.verdict) === 'pass';
}

export function reviewNeedsFix(parsed) {
  return normalizeReviewVerdict(parsed?.verdict) === 'needs_changes';
}

export function reviewIsBlocked(parsed) {
  return normalizeReviewVerdict(parsed?.verdict) === 'blocked';
}

// Decide what a finished review run means. A parsed needs_changes/blocked verdict
// is authoritative and is NEVER overridden by a zero exit code (the trap that let
// `codex review` exit 0 while asking for changes). When the reviewer was given a
// structured-verdict prompt but we cannot read a verdict, halt for a human rather
// than trusting exit code 0. Plain `codex review --uncommitted` keeps exit-code semantics.
export function classifyReviewOutcome({
  parsed,
  timedOut,
  spawnError,
  exitCode,
  requiresStructuredVerdict = false,
} = {}) {
  if (timedOut || spawnError) return 'halt';
  const verdict = normalizeReviewVerdict(parsed?.verdict);
  if (verdict === 'needs_changes') return 'needs_changes';
  if (verdict === 'blocked') return 'halt';
  if (verdict === 'pass') return 'pass';
  if (requiresStructuredVerdict) return 'halt';
  return exitCode === 0 ? 'pass' : 'halt';
}
