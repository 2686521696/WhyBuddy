import * as vscode from 'vscode';
import { DashboardPanel } from './dashboardPanel';
import { formatElapsed, phaseLabel, statusIcon } from './phaseLabels';
import { latestDir, queuePath } from './paths';
import { buildQueueOverview, buildRunSnapshot, snapshotStatusLine } from './stateReader';
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
  private dashboardStatePath: string | null = null;
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly repoRoot: string,
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    private readonly isQueueRunning: () => boolean = () => false,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'agentLoop.openDashboard';
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);

    const latest = latestDir(repoRoot);
    const patterns = [
      new vscode.RelativePattern(latest, 'state.json'),
      new vscode.RelativePattern(latest, 'codex-review.stdout.log'),
      new vscode.RelativePattern(latest, 'codex-review.stderr.log'),
      new vscode.RelativePattern(latest, 'review-output.grok.stdout.log'),
      new vscode.RelativePattern(latest, 'review-output.grok.stderr.log'),
      new vscode.RelativePattern(latest, 'grok-output.*.stdout.log'),
      new vscode.RelativePattern(latest, 'grok-output.*.stderr.log'),
      new vscode.RelativePattern(latest, 'fix-output.codex.*.stdout.log'),
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
    this.dashboardStatePath = null;
    this.runStartedAt = Date.now();
    this.phaseStartedAt = Date.now();
    this.lastStatus = undefined;
  }

  public showLatestInDashboard(): void {
    this.dashboardStatePath = null;
    if (this.latestSnapshot && DashboardPanel.current) {
      DashboardPanel.current.update(this.latestSnapshot);
    }
  }

  public async pushOverview(): Promise<void> {
    if (!DashboardPanel.current) return;
    this.dashboardStatePath = null;
    const overview = await buildQueueOverview(this.repoRoot, {
      queueFilePath: queuePath(this.repoRoot),
      runningTaskPath: this.latestSnapshot?.state?.options?.task ?? null,
      queueRunning: this.isQueueRunning(),
      currentRunStale: Boolean(this.latestSnapshot?.staleRun),
    });
    DashboardPanel.current.showOverview(overview, this.latestSnapshot);
  }

  public async showStatePathInDashboard(statePath: string): Promise<RunSnapshot> {
    this.dashboardStatePath = statePath;
    const snapshot = this.enrichSnapshot(await buildRunSnapshot(
      this.repoRoot,
      this.phaseStartedAt,
      this.runStartedAt,
      { statePath, queueFilePath: queuePath(this.repoRoot) },
    ));
    if (DashboardPanel.current) {
      DashboardPanel.current.update(snapshot);
    }
    return snapshot;
  }

  public async refresh(): Promise<RunSnapshot> {
    const snapshot = this.enrichSnapshot(await buildRunSnapshot(
      this.repoRoot,
      this.phaseStartedAt,
      this.runStartedAt,
      { queueFilePath: queuePath(this.repoRoot) },
    ));
    const status = snapshot.displayStatus ?? snapshot.state?.status;

    if (status && status !== this.lastStatus) {
      this.lastStatus = status;
      this.phaseStartedAt = Date.now();
      this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${snapshotStatusLine(snapshot)}`);
    }

    this.latestSnapshot = snapshot;
    this.updateChrome(snapshot);
    for (const listener of this.listeners) listener(snapshot);
    await this.updateDashboard(snapshot);
    return snapshot;
  }

  private updateChrome(snapshot: RunSnapshot): void {
    const status = snapshot.displayStatus ?? snapshot.state?.status;
    const icon = statusIcon(status);
    const text = status
      ? `${icon} AgentLoop: ${phaseLabel(status)} (${formatElapsed(snapshot.elapsedMs)})`
      : '$(circle-outline) AgentLoop: 空闲';
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = snapshot.details.join('\n') || '打开 AgentLoop 面板';
  }

  private enrichSnapshot(snapshot: RunSnapshot): RunSnapshot {
    return { ...snapshot, queueRunning: this.isQueueRunning() };
  }

  private async updateDashboard(latestSnapshot: RunSnapshot): Promise<void> {
    if (!DashboardPanel.current) return;
    if (DashboardPanel.current.view === 'overview') {
      await this.pushOverview();
      return;
    }
    if (!this.dashboardStatePath) {
      DashboardPanel.current.update(latestSnapshot);
      return;
    }
    const selected = this.enrichSnapshot(await buildRunSnapshot(
      this.repoRoot,
      this.phaseStartedAt,
      this.runStartedAt,
      { statePath: this.dashboardStatePath, queueFilePath: queuePath(this.repoRoot) },
    ));
    DashboardPanel.current.update(selected);
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
