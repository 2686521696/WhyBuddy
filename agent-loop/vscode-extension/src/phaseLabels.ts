import type { LoopState, PipelineStep, QueueDefaults } from './types';

export const PHASE_LABELS_ZH: Record<string, string> = {
  INIT: '初始化',
  RESUMED: '恢复运行',
  PROBED: '探测 agent',
  WORKTREE_READY: 'worktree 就绪',
  BASELINE_GATE_RESULT: '基线 gate 完成',
  BUDGET_LOOP_HEAD: '修复轮次开始',
  GROK_FIX: 'Grok 修复中',
  CODEX_FIX: 'Codex 修复中',
  POST_FIX_GATE_RESULT: '修复后 gate 完成',
  CODEX_REVIEW: 'Codex review 中',
  GROK_REVIEW: 'Grok review 中',
  DONE_REVIEWED: '完成（已 review）',
  DONE_FIXED: '完成（已修复）',
  DONE_GATE_ONLY: '完成（仅 gate）',
  MANUAL_RESCUE_LANDED: '人工救回',
  HALT_HUMAN: '需人工接管',
  HALT_NO_CHANGES: '修复无有效 diff',
  HALT_NO_PROGRESS: 'gate 无进展',
  HALT_BUDGET: '达到最大轮次',
  HALT_AGENT_NOT_FOUND: '缺少 agent',
  HALT_NO_SUCCESS_CRITERIA: '缺少成功标准',
  HALT_STOPPED: '已停止',
  PAUSED_BEFORE_FIX: '修复前暂停',
  PAUSED_AFTER_ITERATION: '迭代后暂停',
};

export const PHASE_FLOW = [
  'INIT',
  'PROBED',
  'WORKTREE_READY',
  'BASELINE_GATE_RESULT',
  'GROK_FIX',
  'POST_FIX_GATE_RESULT',
  'GROK_REVIEW',
  'DONE',
] as const;

export function resolveAgentRoles(
  state: LoopState | null,
  queueDefaults: QueueDefaults | null = null,
): { fixAgent: string; reviewAgent: string | null } {
  const fixAgent = state?.options?.fixAgent || queueDefaults?.fixAgent || 'grok';
  const skipReview = state?.options?.skipReview ?? queueDefaults?.skipReview ?? false;
  const reviewAgent = skipReview ? null : (state?.options?.reviewAgent || queueDefaults?.reviewAgent || 'grok');
  return { fixAgent, reviewAgent };
}

export function buildPipelineSteps(
  state: LoopState | null,
  queueDefaults: QueueDefaults | null = null,
): PipelineStep[] {
  const { fixAgent, reviewAgent } = resolveAgentRoles(state, queueDefaults);
  const fixKey = fixAgent === 'codex' ? 'CODEX_FIX' : 'GROK_FIX';
  const fixLabel = fixAgent === 'codex' ? 'Codex' : 'Grok';
  const steps: PipelineStep[] = [
    { key: 'INIT', label: '初始化' },
    { key: 'PROBED', label: '探测' },
    { key: 'WORKTREE_READY', label: 'Worktree' },
    { key: 'BASELINE_GATE_RESULT', label: '基线 Gate' },
    { key: fixKey, label: fixLabel },
    { key: 'POST_FIX_GATE_RESULT', label: '修复 Gate' },
  ];
  if (reviewAgent) {
    const reviewKey = reviewAgent === 'grok' ? 'GROK_REVIEW' : 'CODEX_REVIEW';
    const reviewLabel = reviewAgent === 'grok' ? 'Grok' : 'Codex';
    steps.push({ key: reviewKey, label: reviewLabel });
  }
  steps.push({ key: 'DONE', label: '完成' });
  return steps;
}

export type ResolvedAgentRoles = { fixAgent: string; reviewAgent: string | null };

export function activeAgentLabel(
  status: string | undefined,
  state: LoopState | null,
  resolvedRoles: ResolvedAgentRoles | null = null,
  queueDefaults: QueueDefaults | null = null,
): string {
  if (!status) return '-';
  if (status === 'GROK_FIX' || status === 'GROK_REVIEW') return 'Grok';
  if (status === 'CODEX_FIX' || status === 'CODEX_REVIEW') return 'Codex';
  const { fixAgent, reviewAgent } = resolvedRoles ?? resolveAgentRoles(state, queueDefaults);
  if (status === 'BUDGET_LOOP_HEAD') return fixAgent === 'codex' ? 'Codex' : 'Grok';
  if (status.startsWith('DONE_') || status.startsWith('HALT_')) {
    const parts = [fixAgent, reviewAgent].filter(Boolean);
    return parts.length ? parts.join(' + ') : '-';
  }
  return '-';
}

export function phaseLabel(status: string | undefined): string {
  if (!status) return '等待运行';
  if (status === 'STALE_INTERRUPTED') return '运行中断';
  if (status === 'MANUAL_RESCUE_LANDED') return PHASE_LABELS_ZH[status];
  if (status.startsWith('DONE_')) return PHASE_LABELS_ZH[status] || '完成';
  if (status.startsWith('HALT_')) return PHASE_LABELS_ZH[status] || '已停止';
  return PHASE_LABELS_ZH[status] || status;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

export function statusIcon(status: string | undefined): string {
  if (!status) return '$(circle-outline)';
  if (status === 'STALE_INTERRUPTED') return '$(debug-disconnect)';
  if (status.startsWith('DONE_')) return '$(check)';
  if (status === 'CODEX_REVIEW' || status === 'GROK_REVIEW') return '$(eye)';
  if (status === 'GROK_FIX' || status === 'CODEX_FIX') return '$(tools)';
  if (status.startsWith('HALT_')) return '$(warning)';
  if (status.startsWith('PAUSED_')) return '$(debug-pause)';
  return '$(sync~spin)';
}

export function describeSnapshot(
  state: LoopState | null,
  queueDefaults: QueueDefaults | null = null,
): { details: string[]; taskLabel: string } {
  if (!state) {
    return { details: ['暂无运行记录'], taskLabel: '-' };
  }

  const details: string[] = [];
  const taskLabel = state.options?.task?.split('/').pop()?.replace(/\.md$/, '') || '-';

  if (state.currentIteration) details.push(`轮次 ${state.currentIteration}`);
  if (state.baselineGate?.ok === true) details.push('基线 gate 绿');
  if (state.baselineGate?.ok === false) details.push(`基线 gate 红 (${state.baselineGate.failureCount ?? '?'})`);
  if (state.worktree?.fixCwd) {
    const parts = state.worktree.fixCwd.split(/[\\/]/);
    details.push(`worktree: ${parts[parts.length - 1]}`);
  }
  if (Array.isArray(state.iterations) && state.iterations.length) {
    details.push(`已完成迭代 ${state.iterations.length}`);
  }
  const { fixAgent, reviewAgent } = resolveAgentRoles(state, queueDefaults);
  if (state.agentFix?.timedOut || state.grokFix?.timedOut) {
    details.push(`${fixAgent} 修复超时`);
  }
  const reviewTimedOut = state.agentReview?.timedOut || state.codexReview?.timedOut || state.grokReview?.timedOut;
  if (reviewTimedOut && reviewAgent) details.push(`${reviewAgent} review 超时`);

  return { details, taskLabel };
}
