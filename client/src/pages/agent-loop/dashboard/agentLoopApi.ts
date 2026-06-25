// HTTP adapter + presenter for the AgentLoop dashboard.
//
// Replaces the VS Code extension host's stateReader/dashboardPanel layer: fetches the
// Python `/api/agent-loop/*` endpoints and projects their raw run state into the
// OverviewPayload / DetailPayload shapes that DashboardApp renders.

import type { DetailPayload, OverviewPayload, OverviewTask } from "./dashboardTypes";
import {
  activeAgentLabel,
  buildPipelineSteps,
  formatElapsed,
  isAttentionStatus,
  isDoneStatus,
  isRunningStatus,
  outcomeGroupFor,
  phaseLabel,
  resolveAgentRoles,
} from "./phaseLabels";

const BASE = "/api/agent-loop";

export type AgentLoopRunSummary = {
  runId: string;
  status?: string | null;
  task?: string | null;
  runMode?: string | null;
  iterations?: number | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  runTimeLocal?: string | null;
  runTimeUtc?: string | null;
};

function shortTaskLabel(taskPath: string | null | undefined): string {
  if (!taskPath) return "-";
  return (taskPath.split("/").pop() || taskPath).replace(/\.md$/, "");
}

function agentPair(fix?: string | null, review?: string | null): string {
  const f = fix || "grok";
  const r = review || "codex";
  return `${f} / ${r}`;
}

function formatClock(ts: string | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ---- Overview -------------------------------------------------------------

function summaryToTask(run: AgentLoopRunSummary): OverviewTask {
  const running = isRunningStatus(run.status);
  return {
    id: run.runId,
    task: run.task || run.runId,
    taskLabel: shortTaskLabel(run.task),
    statusLabel: phaseLabel(run.status),
    outcomeGroup: outcomeGroupFor(run.status, running),
    running,
    enabled: true,
    agent: agentPair(run.fixAgent, run.reviewAgent),
    fixAgent: run.fixAgent ?? null,
    reviewAgent: run.reviewAgent ?? null,
    lastUpdatedText: run.runTimeLocal || run.runTimeUtc || "-",
  };
}

function deriveCounts(runs: AgentLoopRunSummary[]): Record<string, number> {
  let running = 0;
  let done = 0;
  let reviewed = 0;
  let failed = 0;
  let pending = 0;
  for (const run of runs) {
    if (isRunningStatus(run.status)) running += 1;
    else if (isDoneStatus(run.status)) {
      done += 1;
      if (String(run.status || "").toUpperCase().includes("REVIEW")) reviewed += 1;
    } else if (isAttentionStatus(run.status)) failed += 1;
    else pending += 1;
  }
  return {
    queueTotal: runs.length,
    total: runs.length,
    running,
    done,
    reviewed,
    failed,
    pending,
  };
}

export async function fetchOverview(): Promise<OverviewPayload> {
  const runs = await getJson<AgentLoopRunSummary[]>(`${BASE}/runs/overview`);
  const list = Array.isArray(runs) ? runs : [];
  const tasks = list.map(summaryToTask);
  const counts = deriveCounts(list);
  const currentRun = list.find((run) => isRunningStatus(run.status)) || null;
  return {
    queueRunning: Boolean(currentRun),
    counts,
    tasks,
    current: currentRun
      ? {
          taskLabel: shortTaskLabel(currentRun.task),
          phaseLabel: phaseLabel(currentRun.status),
          status: currentRun.status ?? null,
          elapsedText: null,
        }
      : null,
  };
}

// ---- Detail ---------------------------------------------------------------

type RawState = {
  runId?: string | null;
  status?: string | null;
  task?: { path?: string | null } | string | null;
  options?: { task?: string | null; fixAgent?: string | null; reviewAgent?: string | null; skipReview?: boolean | null } | null;
  iterations?: Array<Record<string, unknown>> | null;
  events?: Array<{ status?: string | null; ts?: string | null; iteration?: number | null }> | null;
  reviewRounds?: Array<Record<string, unknown>> | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  commit?: string | null;
  landing?: Record<string, unknown> | null;
  artifacts?: Array<{ id?: string; kind?: string; title?: string | null; path?: string | null }> | null;
};

function taskPathOf(state: RawState): string | null {
  if (typeof state.task === "string") return state.task;
  if (state.task && typeof state.task === "object") return state.task.path ?? null;
  return state.options?.task ?? null;
}

function markPipeline(steps: ReturnType<typeof buildPipelineSteps>, state: RawState) {
  const seen = new Set((state.events || []).map((e) => String(e.status || "")));
  const status = state.status || "";
  return steps.map((step) => {
    const reached = seen.has(step.key);
    const active = step.key === status;
    // DONE step is done when the run reached any terminal DONE_* status.
    const done = step.key === "DONE" ? isDoneStatus(status) : reached && !active;
    return { ...step, done, active };
  });
}

function elapsedMsOf(state: RawState): number {
  const start = state.startedAt ? new Date(state.startedAt).getTime() : NaN;
  const end = state.updatedAt ? new Date(state.updatedAt).getTime() : Date.now();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, end - start);
}

export async function fetchDetail(runId: string): Promise<DetailPayload> {
  const state = await getJson<RawState>(`${BASE}/runs/${encodeURIComponent(runId)}`);
  const roles = resolveAgentRoles(state);
  const steps = markPipeline(buildPipelineSteps(state), state);
  const elapsedMs = elapsedMsOf(state);

  const events = (state.events || []).map((event) => ({
    status: event.status ?? null,
    label: phaseLabel(event.status),
    timeText: formatClock(event.ts),
    iteration: event.iteration ?? null,
  }));

  const reviewRounds = (state.reviewRounds || []).map((round) => ({
    round: round.round ?? null,
    verdict: round.verdict ?? null,
    decision: round.decision ?? null,
    summary: round.summary ?? null,
    riskLevel: round.riskLevel ?? null,
    findings: Array.isArray(round.findings) ? round.findings : [],
  }));

  const iterations = (state.iterations || []).map((iteration, index) => ({
    iteration: (iteration.iteration as number) ?? index + 1,
    ...iteration,
  }));

  const encId = encodeURIComponent(state.runId ?? runId);

  // Derive report/landing/state paths from artifact truth (111).
  // Use explicit /artifacts/{name} subroutes (distinct per semantic resource).
  // Fall back only if no artifact index entry (missing degrades cleanly, no crash, no lie).
  // Never collapse distinct artifacts onto identical generic routes.
  const arts = (state.artifacts || []) as Array<{ id?: string; kind?: string; title?: string | null; path?: string | null }>;
  function pickArt(cands: string[], kindHint?: string): string | null {
    for (const c of cands) {
      if (arts.some((a) => a && (a.id === c || a.path === c || (a.title || "") === c))) return c;
    }
    if (kindHint) {
      const m = arts.find((a) => a && ((a.kind || "").includes(kindHint) || (a.id || "").includes(kindHint)));
      if (m && m.id) return m.id;
    }
    return null;
  }
  const reportMd = pickArt(["final-report.md", "report.md", "final-report"], "report");
  const reportJson = pickArt(["final-report.json", "report.json"], "report");
  const landingArt = pickArt(["landing.json", "landing"], "landing");
  const stateArt = pickArt(["state.json"], "state");

  const reportP = reportMd ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(reportMd)}` : `${BASE}/runs/${encId}`;
  const reportJsonP = reportJson ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(reportJson)}` : (reportP !== `${BASE}/runs/${encId}` ? reportP : `${BASE}/runs/${encId}`);
  const landingP = landingArt ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(landingArt)}` : `${BASE}/runs/${encId}/snapshot`;
  const stateP = stateArt ? `${BASE}/runs/${encId}/artifacts/${encodeURIComponent(stateArt)}` : `${BASE}/runs/${encId}/snapshot`;

  return {
    taskLabel: shortTaskLabel(taskPathOf(state)),
    taskPath: taskPathOf(state),
    runId: state.runId ?? runId,
    status: state.status ?? null,
    phaseLabel: phaseLabel(state.status),
    elapsedText: formatElapsed(elapsedMs),
    agentText: activeAgentLabel(state.status, roles),
    fixAgent: roles.fixAgent,
    reviewAgent: roles.reviewAgent,
    commit: state.commit ?? null,
    activeTab: "review",
    pipelineSteps: steps,
    iterations,
    reviewRounds,
    events,
    landing: state.landing ?? null,
    reportPath: reportP,
    reportJsonPath: reportJsonP,
    landingPath: landingP,
    statePath: stateP,
  };
}

// ---- Settings & Control (bridge for DashboardApp settings + run buttons) ----

export async function fetchSettings(): Promise<any> {
  return getJson(`${BASE}/settings`);
}

export async function saveSettings(values: Record<string, unknown>): Promise<any> {
  // Strip secret fields: /settings backend is non-secret only; never forward or claim persistence for LLM keys
  const SECRET_KEYS = ['grokApiKey', 'openaiApiKey', 'anthropicApiKey'];
  const clean: Record<string, unknown> = {};
  let hadSecret = false;
  for (const [k, v] of Object.entries(values || {})) {
    if (SECRET_KEYS.includes(k)) {
      hadSecret = true;
      continue;
    }
    clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    if (hadSecret) {
      // explicitly do not report success for secret save/clear against nonsecret backend
      return { ok: false, secretsIgnored: true };
    }
    return { ok: true };
  }
  const res = await fetch(`${BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clean),
  });
  if (!res.ok) throw new Error(`POST /settings → HTTP ${res.status}`);
  const json = await res.json();
  if (hadSecret) {
    return { ...(json && typeof json === 'object' ? json : {}), secretsIgnored: true };
  }
  return json;
}

export async function fetchProviderHealth(): Promise<any> {
  return getJson(`${BASE}/provider-health`);
}

export async function runQueue(payload: Record<string, unknown> = {}): Promise<any> {
  const body: any = {
    mode: "queue",
    dryRun: false,
    ...(payload.queue ? { queue: payload.queue } : {}),
  };
  const res = await fetch(`${BASE}/queue/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /queue/run → HTTP ${res.status}`);
  return res.json();
}

export async function runSingleTask(payload: Record<string, unknown> = {}): Promise<any> {
  const task = payload.task || payload.taskPath || "";
  const body: any = { task: String(task || ""), mode: "single", dryRun: false };
  const res = await fetch(`${BASE}/task/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /task/run → HTTP ${res.status}`);
  return res.json();
}

export async function cancelCurrent(payload: Record<string, unknown> = {}): Promise<any> {
  const body: any = payload.task ? { task: payload.task } : {};
  const res = await fetch(`${BASE}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /cancel → HTTP ${res.status}`);
  return res.json();
}
