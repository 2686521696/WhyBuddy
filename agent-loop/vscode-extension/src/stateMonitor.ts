import * as vscode from 'vscode';
import { DashboardPanel } from './dashboardPanel';
import { formatElapsed, phaseLabel, statusIcon } from './phaseLabels';
import { latestDir } from './paths';
import { buildRunSnapshot, snapshotStatusLine } from './stateReader';
import type { RunSnapshot } from './types';

export type SnapshotListener = (snapshot: RunSnapshot) => void;

export class StateMonitor implements vscode.Disposable {
  private readonly listeners = new Set<SnapshotListener>();
  private readonly disposables: vscode.Disposable[] = [];
  private pollTimer: NodeJS.Timeout | undefined;
  private runStartedAt = Date.now();
  private phaseStartedAt = Date.now();
  private lastStatus: string | undefined;
  private latestSnapshot: RunSnapshot | null = null;
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly repoRoot: string,
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'agentLoop.openDashboard';
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);

    const latest = latestDir(repoRoot);
    const patterns = [
      new vscode.RelativePattern(latest, 'state.json'),
      new vscode.RelativePattern(latest, 'codex-review.stderr.log'),
      new vscode.RelativePattern(latest, 'review-output.grok.stderr.log'),
      new vscode.RelativePattern(latest, 'grok-output.*.stderr.log'),
      new vscode.RelativePattern(latest, 'fix-output.codex.*.stderr.log'),
      new vscode.RelativePattern(latest, 'final-report.md'),
    ];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.refresh().catch(() => {}));
      watcher.onDidCreate(() => this.refresh().catch(() => {}));
      this.disposables.push(watcher);
    }

    this.startPolling();
    this.refresh().catch(() => {});
  }

  public onDidUpdate(listener: SnapshotListener): vscode.Disposable {
    this.listeners.add(listener);
    if (this.latestSnapshot) listener(this.latestSnapshot);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  public getSnapshot(): RunSnapshot | null {
    return this.latestSnapshot;
  }

  public markRunStarted(): void {
    this.runStartedAt = Date.now();
    this.phaseStartedAt = Date.now();
    this.lastStatus = undefined;
  }

  public async refresh(): Promise<RunSnapshot> {
    const snapshot = await buildRunSnapshot(this.repoRoot, this.phaseStartedAt, this.runStartedAt);
    const status = snapshot.state?.status;

    if (status && status !== this.lastStatus) {
      this.lastStatus = status;
      this.phaseStartedAt = Date.now();
      this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${snapshotStatusLine(snapshot)}`);
    }

    this.latestSnapshot = snapshot;
    this.updateChrome(snapshot);
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  private updateChrome(snapshot: RunSnapshot): void {
    const status = snapshot.state?.status;
    const icon = statusIcon(status);
    const text = status
      ? `${icon} AgentLoop: ${phaseLabel(status)} (${formatElapsed(snapshot.elapsedMs)})`
      : '$(circle-outline) AgentLoop: 空闲';
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = snapshot.details.join('\n') || '打开 AgentLoop 面板';

    if (DashboardPanel.current) {
      DashboardPanel.current.update(snapshot);
    }
  }

  private startPolling(): void {
    const interval = vscode.workspace.getConfiguration('agentLoop').get<number>('pollIntervalMs', 1500);
    this.pollTimer = setInterval(() => {
      this.refresh().catch(() => {});
    }, interval);
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.statusBarItem.dispose();
  }
}