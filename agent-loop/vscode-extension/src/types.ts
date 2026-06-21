export interface LoopState {
  runId?: string;
  status?: string;
  options?: {
    task?: string;
    timeoutMs?: number;
    gates?: string[];
    skipReview?: boolean;
    autoFix?: boolean;
    fixAgent?: 'grok' | 'codex';
    reviewAgent?: 'grok' | 'codex';
  };
  currentIteration?: number;
  baselineGate?: {
    ok?: boolean;
    failureCount?: number;
    progress?: { effectiveFailureCount?: number };
  };
  baselineGateSnapshot?: GateSnapshot | null;
  worktree?: {
    fixCwd?: string;
    targetCwd?: string;
  };
  iterations?: Array<{
    iteration: number;
    grokFix?: AgentRunSummary | null;
    agentFix?: AgentRunSummary | null;
    gate?: GateSummary | null;
    gateSnapshot?: GateSnapshot | null;
    gateProgress?: { effectiveFailureCount?: number; innerFailureCount?: number | null };
    diff?: { bytes?: number };
    diffGuard?: { hasFindings?: boolean; findings?: Array<{ path?: string; reason?: string }> };
    attempts?: Array<{
      attempt?: number;
      grokFix?: AgentRunSummary | null;
      agentFix?: AgentRunSummary | null;
      failure?: { kind?: string; retryable?: boolean };
      diffChanged?: boolean;
    }>;
  }>;
  reviewRounds?: ReviewRound[];
  pendingReview?: { verdict?: string | null } | null;
  admission?: { admissible?: boolean; reason?: string | null } | null;
  guardReason?: string | null;
  guardPolicy?: GuardPolicy | null;
  agentFix?: AgentRunSummary | null;
  grokFix?: AgentRunSummary | null;
  agentReview?: AgentRunSummary | null;
  grokReview?: AgentRunSummary | null;
  codexReview?: AgentRunSummary | null;
  reviewVerdict?: string | null;
  artifacts?: {
    runDir?: string;
    latestDir?: string;
  };
  worktreeError?: string | null;
}

export interface ReviewRound {
  round?: number;
  verdict?: string | null;
  decision?: 'pass' | 'needs_changes' | 'halt' | string;
  summary?: string | null;
  riskLevel?: string | null;
  applyRecommendation?: string | null;
  verifiedBoundaries?: string[];
  findings?: Array<{ severity?: string; path?: string; message?: string }>;
}

export interface GuardPolicy {
  protectTests?: boolean;
  protectTaskDocs?: boolean;
  protectedGlobs?: string[];
}

export interface LandingStatus {
  status?: string;
  appliedToMain?: boolean;
  mainGateGreen?: boolean;
  committed?: boolean;
  commit?: string;
}

export interface FinalReportJson {
  schemaVersion?: number;
  status?: string;
  runMode?: string;
  guardPolicy?: GuardPolicy | null;
}

export interface QueueOverviewItem {
  id: string;
  task: string;
  enabled: boolean;
  outcome: string | null;
  outcomeGroup?: string | null;
  status: string | null;
  lastRunId: string | null;
  autoDisabled: boolean;
  running: boolean;
  stale?: boolean;
  applyStatus?: string | null;
  applyErrorKind?: string | null;
  applyErrorFiles?: string[];
  applyError?: string | null;
  worktreeErrorFiles?: string[];
}

export interface QueueOverview {
  tasks: QueueOverviewItem[];
  counts: {
    total: number;
    done: number;
    applied?: number;
    reviewed?: number;
    noDiff?: number;
    applyConflict?: number;
    human?: number;
    failed: number;
    crashed: number;
    quarantined: number;
    stopped?: number;
    running: number;
    pending: number;
  };
  queueRunning: boolean;
}

export interface GateSummary {
  ok?: boolean;
  failureCount?: number;
  progress?: { effectiveFailureCount?: number };
}

export interface GateSnapshot extends GateSummary {
  runs?: Array<{
    startedAt?: string;
    endedAt?: string;
  }>;
}

export interface AgentRunSummary {
  exitCode?: number | null;
  timedOut?: boolean;
  signal?: string | null;
  startedAt?: string;
  endedAt?: string;
}

export interface QueueDefaults {
  timeoutMs?: number;
  skipReview?: boolean;
  autoFix?: boolean;
  fixAgent?: 'grok' | 'codex';
  reviewAgent?: 'grok' | 'codex';
}

export interface QueueFile {
  cwd?: string;
  defaults?: QueueDefaults;
  tasks?: QueueTask[];
}

export interface QueueTask {
  id?: string;
  task: string;
  gatesKey?: string;
  enabled?: boolean;
}

export interface PipelineStep {
  key: string;
  label: string;
}

export interface RunSnapshot {
  state: LoopState | null;
  statePath?: string | null;
  queueRunning: boolean;
  agentTail: string;
  agentLogBytes: number;
  taskLabel: string;
  phaseLabel: string;
  displayStatus: string | null;
  staleRun: {
    status: string;
    reason: string;
    stateAgeMs: number;
    timeoutMs: number;
  } | null;
  details: string[];
  elapsedMs: number;
  phaseElapsedMs: number;
  updatedAt: number;
  pipelineSteps: PipelineStep[];
  fixAgent: string;
  reviewAgent: string | null;
  runMode: string;
  displayGate: {
    ok: boolean | null;
    text: string;
    source: 'post-fix' | 'baseline' | 'none';
    failureCount: number | null;
  };
  landing: LandingStatus | null;
  finalReport: FinalReportJson | null;
  guardPolicy: GuardPolicy | null;
}

export interface RunSummaryItem {
  runId: string;
  status: string;
  task: string;
  fixAgent: string;
  reviewAgent: string | null;
  runMode: string;
  grokRan: boolean;
  codexRan: boolean;
  iterations: number;
  mtimeMs: number;
}
