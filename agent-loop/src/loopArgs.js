import { normalizeAgentId } from './agentRoles.js';

export function parseLoopArgs(argv) {
  const parsed = {
    cwd: null,
    fixCwd: null,
    createWorktree: null,
    task: null,
    gates: [],
    autoFix: false,
    skipReview: false,
    fixAgent: 'grok',
    reviewAgent: 'grok',
    scopedReview: null,
    reviewMaxTurns: 2,
    timeoutMs: 120000,
    maxIterations: 3,
    grokMaxTurns: 4,
    grokMaxRetries: 1,
    retryBackoffMs: 1000,
    pauseBeforeFix: false,
    pauseAfterIteration: false,
    guardTests: false,
    lang: 'en',
    syncTaskStatus: true,
    syncMigrationStatus: true,
    resume: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--resume') {
      parsed.resume = readValue(argv, ++i, '--resume');
    } else if (arg === '--cwd') {
      parsed.cwd = readValue(argv, ++i, '--cwd');
    } else if (arg === '--fix-cwd') {
      parsed.fixCwd = readValue(argv, ++i, '--fix-cwd');
    } else if (arg === '--create-worktree') {
      parsed.createWorktree = readValue(argv, ++i, '--create-worktree');
    } else if (arg === '--task') {
      parsed.task = readValue(argv, ++i, '--task');
    } else if (arg === '--gate') {
      parsed.gates.push(readValue(argv, ++i, '--gate'));
    } else if (arg === '--auto-fix') {
      parsed.autoFix = true;
    } else if (arg === '--skip-review') {
      parsed.skipReview = true;
    } else if (arg === '--fix-agent') {
      parsed.fixAgent = readAgentValue(argv, ++i, '--fix-agent');
    } else if (arg === '--review-agent') {
      const value = readValue(argv, ++i, '--review-agent');
      if (value === 'none') {
        parsed.skipReview = true;
        parsed.reviewAgent = null;
      } else {
        parsed.reviewAgent = readAgentValue(argv, i, '--review-agent', value);
      }
    } else if (arg === '--scoped-review') {
      parsed.scopedReview = readBooleanValue(argv, ++i, '--scoped-review');
    } else if (arg === '--review-max-turns') {
      parsed.reviewMaxTurns = Number.parseInt(readValue(argv, ++i, '--review-max-turns'), 10);
      if (!Number.isFinite(parsed.reviewMaxTurns) || parsed.reviewMaxTurns <= 0) {
        throw new Error('--review-max-turns must be a positive integer');
      }
    } else if (arg === '--pause-before-fix') {
      parsed.pauseBeforeFix = true;
    } else if (arg === '--pause-after-iteration') {
      parsed.pauseAfterIteration = true;
    } else if (arg === '--guard-tests') {
      parsed.guardTests = true;
    } else if (arg === '--lang') {
      parsed.lang = readValue(argv, ++i, '--lang');
      if (!['en', 'zh-CN'].includes(parsed.lang)) {
        throw new Error('--lang must be one of: en, zh-CN');
      }
    } else if (arg === '--no-sync-task-status') {
      parsed.syncTaskStatus = false;
    } else if (arg === '--no-sync-migration-status') {
      parsed.syncMigrationStatus = false;
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(readValue(argv, ++i, '--timeout-ms'), 10);
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer');
      }
    } else if (arg === '--max-iterations') {
      parsed.maxIterations = Number.parseInt(readValue(argv, ++i, '--max-iterations'), 10);
      if (!Number.isFinite(parsed.maxIterations) || parsed.maxIterations <= 0) {
        throw new Error('--max-iterations must be a positive integer');
      }
    } else if (arg === '--grok-max-turns') {
      parsed.grokMaxTurns = Number.parseInt(readValue(argv, ++i, '--grok-max-turns'), 10);
      if (!Number.isFinite(parsed.grokMaxTurns) || parsed.grokMaxTurns <= 0) {
        throw new Error('--grok-max-turns must be a positive integer');
      }
    } else if (arg === '--grok-max-retries') {
      parsed.grokMaxRetries = Number.parseInt(readValue(argv, ++i, '--grok-max-retries'), 10);
      if (!Number.isFinite(parsed.grokMaxRetries) || parsed.grokMaxRetries < 0) {
        throw new Error('--grok-max-retries must be a non-negative integer');
      }
    } else if (arg === '--retry-backoff-ms') {
      parsed.retryBackoffMs = Number.parseInt(readValue(argv, ++i, '--retry-backoff-ms'), 10);
      if (!Number.isFinite(parsed.retryBackoffMs) || parsed.retryBackoffMs < 0) {
        throw new Error('--retry-backoff-ms must be a non-negative integer');
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (parsed.resume) return parsed;
  if (!parsed.cwd) throw new Error('--cwd is required');
  if (!parsed.task) throw new Error('--task is required');
  if (parsed.gates.length === 0) throw new Error('at least one --gate is required');
  if (parsed.autoFix && !parsed.fixCwd && !parsed.createWorktree) {
    throw new Error('--fix-cwd is required when --auto-fix is enabled');
  }
  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function readAgentValue(argv, index, flag, explicitValue) {
  const value = explicitValue ?? readValue(argv, index, flag);
  return normalizeAgentId(value, { field: flag, fallback: value });
}

function readBooleanValue(argv, index, flag) {
  const value = readValue(argv, index, flag).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} must be true or false`);
}
