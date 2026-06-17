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
  worktree?: {
    fixCwd?: string;
    targetCwd?: string;
  };
  iterations?: Array<{ iteration: number; grokFix?: AgentRunSummary | null; agentFix?: AgentRunSummary | null }>;
  agentFix?: AgentRunSummary | null;
  grokFix?: AgentRunSummary | null;
  agentReview?: AgentRunSummary | null;
  grokReview?: AgentRunSummary | null;
  codexReview?: AgentRunSummary | null;
  artifacts?: {
    runDir?: string;
    latestDir?: string;
  };
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
  queueRunning: boolean;
  agentTail: string;
  agentLogBytes: number;
  taskLabel: string;
  phaseLabel: string;
  details: string[];
  elapsedMs: number;
  phaseElapsedMs: number;
  updatedAt: number;
  pipelineSteps: PipelineStep[];
  fixAgent: string;
  reviewAgent: string | null;
  runMode: string;
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