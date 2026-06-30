// Shared types for the settings split boundary (112.10 component split).
// Re-exports the main view model; panels use minimal local prop shapes for tree-shakability.

export type { AgentLoopSettingsViewModel } from '../dashboardTypes';

// Panel prop shapes (kept minimal and local to avoid pulling full app state)
export type SettingsData = {
  activeProfile?: string | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  queuePath?: string | null;
  worktreeScope?: string | null;
  baseUrl?: string;
  injectToWorker?: boolean;
  queueRunning?: boolean;
  keys?: Record<string, 'configured' | ''>;
  nonSensitive?: Record<string, unknown>;
};

export type CliConfigFormProps = {
  initial?: SettingsData['nonSensitive'] | null;
  onSave: (v: Record<string, unknown>) => void;
  queueRunning?: boolean;
  activeProfile?: string | null;
};

export type LlmKeysPanelProps = {
  initial: SettingsData | null;
  onSave: (v: Record<string, unknown>) => void;
  providerTests?: any[];
  onTestProvider?: (p: string) => void;
  workerCliTests?: any[];
  onTestWorkerCli?: (w: string) => void;
  queueRunning?: boolean;
};

export type QueueDefaultsPanelProps = {
  data?: any;
  preview?: any;
  onPreview: (proposed: Record<string, unknown>) => void;
  applyResult?: any;
  onApply?: (proposed: Record<string, unknown>) => void;
  settingsData?: SettingsData | null;
};

export type DiagnosticsPanelProps = {
  data?: any;
  pythonHealth?: import('../dashboardTypes').PythonHealthViewModel | null;
  onRefresh: () => void;
};

export type ProfilesPanelProps = {
  data?: any;
  queueRunning?: boolean;
  activeProfile?: string | null;
  onList: () => void;
  onCreate: (n: string, v?: any) => void;
  onRename: (o: string, n: string) => void;
  onDuplicate: (n: string, nn: string) => void;
  onDelete: (n: string) => void;
  onSelect: (n: string) => void;
};

export type RedactedImportExportProps = {
  exportedSettings?: any;
  importResult?: any;
  onExportSettings?: () => void;
  onImportSettings?: (text: string) => void;
};
