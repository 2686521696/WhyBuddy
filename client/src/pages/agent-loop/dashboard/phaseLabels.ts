// Ported from agent-loop/vscode-extension/src/phaseLabels.ts — the pure presenter
// helpers that turn raw loop status/state into the Chinese labels and pipeline steps
// the dashboard renders. The only host dependency (getAgentLoopConfig) is replaced
// with static defaults, since per-run fix/review agents come from the API payload.

export type PipelineStep = { key: string; label: string; done?: boolean; active?: boolean };

const DEFAULT_FIX_AGENT = "grok";
const DEFAULT_REVIEW_AGENT = "codex";

export const PHASE_LABELS_ZH: Record<string, string> = {
  INIT: "初始化",
  RESUMED: "恢复运行",
  PROBED: "探测 agent",
  WORKTREE_READY: "worktree 就绪",
  BASELINE_GATE_RESULT: "基线 gate 完成",
  BUDGET_LOOP_HEAD: "修复轮次开始",
  GROK_FIX: "Grok 修复中",
  CODEX_FIX: "Codex 修复中",
  POST_FIX_GATE_RESULT: "修复后 gate 完成",
  CODEX_REVIEW: "Codex review 中",
  GROK_REVIEW: "Grok review 中",
  DONE_REVIEWED: "完成（已 review）",
  DONE_FIXED: "完成（已修复）",
  DONE_GATE_ONLY: "完成（仅 gate）",
  MANUAL_RESCUE_LANDED: "人工救回",
  HALT_HUMAN: "需人工接管",
  HALT_NO_CHANGES: "修复无有效 diff",
  HALT_NO_PROGRESS: "gate 无进展",
  HALT_BUDGET: "达到最大轮次",
  HALT_AGENT_NOT_FOUND: "缺少 agent",
  HALT_NO_SUCCESS_CRITERIA: "缺少成功标准",
  HALT_STOPPED: "已停止",
  PAUSED_BEFORE_FIX: "修复前暂停",
  PAUSED_AFTER_ITERATION: "迭代后暂停",
};

type RolesSource = {
  options?: { fixAgent?: string | null; reviewAgent?: string | null; skipReview?: boolean | null } | null;
} | null;

export function resolveAgentRoles(state: RolesSource): { fixAgent: string; reviewAgent: string | null } {
  const fixAgent = state?.options?.fixAgent || DEFAULT_FIX_AGENT;
  const skipReview = state?.options?.skipReview ?? false;
  let reviewAgent: string | null = skipReview
    ? null
    : state?.options?.reviewAgent || DEFAULT_REVIEW_AGENT;
  if (reviewAgent === "none") reviewAgent = null;
  return { fixAgent, reviewAgent };
}

export function buildPipelineSteps(state: RolesSource): PipelineStep[] {
  const { fixAgent, reviewAgent } = resolveAgentRoles(state);
  const fixKey = fixAgent === "codex" ? "CODEX_FIX" : "GROK_FIX";
  const fixLabel = fixAgent === "codex" ? "Codex" : "Grok";
  const steps: PipelineStep[] = [
    { key: "INIT", label: "初始化" },
    { key: "PROBED", label: "探测" },
    { key: "WORKTREE_READY", label: "Worktree" },
    { key: "BASELINE_GATE_RESULT", label: "基线 Gate" },
    { key: fixKey, label: fixLabel },
    { key: "POST_FIX_GATE_RESULT", label: "修复 Gate" },
  ];
  if (reviewAgent) {
    const reviewKey = reviewAgent === "grok" ? "GROK_REVIEW" : "CODEX_REVIEW";
    const reviewLabel = reviewAgent === "grok" ? "Grok" : "Codex";
    steps.push({ key: reviewKey, label: reviewLabel });
  }
  steps.push({ key: "DONE", label: "完成" });
  return steps;
}

export function phaseLabel(status: string | undefined | null): string {
  if (!status) return "等待运行";
  if (status === "STALE_INTERRUPTED") return "运行中断";
  if (status === "MANUAL_RESCUE_LANDED") return PHASE_LABELS_ZH[status];
  if (status.startsWith("DONE_")) return PHASE_LABELS_ZH[status] || "完成";
  if (status.startsWith("HALT_")) return PHASE_LABELS_ZH[status] || "已停止";
  return PHASE_LABELS_ZH[status] || status;
}

export function activeAgentLabel(
  status: string | undefined | null,
  roles: { fixAgent: string; reviewAgent: string | null },
): string {
  if (!status) return "-";
  if (status === "GROK_FIX" || status === "GROK_REVIEW") return "Grok";
  if (status === "CODEX_FIX" || status === "CODEX_REVIEW") return "Codex";
  const { fixAgent, reviewAgent } = roles;
  if (status === "BUDGET_LOOP_HEAD") return fixAgent === "codex" ? "Codex" : "Grok";
  if (status.startsWith("DONE_") || status.startsWith("HALT_")) {
    const parts = [fixAgent, reviewAgent].filter(Boolean);
    return parts.length ? parts.join(" + ") : "-";
  }
  return "-";
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

const RUNNING_STATUSES = new Set([
  "INIT",
  "RESUMED",
  "PROBED",
  "WORKTREE_READY",
  "BASELINE_GATE_RESULT",
  "BUDGET_LOOP_HEAD",
  "GROK_FIX",
  "CODEX_FIX",
  "POST_FIX_GATE_RESULT",
  "CODEX_REVIEW",
  "GROK_REVIEW",
]);

export function isRunningStatus(status: string | undefined | null): boolean {
  return Boolean(status && RUNNING_STATUSES.has(status));
}

export function isDoneStatus(status: string | undefined | null): boolean {
  const s = String(status || "").toUpperCase();
  return s.startsWith("DONE") || s === "MANUAL_RESCUE_LANDED";
}

export function isAttentionStatus(status: string | undefined | null): boolean {
  const s = String(status || "").toUpperCase();
  return s.startsWith("HALT") || s.includes("FAILED") || s.includes("CONFLICT");
}

/** Map a status into the coarse outcome group the queue table colors/filters by. */
export function outcomeGroupFor(status: string | undefined | null, running: boolean): string {
  if (running) return "running";
  if (isDoneStatus(status)) {
    const s = String(status || "").toUpperCase();
    if (s.includes("REVIEW")) return "reviewed";
    return "done";
  }
  if (isAttentionStatus(status)) return "failed";
  return "pending";
}
