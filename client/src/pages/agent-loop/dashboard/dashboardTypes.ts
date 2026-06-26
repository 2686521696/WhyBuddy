export type DashboardMessage =
  | { type: 'overview'; payload: OverviewPayload }
  | { type: 'detail'; payload: DetailPayload };

export type OverviewTask = {
  id?: string | null;
  task: string;
  taskLabel?: string | null;
  statusLabel?: string | null;
  badge?: string | null;
  outcome?: string | null;
  outcomeGroup?: string | null;
  enabled?: boolean;
  autoDisabled?: boolean;
  running?: boolean;
  category?: string | null;
  agent?: string | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  branch?: string | null;
  lastUpdatedAt?: string | null;
  diffBytes?: number | null;
  lastUpdatedText?: string | null;
  applyErrorKind?: string | null;
  applyError?: string | null;
  applyErrorFiles?: string[];
  lastRunId?: string | null;
};

export type AvailableQueue = {
  path: string;
  taskCount?: number | null;
  mtime?: number | string | null;
};

export type OverviewPayload = {
  counts?: Record<string, number | undefined>;
  queueRunning?: boolean;
  queuePath?: string | null;
  latestQueuePath?: string | null;
  queueStale?: boolean;
  availableQueues?: AvailableQueue[];
  landing?: unknown;
  current?: {
    taskLabel?: string | null;
    phaseLabel?: string | null;
    status?: string | null;
    elapsedText?: string | null;
    staleRun?: unknown;
  } | null;
  tasks?: OverviewTask[];
};

export type DetailPayload = {
  taskLabel?: string | null;
  taskPath?: string | null;
  runId?: string | null;
  status?: string | null;
  phaseLabel?: string | null;
  elapsedText?: string | null;
  gateText?: string | null;
  gateOk?: boolean;
  agentText?: string | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  repo?: string | null;
  commit?: string | null;
  activeTab?: string | null;
  activeEventFilter?: string | null;
  eventSearchQuery?: string | null;
  pipelineSteps?: Array<{ key?: string | null; label?: string | null; done?: boolean; active?: boolean }>;
  details?: string[];
  iterations?: Array<Record<string, unknown>>;
  reviewRounds?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  agentTail?: string | null;
  diffText?: string | null;
  failingGateText?: string | null;
  artifacts?: Array<{ id?: string; kind?: string; title?: string | null; content?: string | null }>;
  reportPath?: string | null;
  reportJsonPath?: string | null;
  landingPath?: string | null;
  statePath?: string | null;
  landing?: Record<string, unknown> | null;
};

export type VsCodeApi = {
  postMessage(message: unknown): void;
};

// Typed settings view model contract (112): stable renderable UI shape for settings panels.
// Raw secrets (grokApiKey etc values or keys) MUST be stripped before this reaches components.
export type AgentLoopSettingsViewModel = {
  activeProfile: string | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  queuePath?: string | null;
  worktreeScope?: string | null;
  baseUrl?: string;
  injectToWorker?: boolean;
  queueRunning?: boolean;
  keys?: Record<string, 'configured' | ''>;
  nonSensitive?: Record<string, unknown>;
  // Additional normalized sections for contract (queue/diag/profiles may be separate but referenced here for panels)
  queueDefaults?: { defaults?: Record<string, unknown>; supportedKeys?: string[]; queuePath?: string | null };
  diagnostics?: Record<string, unknown> | null;
  profiles?: { profiles?: Record<string, unknown>; activeProfile?: string | null } | null;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
    __AGENT_LOOP_VSCODE_API__?: VsCodeApi;
    __AGENT_LOOP_ASSETS__?: { brandLogo?: string };
    __AGENT_LOOP_CSP_NONCE__?: string;
    AgentLoopReactDashboard?: {
      renderOverview(payload: OverviewPayload): void;
      renderDetail(payload: DetailPayload): void;
    };
  }
}
