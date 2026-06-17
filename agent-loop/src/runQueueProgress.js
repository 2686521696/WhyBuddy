import fs from 'node:fs/promises';
import path from 'node:path';

const TERMINAL_STATUSES = new Set([
  'DONE_REVIEWED',
  'DONE_FIXED',
  'DONE_GATE_ONLY',
  'HALT_HUMAN',
  'HALT_NO_CHANGES',
  'HALT_NO_PROGRESS',
  'HALT_BUDGET',
  'HALT_AGENT_NOT_FOUND',
  'PAUSED_BEFORE_FIX',
  'PAUSED_AFTER_ITERATION',
]);

export const PHASE_LABELS_ZH = {
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
  HALT_NO_CHANGES: 'Grok 无有效 diff',
  HALT_NO_PROGRESS: 'gate 无进展',
  HALT_BUDGET: '达到最大轮次',
  HALT_AGENT_NOT_FOUND: '缺少 agent',
  PAUSED_BEFORE_FIX: '修复前暂停',
  PAUSED_AFTER_ITERATION: '迭代后暂停',
};

export async function readLatestState(repoRoot) {
  const statePath = path.join(repoRoot, '.agent-loop', 'latest', 'state.json');
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function describeLoopSnapshot(state) {
  if (!state) {
    return { status: null, label: '等待 state.json', details: [] };
  }

  const details = [];
  const status = state.status || 'UNKNOWN';
  const phaseLabel = PHASE_LABELS_ZH[status] || status;

  if (state.currentIteration) details.push(`轮次 ${state.currentIteration}`);
  if (state.baselineGate?.ok === true) details.push('基线 gate 绿');
  if (state.baselineGate?.ok === false) details.push(`基线 gate 红 (${state.baselineGate.failureCount ?? '?'})`);
  if (state.worktree?.fixCwd) details.push(`fix=${path.basename(state.worktree.fixCwd)}`);
  if (Array.isArray(state.iterations) && state.iterations.length) {
    details.push(`已完成迭代 ${state.iterations.length}`);
  }

  return { status, label: phaseLabel, details };
}

export function formatProgressLine({
  taskLabel,
  eventType = 'status',
  snapshot,
  phaseElapsedMs = 0,
  taskElapsedMs = 0,
  agentHint = null,
}) {
  const prefix = `[run-queue] ${taskLabel}`;
  const phase = snapshot?.label || '未知阶段';
  const status = snapshot?.status || 'UNKNOWN';
  const detailText = snapshot?.details?.length ? ` | ${snapshot.details.join(', ')}` : '';

  if (eventType === 'heartbeat') {
    const hint = agentHint ? ` | ${agentHint}` : '';
    return `${prefix} · 仍在 ${phase} (${status}) · 本阶段 ${formatElapsed(phaseElapsedMs)} · 总耗时 ${formatElapsed(taskElapsedMs)}${hint}`;
  }

  if (eventType === 'status') {
    return `${prefix} → ${phase} (${status}) · 本阶段开始 · 总耗时 ${formatElapsed(taskElapsedMs)}${detailText}`;
  }

  return `${prefix} · ${phase} (${status})${detailText}`;
}

export function createLoopProgressWatcher({
  repoRoot,
  taskLabel,
  onEvent,
  intervalMs = 2000,
  heartbeatMs = 30000,
  readState = readLatestState,
  now = () => Date.now(),
}) {
  let stopped = false;
  let lastStatus = null;
  let lastHeartbeatAt = 0;
  let phaseStartedAt = now();
  const taskStartedAt = now();
  let timer = null;

  async function poll() {
    if (stopped) return;

    const state = await readState(repoRoot);
    const snapshot = describeLoopSnapshot(state);
    const current = now();

    if (snapshot.status !== lastStatus) {
      lastStatus = snapshot.status;
      phaseStartedAt = current;
      lastHeartbeatAt = current;
      onEvent({
        type: 'status',
        snapshot,
        phaseElapsedMs: 0,
        taskElapsedMs: current - taskStartedAt,
      });
      if (snapshot.status && TERMINAL_STATUSES.has(snapshot.status)) {
        stop();
      }
      return;
    }

    if (current - lastHeartbeatAt >= heartbeatMs) {
      lastHeartbeatAt = current;
      onEvent({
        type: 'heartbeat',
        snapshot,
        phaseElapsedMs: current - phaseStartedAt,
        taskElapsedMs: current - taskStartedAt,
      });
    }
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  timer = setInterval(() => {
    poll().catch(() => {});
  }, intervalMs);
  poll().catch(() => {});

  return { stop };
}