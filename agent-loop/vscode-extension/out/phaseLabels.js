"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_FLOW = exports.PHASE_LABELS_ZH = void 0;
exports.resolveAgentRoles = resolveAgentRoles;
exports.buildPipelineSteps = buildPipelineSteps;
exports.activeAgentLabel = activeAgentLabel;
exports.phaseLabel = phaseLabel;
exports.formatElapsed = formatElapsed;
exports.statusIcon = statusIcon;
exports.describeSnapshot = describeSnapshot;
exports.PHASE_LABELS_ZH = {
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
    HALT_HUMAN: '需人工接管',
    HALT_NO_CHANGES: '修复无有效 diff',
    HALT_NO_PROGRESS: 'gate 无进展',
    HALT_BUDGET: '达到最大轮次',
    HALT_AGENT_NOT_FOUND: '缺少 agent',
    PAUSED_BEFORE_FIX: '修复前暂停',
    PAUSED_AFTER_ITERATION: '迭代后暂停',
};
exports.PHASE_FLOW = [
    'INIT',
    'PROBED',
    'WORKTREE_READY',
    'BASELINE_GATE_RESULT',
    'GROK_FIX',
    'POST_FIX_GATE_RESULT',
    'GROK_REVIEW',
    'DONE',
];
function resolveAgentRoles(state, queueDefaults = null) {
    const fixAgent = state?.options?.fixAgent || queueDefaults?.fixAgent || 'grok';
    const skipReview = state?.options?.skipReview ?? queueDefaults?.skipReview ?? false;
    const reviewAgent = skipReview ? null : (state?.options?.reviewAgent || queueDefaults?.reviewAgent || 'grok');
    return { fixAgent, reviewAgent };
}
function buildPipelineSteps(state, queueDefaults = null) {
    const { fixAgent, reviewAgent } = resolveAgentRoles(state, queueDefaults);
    const fixKey = fixAgent === 'codex' ? 'CODEX_FIX' : 'GROK_FIX';
    const fixLabel = fixAgent === 'codex' ? 'Codex' : 'Grok';
    const steps = [
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
function activeAgentLabel(status, state, resolvedRoles = null, queueDefaults = null) {
    if (!status)
        return '—';
    if (status === 'GROK_FIX' || status === 'GROK_REVIEW')
        return 'Grok';
    if (status === 'CODEX_FIX' || status === 'CODEX_REVIEW')
        return 'Codex';
    const { fixAgent, reviewAgent } = resolvedRoles ?? resolveAgentRoles(state, queueDefaults);
    if (status === 'BUDGET_LOOP_HEAD')
        return fixAgent === 'codex' ? 'Codex' : 'Grok';
    if (status.startsWith('DONE_') || status.startsWith('HALT_')) {
        const parts = [fixAgent, reviewAgent].filter(Boolean);
        return parts.length ? parts.join(' + ') : '—';
    }
    return '—';
}
function phaseLabel(status) {
    if (!status)
        return '等待运行';
    if (status.startsWith('DONE_'))
        return exports.PHASE_LABELS_ZH[status] || '完成';
    if (status.startsWith('HALT_'))
        return exports.PHASE_LABELS_ZH[status] || '已停止';
    return exports.PHASE_LABELS_ZH[status] || status;
}
function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0)
        return `${seconds} 秒`;
    return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}
function statusIcon(status) {
    if (!status)
        return '$(circle-outline)';
    if (status.startsWith('DONE_'))
        return '$(check)';
    if (status === 'CODEX_REVIEW' || status === 'GROK_REVIEW')
        return '$(eye)';
    if (status === 'GROK_FIX' || status === 'CODEX_FIX')
        return '$(tools)';
    if (status.startsWith('HALT_'))
        return '$(warning)';
    if (status.startsWith('PAUSED_'))
        return '$(debug-pause)';
    return '$(sync~spin)';
}
function describeSnapshot(state, queueDefaults = null) {
    if (!state) {
        return { details: ['尚无运行记录'], taskLabel: '—' };
    }
    const details = [];
    const taskLabel = state.options?.task?.split('/').pop()?.replace(/\.md$/, '') || '—';
    if (state.currentIteration)
        details.push(`轮次 ${state.currentIteration}`);
    if (state.baselineGate?.ok === true)
        details.push('基线 gate 绿');
    if (state.baselineGate?.ok === false)
        details.push(`基线 gate 红 (${state.baselineGate.failureCount ?? '?'})`);
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
    if (reviewTimedOut && reviewAgent)
        details.push(`${reviewAgent} review 超时`);
    return { details, taskLabel };
}
//# sourceMappingURL=phaseLabels.js.map