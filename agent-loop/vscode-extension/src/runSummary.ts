import type { LoopState } from './types';

export interface AgentRunRef {
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface IterationRef {
  iteration?: number;
  grokFix?: AgentRunRef | null;
  agentFix?: AgentRunRef | null;
  attempts?: Array<{ grokFix?: AgentRunRef | null; agentFix?: AgentRunRef | null }>;
}

export interface SummarizeRunInput {
  runId?: string | null;
  status?: string | null;
  task?: string | null;
  iterations?: IterationRef[];
  grokFix?: AgentRunRef | null;
  agentFix?: AgentRunRef | null;
  codexReview?: AgentRunRef | null;
  grokReview?: AgentRunRef | null;
  agentReview?: AgentRunRef | null;
  fixAgent?: string;
  reviewAgent?: string | null;
  timeZone?: string;
}

export interface RunRecordSummary {
  runId: string | null;
  runTimeLocal: string;
  runTimeUtc: string;
  status: string | null;
  task: string | null;
  fixAgent: string;
  reviewAgent: string | null;
  runMode: string;
  grokRan: boolean;
  codexRan: boolean;
  reviewAgentRan: boolean;
  iterations: number;
}

export function classifyRunMode({
  status,
  iterations = [],
  grokFix = null,
  agentFix = null,
  codexReview = null,
  grokReview = null,
  agentReview = null,
  fixAgent = 'grok',
  reviewAgent = 'grok',
}: SummarizeRunInput = {}): string {
  const normalizedStatus = String(status || '');
  const fixRan = hasFixActivity({ iterations, agentFix, grokFix, fixAgent });
  const reviewSummary = agentReview || codexReview || grokReview;
  const effectiveReviewAgent = reviewAgent || (codexReview ? 'codex' : grokReview ? 'grok' : null);

  if (normalizedStatus === 'DONE_GATE_ONLY') return 'gate-only';
  if (normalizedStatus === 'DONE_FIXED') return `${fixAgent}-fix`;
  if (normalizedStatus === 'DONE_REVIEWED') {
    if (fixRan && effectiveReviewAgent) return `${fixAgent}-fix+${effectiveReviewAgent}-review`;
    if (effectiveReviewAgent) return `${effectiveReviewAgent}-review`;
    return fixRan ? `${fixAgent}-fix+codex-review` : 'codex-review';
  }
  if (normalizedStatus === 'PAUSED_BEFORE_FIX') return 'paused-before-fix';
  if (normalizedStatus === 'PAUSED_AFTER_ITERATION') return 'paused-after-iteration';
  if (normalizedStatus === 'HALT_BUDGET') return 'halt-budget';
  if (normalizedStatus === 'HALT_NO_CHANGES') return 'halt-no-changes';
  if (normalizedStatus === 'HALT_NO_PROGRESS') return 'halt-no-progress';
  if (normalizedStatus === 'HALT_AGENT_NOT_FOUND') return 'agent-missing';
  if (normalizedStatus === 'HALT_HUMAN') {
    if (reviewSummary) return `halt-human-after-${effectiveReviewAgent || 'agent'}-review`;
    if ((agentFix || grokFix)?.timedOut) return `${fixAgent}-fix-timeout`;
    if (agentFix || grokFix) return `halt-human-after-${fixAgent}-fix`;
    return 'halt-human';
  }

  if (reviewSummary && fixRan) return `${fixAgent}-fix+${effectiveReviewAgent || 'review'}-review`;
  if (fixRan) return (agentFix || grokFix)?.timedOut ? `${fixAgent}-fix-timeout` : `${fixAgent}-fix`;
  if (reviewSummary) return `${effectiveReviewAgent || 'agent'}-review`;
  if (Array.isArray(iterations) && iterations.length > 0) return 'in-progress';
  return normalizedStatus ? normalizedStatus.toLowerCase().replace(/_/g, '-') : 'unknown';
}

export function resolveDisplayTimeZone(explicitTimeZone?: string): string {
  if (explicitTimeZone) return explicitTimeZone;
  if (process.env.TZ) return process.env.TZ;
  return 'Asia/Shanghai';
}

export function summarizeRunRecord({
  runId = null,
  status = null,
  task = null,
  iterations = [],
  grokFix = null,
  agentFix = null,
  codexReview = null,
  grokReview = null,
  agentReview = null,
  fixAgent = 'grok',
  reviewAgent = 'grok',
  timeZone = resolveDisplayTimeZone(),
}: SummarizeRunInput = {}): RunRecordSummary {
  const iterationCount = Array.isArray(iterations) ? iterations.length : Number(iterations || 0) || 0;
  const fixRan = hasFixActivity({ iterations, agentFix, grokFix, fixAgent });
  const effectiveReview = agentReview || codexReview || grokReview;
  const grokRan = (fixAgent === 'grok' && fixRan) || (reviewAgent === 'grok' && Boolean(effectiveReview));
  const codexRan = (fixAgent === 'codex' && fixRan) || (reviewAgent === 'codex' && Boolean(effectiveReview));
  const displayTimeZone = resolveDisplayTimeZone(timeZone);
  return {
    runId: runId ?? null,
    runTimeLocal: formatRunTimestamp(runId, { timeZone: displayTimeZone, label: displayTimeZone }),
    runTimeUtc: formatRunTimestamp(runId, { timeZone: 'UTC', label: 'UTC' }),
    status: status ?? null,
    task: task ?? null,
    fixAgent,
    reviewAgent: reviewAgent || null,
    runMode: classifyRunMode({
      status,
      iterations,
      grokFix,
      agentFix,
      codexReview,
      grokReview,
      agentReview,
      fixAgent,
      reviewAgent,
    }),
    grokRan,
    codexRan,
    reviewAgentRan: Boolean(effectiveReview),
    iterations: iterationCount,
  };
}

export function summarizeStateRun(state: LoopState, runId: string): RunRecordSummary {
  return summarizeRunRecord({
    runId: state.runId || runId,
    status: state.status || null,
    task: state.options?.task || null,
    iterations: state.iterations || [],
    grokFix: state.grokFix || null,
    agentFix: state.agentFix || null,
    codexReview: state.codexReview || null,
    grokReview: state.grokReview || null,
    agentReview: state.agentReview || null,
    fixAgent: state.options?.fixAgent || 'grok',
    reviewAgent: state.options?.skipReview ? null : (state.options?.reviewAgent || 'grok'),
  });
}

export function formatRunTimestamp(
  runId: string | null | undefined,
  { timeZone = 'Asia/Shanghai', label = timeZone }: { timeZone?: string; label?: string } = {},
): string {
  const date = parseRunIdDate(runId);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second} (${label})`;
}

export function parseRunIdDate(runId: string | null | undefined): Date | null {
  if (!runId) return null;
  const match = String(runId).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms = '000'] = match;
  return new Date(Date.UTC(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10),
    Number.parseInt(ms, 10),
  ));
}

function hasFixActivity({
  iterations = [],
  agentFix = null,
  grokFix = null,
  fixAgent = 'grok',
}: {
  iterations?: IterationRef[];
  agentFix?: AgentRunRef | null;
  grokFix?: AgentRunRef | null;
  fixAgent?: string;
} = {}): boolean {
  if (fixAgent === 'grok') return hasGrokActivity({ iterations, grokFix: grokFix || agentFix });
  if (agentFix) return true;
  return iterations.some((iteration) => iteration.agentFix || iteration.attempts?.some((attempt) => attempt.agentFix));
}

function hasGrokActivity({
  iterations = [],
  grokFix = null,
}: {
  iterations?: IterationRef[];
  grokFix?: AgentRunRef | null;
} = {}): boolean {
  if (grokFix) return true;
  return Array.isArray(iterations) && iterations.some((iteration) => {
    if (iteration?.grokFix) return true;
    return iteration?.attempts?.some((attempt) => attempt.grokFix) ?? false;
  });
}